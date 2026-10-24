// `http.request` (G design section 4), executed host-side for one bound challenge. Every URL is compared with the
// challenge's authorized origin before a socket is opened; each redirect hop is checked the same way. The address used
// for the check is the address the socket connects to (no second DNS lookup), and connections are never reused, so a
// later DNS answer cannot move a request. Nothing here injects credentials or reads the process proxy environment.
import { mkdir, writeFile } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { join } from 'node:path';

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
export const MAX_REDIRECTS = 5;
export const MAX_REQUEST_BODY = 64 * 1024;
export const MAX_HEADER_COUNT = 20;
export const MAX_HEADER_VALUE = 2 * 1024;
export const MAX_SAVED_BODY = 1024 * 1024;
export const MAX_HEADER_OUTPUT = 16 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_TIMEOUT_MS = 60000;
const PREVIEW_BYTES = 2048;
const CLEANUP_GRACE_MS = 1000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const REFUSED_REQUEST_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade']);

/** Thrown for any refusal; `code` is a fixed short reason, never request content. */
export class HttpRefused extends Error { constructor(readonly code: string) { super(code); } }

export interface RedirectHop {
  origin: string;
  path: string;
  status: number | null;
  /** Set on the location that was not requested. */
  stopped?: 'out_of_scope' | 'hop_limit';
}

/** Cookies per challenge, keyed by origin. The caller owns one jar per challenge and shares it between its sessions. */
export class CookieJar {
  private readonly byOrigin = new Map<string, Map<string, { value: string; path: string }>>();

  store(url: URL, setCookies: string[] | undefined): void {
    for (const line of setCookies ?? []) {
      const [pair, ...attributes] = line.split(';');
      const eq = pair!.indexOf('=');
      if (eq <= 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const pathAttribute = attributes.map(a => a.trim()).find(a => a.toLowerCase().startsWith('path='));
      const path = pathAttribute ? pathAttribute.slice('path='.length) || '/' : '/';
      const cookies = this.byOrigin.get(url.origin) ?? new Map();
      cookies.set(name, { value, path });
      this.byOrigin.set(url.origin, cookies);
    }
  }

  /** `Cookie` header value for a request to `url`; same origin and path prefix only. */
  header(url: URL): string {
    const cookies = this.byOrigin.get(url.origin);
    if (!cookies) return '';
    const pathname = url.pathname;
    return [...cookies]
      .filter(([, c]) => pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`))
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; ');
  }
}

export interface HttpToolOptions {
  /** The bound challenge's authorized origin (`http` or `https` URL). */
  target: string;
  jar: CookieJar;
  /** Real path of the bound session's `work/` directory; response bodies go to `<workDir>/http/`. */
  workDir: string;
  /** Injection point for the DNS check; defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** Issued only after host registration/identity/quota checks; never constructed from model args.
 * deadline is an absolute Unix millisecond timestamp capped by host run/session lifetime.
 * The host owns registration, stop flags, result retention and quota release after request settles.
 */
export interface HttpOperation {
  readonly run: string;
  readonly sessionID: string;
  readonly callID: string;
  readonly signal: AbortSignal;
  readonly deadline: number;
  capture?: (bytes: Buffer, complete: boolean) => void;
}

export function createHttpTools(options: HttpToolOptions) {
  const target = parseTarget(options.target);
  const resolve = options.resolve ?? resolveAll;
  let sequence = 0;

  async function request(args: Record<string, unknown>, operation: HttpOperation) {
    // One deadline covers parsing, DNS, all hops, response reads and persistence.
    const timeoutMs = parseTimeout(args.timeout_ms);
    if (!operation || !Number.isFinite(operation.deadline)) throw new HttpRefused('operation');
    const deadline = Math.min(Date.now() + timeoutMs, operation.deadline);
    let reason: HttpRefused | undefined;
    let rejectStopped!: (error: HttpRefused) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
    // A pre-aborted signal may reject before the first await; keep it handled in every path.
    void stopped.catch(() => {});
    const requests = new Map<ClientRequest, Promise<void>>();
    const lifetime = new AbortController();
    let persistence: ReturnType<typeof finish> | undefined;
    const stop = (code: 'cancelled' | 'timeout') => {
      if (reason) return;
      reason = new HttpRefused(code);
      rejectStopped(reason);
      lifetime.abort(reason);
      for (const req of requests.keys()) req.destroy(reason);
    };
    const onAbort = () => stop(operation.signal.reason === 'deadline' ? 'timeout' : 'cancelled');
    const check = () => {
      if (operation.signal.aborted) onAbort();
      if (Date.now() >= deadline) stop('timeout');
      if (reason) throw reason;
    };
    operation.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop('timeout'), Math.max(0, deadline - Date.now()));
    try {
      check();
      const method = parseMethod(args.method);
      const url = parseUrl(args.url, target);
      const headers = parseHeaders(args.headers);
      const body = parseBody(args.body, args.body_base64);
      const followRedirects = parseFlag(args.follow_redirects);
      const chain: RedirectHop[] = [];
      let current = url;
      let currentMethod = method;
      let currentBody = body;
      for (;;) {
        check();
        // System DNS itself cannot be cancelled; the wait is cancellable and late results have no continuation.
        const address = await Promise.race([pin(current, resolve), stopped]);
        check();
        const response = await Promise.race([send({
          url: current, method: currentMethod, headers, body: currentBody, address, jar: options.jar,
          onRequest: req => {
            requests.set(req, new Promise<void>(done => req.once('close', done)));
          }
        }), stopped]);
        check();
        options.jar.store(current, response.headers['set-cookie']);
        chain.push({ origin: current.origin, path: current.pathname, status: response.statusCode });

        const location = response.headers.location;
        let next: URL | undefined;
        if (followRedirects && REDIRECT_STATUS.has(response.statusCode) && typeof location === 'string') {
          try { next = new URL(location, current); } catch { /* return this response */ }
        }
        if (next && next.origin !== target.origin) {
          chain.push({ origin: next.origin, path: next.pathname, status: null, stopped: 'out_of_scope' });
          next = undefined;
        } else if (next && chain.length > MAX_REDIRECTS) {
          chain.push({ origin: next.origin, path: next.pathname, status: null, stopped: 'hop_limit' });
          next = undefined;
        }
        if (!next) {
          persistence = finish(response, chain, lifetime.signal);
          const result = await Promise.race([persistence, stopped]);
          check();
          operation.capture?.(Buffer.from(response.body), !response.bodyTruncated);
          return result;
        }
        if (response.statusCode === 303 || (currentMethod === 'POST' && (response.statusCode === 301 || response.statusCode === 302))) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        current = next;
      }
    } catch (error) {
      if (reason) throw reason;
      if (error instanceof HttpRefused) throw error;
      throw new HttpRefused('network');
    } finally {
      clearTimeout(timer);
      operation.signal.removeEventListener('abort', onAbort);
      // A stalled filesystem or close event must not turn cancellation into an unbounded wait.
      // Unknown cleanup is terminal but NOT proof of resource release; host keeps its reservation.
      for (const req of requests.keys()) req.destroy();
      const cleanup = [...requests.values()];
      if (persistence) cleanup.push(persistence.then(() => {}, () => {}));
      await boundedCleanup(cleanup);
    }
  }

  async function finish(response: Sent, chain: RedirectHop[], signal: AbortSignal) {
    sequence += 1;
    const name = `${sequence}.bin`;
    await mkdir(join(options.workDir, 'http'), { recursive: true });
    signal.throwIfAborted();
    await writeFile(join(options.workDir, 'http', name), response.body, { signal });
    const { headers, truncated } = serializeHeaders(response.headers);
    return {
      status: response.statusCode,
      headers,
      headersTruncated: truncated,
      redirectChain: chain,
      bodyPath: `work/http/${name}`,
      bodyBytes: response.body.length,
      bodyTruncated: response.bodyTruncated,
      preview: preview(response.body)
    };
  }

  return { request };
}

/** Transport cleanup grace is separate from, and never extends, HTTP execution time. */
async function boundedCleanup(tasks: Promise<void>[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(tasks),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpRefused('cleanup_unknown')), CLEANUP_GRACE_MS);
      })
    ]);
  } finally { clearTimeout(timer); }
}

interface Sent { statusCode: number; headers: IncomingHttpHeaders; body: Buffer; bodyTruncated: boolean }

function parseTarget(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpRefused('target'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpRefused('target');
  return url;
}

function parseMethod(value: unknown): string {
  if (value === undefined) return 'GET';
  const method = typeof value === 'string' ? value.toUpperCase() : '';
  if (!HTTP_METHODS.includes(method)) throw new HttpRefused('method');
  return method;
}

/** Scheme, host, and port must equal the target's origin; `URL` normalizes host case and default ports. */
function parseUrl(value: unknown, target: URL): URL {
  if (typeof value !== 'string') throw new HttpRefused('url');
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpRefused('url'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new HttpRefused('url');
  if (url.origin !== target.origin) throw new HttpRefused('scope');
  return url;
}

function parseHeaders(value: unknown): OutgoingHttpHeaders {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpRefused('header');
  const entries = Object.entries(value);
  if (entries.length > MAX_HEADER_COUNT) throw new HttpRefused('header');
  const headers: OutgoingHttpHeaders = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (typeof rawValue !== 'string' || Buffer.byteLength(rawValue) > MAX_HEADER_VALUE) throw new HttpRefused('header');
    if (REFUSED_REQUEST_HEADERS.has(name) || name.startsWith('proxy-')) throw new HttpRefused('header');
    headers[name] = rawValue;
  }
  return headers;
}

function parseBody(text: unknown, base64: unknown): Buffer | undefined {
  if (text !== undefined && base64 !== undefined) throw new HttpRefused('body');
  let body: Buffer | undefined;
  if (typeof text === 'string') body = Buffer.from(text, 'utf8');
  else if (typeof base64 === 'string') body = Buffer.from(base64, 'base64');
  else if (text !== undefined || base64 !== undefined) throw new HttpRefused('body');
  if (body && body.length > MAX_REQUEST_BODY) throw new HttpRefused('body');
  return body;
}

function parseTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new HttpRefused('timeout');
  return Math.min(value, MAX_TIMEOUT_MS);
}

function parseFlag(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new HttpRefused('argument');
  return value;
}

async function resolveAll(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map(record => record.address);
}

/** IP literals are used as they are (no DNS query); names use the first address of one lookup. */
async function pin(url: URL, resolve: (hostname: string) => Promise<string[]>): Promise<string> {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host)) return host;
  const [address] = await resolve(host);
  if (!address) throw new HttpRefused('address');
  return address;
}

function plainAddress(address: string | undefined): string | undefined {
  return address?.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

interface SendInput {
  url: URL;
  method: string;
  headers: OutgoingHttpHeaders;
  body: Buffer | undefined;
  address: string;
  jar: CookieJar;
  onRequest: (req: ClientRequest) => void;
}

/** Answers the socket's lookup with the address already checked, so no second resolution happens. */
function pinnedLookup(address: string): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, [{ address, family: isIP(address) }]);
    else callback(null, address, isIP(address));
  };
}

function send(input: SendInput): Promise<Sent> {
  const { url, address } = input;
  const headers: OutgoingHttpHeaders = { ...input.headers };
  const cookie = input.jar.header(url);
  if (cookie && !('cookie' in headers)) headers.cookie = cookie;
  if (input.body) headers['content-length'] = String(input.body.length);
  const secure = url.protocol === 'https:';
  return new Promise((resolvePromise, reject) => {
    // `url` has already passed the origin check, so this relaxation applies only to the authorized origin.
    const open = secure ? httpsRequest : httpRequest;
    const req = open(url, {
      method: input.method,
      headers,
      agent: false,
      lookup: pinnedLookup(address),
      ...(secure ? { rejectUnauthorized: false } : {})
    }, res => {
      const chunks: Buffer[] = [];
      let total = 0;
      let saved = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        const part = chunk.subarray(0, MAX_SAVED_BODY - saved);
        if (part.length) chunks.push(part);
        saved += part.length;
      });
      res.on('end', () => resolvePromise({
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        bodyTruncated: total > MAX_SAVED_BODY
      }));
      res.on('error', reject);
    });
    input.onRequest(req);
    req.once('socket', socket => {
      const check = () => {
        if (plainAddress(socket.remoteAddress) !== plainAddress(address)) req.destroy(new HttpRefused('address'));
      };
      if (socket.connecting) socket.once('connect', check);
      else check();
    });
    req.on('error', reject);
    req.end(input.body);
  });
}

function serializeHeaders(headers: IncomingHttpHeaders): { headers: Record<string, string | string[]>; truncated: boolean } {
  const out: Record<string, string | string[]> = {};
  let size = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const line = `${name}: ${Array.isArray(value) ? value.join(', ') : value}`;
    size += Buffer.byteLength(line);
    if (size > MAX_HEADER_OUTPUT) return { headers: out, truncated: true };
    out[name] = value;
  }
  return { headers: out, truncated: false };
}

/** UTF-8 text of the first 2 KiB when the body is valid UTF-8 text; otherwise the first 8 bytes in hex. */
function preview(body: Buffer): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    if (!text.includes('\0')) return new TextDecoder().decode(body.subarray(0, PREVIEW_BYTES));
  } catch { /* binary */ }
  return body.subarray(0, 8).toString('hex') || 'empty';
}
