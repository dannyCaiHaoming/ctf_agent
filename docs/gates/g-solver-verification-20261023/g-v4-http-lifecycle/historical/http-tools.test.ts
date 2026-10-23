import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stat, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { CookieJar, createHttpTools, MAX_SAVED_BODY } from '../../apps/launcher/src/http-tools.js';

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
  return createHttpTools({ target, jar: options.jar ?? new CookieJar(), workDir: root, resolve: options.resolve });
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
