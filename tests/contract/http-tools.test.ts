import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stat, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { CookieJar, createHttpTools, MAX_SAVED_BODY, MAX_HEADER_VALUE, MAX_REDIRECTS } from '../../apps/launcher/src/http-tools.js';

import type { HttpResponseFacts } from '../../apps/launcher/src/artifact-tools.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface Counted { server: Server; port: number; connections: number; requests: number }

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

async function countedServer(handler: Handler, secure?: { key: string; cert: string }): Promise<Counted> {
  const server = secure ? createHttpsServer(secure, handler) : createServer(handler);
  const counted: Counted = { server, port: 0, connections: 0, requests: 0 };
  server.on('connection', () => { counted.connections += 1; });
  server.on('request', () => { counted.requests += 1; });
  counted.port = await listen(server);
  return counted;
}

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

let root: string;
let authorized: Counted;
let outside: Counted;
let authOrigin: string;
let outOrigin: string;
let secureAuthorized: Counted | undefined;
let secureOutside: Counted | undefined;

/** Authorized origin's routes. `/redirect-out` points at `outOriginValue()` (a different origin). */
function authHandler(outOriginValue: () => string): Handler {
  return (req, res) => {
    const path = req.url ?? '/';
    if (path === '/redirect-out') {
      res.writeHead(302, { location: `${outOriginValue()}/landing` });
      res.end();
      return;
    }
    if (path === '/set-cookie') {
      res.writeHead(200, { 'set-cookie': ['sid=abc123; Path=/', 'other=1; Path=/private'] });
      res.end('set');
      return;
    }
    if (path === '/cookie') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.headers.cookie ?? '');
      return;
    }
    if (path === '/host') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.headers.host ?? '');
      return;
    }
    if (path === '/big') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(MAX_SAVED_BODY + 512 * 1024, 0x61));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('authorized');
  };
}

const outsideHandler: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('outside');
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'http-tools-test-'));
  outside = await countedServer(outsideHandler);
  authorized = await countedServer(authHandler(() => `http://127.0.0.1:${outside.port}`));
  authOrigin = `http://127.0.0.1:${authorized.port}`;
  outOrigin = `http://127.0.0.1:${outside.port}`;
  if (hasOpenssl) {
    const key = join(root, 'key.pem');
    const cert = join(root, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    const material = { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
    secureOutside = await countedServer(outsideHandler, material);
    secureAuthorized = await countedServer(authHandler(() => `https://127.0.0.1:${secureOutside!.port}`), material);
  }
});

afterAll(async () => {
  for (const counted of [authorized, outside, secureAuthorized, secureOutside]) {
    counted?.server.close();
    counted?.server.closeAllConnections?.();
  }
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const counted of [authorized, outside, secureAuthorized, secureOutside]) {
    if (counted) { counted.connections = 0; counted.requests = 0; }
  }
});

function toolsFor(target: string, options: { jar?: CookieJar; resolve?: (hostname: string) => Promise<string[]> } = {}) {
  const adapter = createHttpTools({ target, jar: options.jar ?? new CookieJar(), workDir: root, resolve: options.resolve });
  let call = 0;
  return { request: (args: Record<string, unknown>) => adapter.request(args, {
    run: 'legacy-fixture', sessionID: 'session', callID: String(++call),
    signal: new AbortController().signal, deadline: Date.now() + 60000
  }) };
}

function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => 'allowed', (error: { code?: string }) => error.code ?? 'error');
}

describe('http.request (G-V4)', () => {
  it('criterion 1: scheme, host, or port different from the target origin is refused without connecting', async () => {
    const tools = toolsFor(authOrigin);
    const results = await Promise.all([
      outcome(tools.request({ url: `${outOrigin}/` })),
      outcome(tools.request({ url: `https://127.0.0.1:${authorized.port}/` })),
      outcome(tools.request({ url: `http://localhost:${authorized.port}/` }))
    ]);
    expect({ results, outsideConnections: outside.connections }).toEqual({
      results: ['scope', 'scope', 'scope'],
      outsideConnections: 0
    });
  });

  it('criterion 2: an authorized redirect to another origin stops at that hop and records it', async () => {
    const tools = toolsFor(authOrigin);
    const result = await tools.request({ url: `${authOrigin}/redirect-out`, follow_redirects: true });
    expect({ chain: result.redirectChain, outsideConnections: outside.connections }).toEqual({
      chain: [
        { origin: authOrigin, path: '/redirect-out', status: 302 },
        { origin: outOrigin, path: '/landing', status: null, stopped: 'out_of_scope' }
      ],
      outsideConnections: 0
    });
  });

  it('criterion 3: the connection goes to the address checked, and a later DNS answer is never consulted', async () => {
    const resolve = vi.fn<(hostname: string) => Promise<string[]>>()
      .mockResolvedValueOnce(['127.0.0.1'])
      .mockResolvedValue(['127.0.0.2']);
    const tools = toolsFor(`http://authorized.test:${authorized.port}`, { resolve });
    const result = await tools.request({ url: `http://authorized.test:${authorized.port}/` });
    expect({ status: result.status, resolverCalls: resolve.mock.calls.length, served: authorized.requests }).toEqual({
      status: 200, resolverCalls: 1, served: 1
    });
  });

  it('criterion 4: an IP-literal host is used directly with no DNS query', async () => {
    const resolve = vi.fn<(hostname: string) => Promise<string[]>>().mockResolvedValue(['127.0.0.2']);
    const tools = toolsFor(authOrigin, { resolve });
    const result = await tools.request({ url: `${authOrigin}/` });
    expect({ status: result.status, resolverCalls: resolve.mock.calls.length }).toEqual({ status: 200, resolverCalls: 0 });
  });

  it('criterion 5: Set-Cookie is sent back to the same origin, not to another challenge or another origin', async () => {
    const jarA = new CookieJar();
    const toolsA = toolsFor(authOrigin, { jar: jarA });
    const toolsB = toolsFor(authOrigin, { jar: new CookieJar() });
    await toolsA.request({ url: `${authOrigin}/set-cookie` });
    const sameChallenge = (await toolsA.request({ url: `${authOrigin}/cookie` })).preview;
    const otherChallenge = (await toolsB.request({ url: `${authOrigin}/cookie` })).preview;
    const otherOrigin = jarA.header(new URL(`${outOrigin}/`));
    expect({ sameChallenge, otherChallenge, otherOrigin }).toEqual({
      sameChallenge: 'sid=abc123', otherChallenge: '', otherOrigin: ''
    });
  });

  it('criterion 6: forbidden request headers are refused, and Host is allowed', async () => {
    const tools = toolsFor(authOrigin);
    const refused = async (name: string, value: string) => outcome(tools.request({ url: `${authOrigin}/host`, headers: { [name]: value } }));
    const results = {
      connection: await refused('connection', 'close'),
      'content-length': await refused('content-length', '0'),
      'proxy-authorization': await refused('proxy-authorization', 'Basic eA=='),
      host: (await tools.request({ url: `${authOrigin}/host`, headers: { Host: 'example.test' } })).preview
    };
    expect(results).toEqual({
      connection: 'header', 'content-length': 'header', 'proxy-authorization': 'header', host: 'example.test'
    });
  });

  it('criterion 7: a response over 1 MiB is marked truncated and saved within the limit', async () => {
    const tools = toolsFor(authOrigin);
    const result = await tools.request({ url: `${authOrigin}/big` });
    const saved = (await stat(join(root, ...result.bodyPath.split('/').slice(1)))).size;
    expect({
      truncated: result.bodyTruncated,
      withinLimit: result.bodyBytes <= MAX_SAVED_BODY && saved <= MAX_SAVED_BODY
    }).toEqual({ truncated: true, withinLimit: true });
  });

  it('criterion 8: proxy environment variables are ignored and the request goes direct', async () => {
    const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
    const previous = names.map(name => [name, process.env[name]] as const);
    for (const name of names) process.env[name] = 'http://127.0.0.1:9';
    try {
      const result = await toolsFor(authOrigin).request({ url: `${authOrigin}/` });
      expect({ status: result.status, preview: result.preview }).toEqual({ status: 200, preview: 'authorized' });
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it.skipIf(!hasOpenssl)('criterion 9: a self-signed certificate is accepted on the authorized https origin only', async () => {
    const authorizedUrl = `https://127.0.0.1:${secureAuthorized!.port}`;
    const outsideUrl = `https://127.0.0.1:${secureOutside!.port}`;
    const tools = toolsFor(authorizedUrl);
    const direct = await tools.request({ url: `${authorizedUrl}/` });
    const redirected = await tools.request({ url: `${authorizedUrl}/redirect-out`, follow_redirects: true });
    const directOutside = await outcome(tools.request({ url: `${outsideUrl}/` }));
    expect({
      status: direct.status,
      preview: direct.preview,
      redirectStopped: redirected.redirectChain.at(-1)?.stopped,
      outsideConnections: secureOutside!.connections,
      directOutside
    }).toEqual({
      status: 200, preview: 'authorized', redirectStopped: 'out_of_scope', outsideConnections: 0, directOutside: 'scope'
    });
  });
});

// Regression: advancing the one request timer while DNS is blocked must prevent a later socket.
describe('G-V4 DNS lifecycle regression', () => {
  it('timeout during DNS settles promptly and never connects after resolution is released', async () => {
    let release!: (addresses: string[]) => void;
    const pending = new Promise<string[]>(resolve => { release = resolve; });
    const resolve = vi.fn(() => pending);
    const tools = toolsFor(`http://authorized.test:${authorized.port}`, { resolve });
    vi.useFakeTimers();
    try {
      let settled = false;
      const result = outcome(tools.request({ url: `http://authorized.test:${authorized.port}/`, timeout_ms: 20 }))
        .then(value => { settled = true; return value; });
      await vi.advanceTimersByTimeAsync(20);
      const settledBeforeDns = settled;
      release(['127.0.0.1']);
      vi.useRealTimers();
      const code = await result;
      expect({ code, settledBeforeDns, authorized: authorized.connections, outside: outside.connections })
        .toEqual({ code: 'timeout', settledBeforeDns: true, authorized: 0, outside: 0 });
    } finally { vi.useRealTimers(); }
  });
});

// Wrong final-method or selecting the unrequested Location would mislabel the captured body.
describe('HTTP body-bound evidence facts', () => {
  async function capture(target: string, args: Record<string, unknown>, redactions?: string[]) {
    const adapter = createHttpTools({ target, jar: new CookieJar(), workDir: root, redactions });
    let captured: {bytes: Buffer; complete: boolean; http: HttpResponseFacts} | undefined;
    const result = await adapter.request(args, {
      run: 'facts', sessionID: 'solver', callID: 'facts-call', signal: new AbortController().signal,
      deadline: Date.now() + 10000, capture: (bytes: Buffer, complete: boolean, http: HttpResponseFacts) => { captured = {bytes, complete, http}; }
    });
    expect(captured).toBeDefined();
    return {result, ...captured!};
  }

  it.each([[301, 'GET'], [302, 'GET'], [303, 'GET'], [307, 'POST'], [308, 'POST']])(
    'binds POST redirect %i body to actual method %s', async (status, method) => {
      const seen: string[] = [];
      const server = createServer((q, r) => {
        seen.push(q.method!);
        if (q.url === '/start') { r.writeHead(Number(status), {location: '/landing?private=QUERY_SECRET#FRAGMENT_SECRET'}); r.end('redirect'); }
        else { r.writeHead(201, {'content-type': 'text/plain; charset=utf-8', 'set-cookie': 'sid=COOKIE_SECRET'}); r.end('final-body'); }
      });
      const port = await listen(server), origin = `http://127.0.0.1:${port}`;
      try {
        const c = await capture(origin, {url: origin + '/start', method: 'POST', body: 'BODY_SECRET', headers: {Authorization: 'AUTH_SECRET'}, follow_redirects: true});
        expect(seen).toEqual(['POST', method]);
        expect(c.bytes.toString()).toBe('final-body'); expect(c.complete).toBe(true);
        expect(c.http).toEqual({method, status: 201,
          target: {scopeOrigin: origin, originStatus: 'scope_bound', path: null, pathStatus: 'omitted_unattested',
            omitted: {userinfo: false, query: true, fragment: true}},
          contentType: {value: 'text/plain; charset=utf-8', status: 'present'}});
        for (const secret of ['QUERY_SECRET','FRAGMENT_SECRET','COOKIE_SECRET','BODY_SECRET','AUTH_SECRET','/landing']) expect(JSON.stringify(c.http)).not.toContain(secret);
      } finally { await new Promise<void>(done => server.close(() => done())); }
    });

  it('binds stopped redirects to the last received response, never the unrequested target', async () => {
    let hops = 0;
    const server = createServer((q, r) => {
      hops++;
      if (q.url === '/scope') r.writeHead(302, {location: 'http://user:USERINFO_SECRET@outside.invalid/PATH_SECRET?QUERY_SECRET#FRAGMENT_SECRET'});
      else r.writeHead(303, {location: `/loop-${hops}`});
      r.end('last-' + hops);
    });
    const port = await listen(server), origin = `http://127.0.0.1:${port}`;
    try {
      const stopped = await capture(origin, {url: origin + '/scope', method: 'POST', follow_redirects: true});
      expect(hops).toBe(1); expect(stopped.http?.method).toBe('POST'); expect(stopped.http?.status).toBe(302);
      expect(stopped.http?.target.scopeOrigin).toBe(origin); expect(stopped.http?.contentType).toEqual({value: null, status: 'missing'});
      expect(stopped.bytes.toString()).toBe('last-1'); expect(JSON.stringify(stopped.http)).not.toContain('SECRET');
      hops = 0;
      const limited = await capture(origin, {url: origin + '/loop', method: 'POST', follow_redirects: true});
      expect(hops).toBe(MAX_REDIRECTS + 1); expect(limited.result.redirectChain.at(-1)?.stopped).toBe('hop_limit');
      expect(limited.http?.method).toBe('GET'); expect(limited.http?.status).toBe(303);
      expect(limited.bytes.toString()).toBe('last-6'); expect(limited.http?.target.path).toBeNull();
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });

  it('omits unattested paths and overlong or known-secret selected fields; retains body truncation', async () => {
    const server = createServer((q, r) => {
      if (q.url?.startsWith('/long')) { r.setHeader('content-type', 'x'.repeat(MAX_HEADER_VALUE + 1)); r.end('x'.repeat(MAX_SAVED_BODY + 1)); }
      else { r.setHeader('content-type', 'text/plain; secret=KNOWN_SECRET'); r.end('small'); }
    });
    const port = await listen(server), origin = `http://127.0.0.1:${port}`;
    try {
      const long = await capture(origin, {url: origin + '/long/innocent-looking-but-secret?token=QUERY_SECRET#FRAGMENT_SECRET'});
      expect(long.complete).toBe(false); expect(long.bytes.length).toBe(MAX_SAVED_BODY);
      expect(long.http?.contentType).toEqual({value: null, status: 'omitted_over_limit'});
      expect(long.http?.target).toEqual({scopeOrigin: origin, originStatus: 'scope_bound', path: null, pathStatus: 'omitted_unattested', omitted: {userinfo: false, query: true, fragment: true}});
      const known = await capture(origin, {url: origin + '/plain'}, ['KNOWN_SECRET', origin]);
      expect(known.http?.contentType).toEqual({value: null, status: 'redacted'});
      expect(known.http?.target.scopeOrigin).toBeNull(); expect(known.http?.target.originStatus).toBe('redacted');
      expect(JSON.stringify(known.http)).not.toContain('KNOWN_SECRET');
    } finally { await new Promise<void>(done => server.close(() => done())); }
  });
});
