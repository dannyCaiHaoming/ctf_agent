// G design §5.6 / §4.6: run-level accounting of what http.request actually sent to each challenge target.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, validateHeaderName, validateHeaderValue, type IncomingHttpHeaders, type RequestOptions, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { HttpLedger, HTTP_LEDGER_MAX_TIMES, type HttpLedgerChallenge } from '../../apps/launcher/src/http-ledger.js';
import { CookieJar, createHttpTools, MAX_REDIRECTS } from '../../apps/launcher/src/http-tools.js';
import { ControlService, DEFAULT_HTTP_LIMITS, type RunBudget } from '../../apps/launcher/src/control-service.js';
import { loadReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.js';

const stubs = vi.hoisted(() => ({
  request: undefined as ((url: URL, options: RequestOptions, respond: (response: EventEmitter) => void) => EventEmitter) | undefined,
  dns: undefined as (() => Promise<{ address: string; family: number }[]>) | undefined,
  beforeMkdir: undefined as ((path: string) => Promise<void> | undefined) | undefined
}));
vi.mock('node:http', async original => {
  const http = await original<typeof import('node:http')>();
  return { ...http, request: (url: URL, options: RequestOptions, respond: (response: EventEmitter) => void) =>
    stubs.request ? stubs.request(url, options, respond) : http.request(url, options, respond) };
});
vi.mock('node:dns/promises', async original => {
  const dns = await original<typeof import('node:dns/promises')>();
  return { ...dns, lookup: (host: string, options: { all: true; verbatim: boolean }) =>
    stubs.dns ? stubs.dns() : dns.lookup(host, options) };
});
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
    const held = stubs.beforeMkdir?.(String(args[0]));
    if (held) await held;
    return fs.mkdir(...args);
  } };
});

const servers: Server[] = [];
const services: ControlService[] = [];
afterAll(async () => {
  await Promise.all(services.map(s => s.stopAll('test end')));
  for (const s of servers) { s.close(); s.closeAllConnections?.(); }
});

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function serve(handler: (path: string, res: ServerResponse) => void): Promise<{ origin: string; requests: () => number }> {
  let requests = 0;
  const server = createServer((req, res) => { requests++; handler(req.url ?? '/', res); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests: () => requests };
}

describe('HttpLedger', () => {
  it('counts calls, hops, unresolved hops and peaks per challenge', () => {
    let now = 1_000_000;
    const ledger = new HttpLedger(() => now, null, () => now);
    ledger.registered('A', 'http://127.0.0.1:8080/x');
    ledger.registered('A');
    ledger.denied('A', 'http limit');
    for (let i = 0; i < 5; i++) { ledger.hopStarted('A'); now += 100; }   // 5 hops inside 500 ms
    now += 2000;
    ledger.hopStarted('A');                                                // 6th, alone in its second
    for (let i = 0; i < 5; i++) ledger.hopResponded('A');
    ledger.settled('A', 'completed');
    const snap = ledger.snapshot();
    expect(snap.limits).toBeNull();
    const a = snap.challenges[0]!;
    expect(a.origin).toBe('http://127.0.0.1:8080');
    expect(a.calls).toEqual({ registered: 2, deniedBeforeRegistration: { 'http limit': 1 }, results: { completed: 1 }, unsettled: 1 });
    expect(a.hops).toEqual({ started: 6, responded: 5, unresolved: 1, rejected: {} });
    expect(a.peaks).toEqual({ perSecond: 5, perMinute: 6, basis: 'all_hops' });
    expect(snap.totals).toEqual({ registered: 2, hopsStarted: 6, hopsResponded: 5, hopsUnresolved: 1, hopsRejected: 0 });
  });

  it('uses monotonic windows and retains the first and last hop wall timestamps across clock changes', () => {
    let monotonic = 0;
    let wall = 1_000_000;
    const ledger = new HttpLedger(() => wall, null, () => monotonic);
    ledger.hopStarted('A');
    monotonic = 999; wall = 2_000_000; ledger.hopStarted('A');
    monotonic = 1000; wall = 3_000_000; ledger.hopStarted('A');
    monotonic = 60_000; wall = 500_000; ledger.hopStarted('A');
    const a = ledger.snapshot().challenges[0]!;
    expect(a.peaks).toEqual({ perSecond: 2, perMinute: 3, basis: 'all_hops' });
    expect(a.firstHopAt).toBe(new Date(1_000_000).toISOString());
    expect(a.lastHopAt).toBe(new Date(500_000).toISOString());
  });

  it('keeps counting past the time cap and says the peaks cover only the first hops', () => {
    let now = 0;
    const ledger = new HttpLedger(() => now, null, () => Math.min(now, HTTP_LEDGER_MAX_TIMES) * 60_000);
    for (; now < HTTP_LEDGER_MAX_TIMES + 3; now++) ledger.hopStarted('B');
    const b = ledger.snapshot().challenges[0]!;
    expect(b.hops.started).toBe(HTTP_LEDGER_MAX_TIMES + 3);
    expect(b.peaks).toEqual({ perSecond: 1, perMinute: 1, basis: 'first_hops_only' });
    expect(b.lastHopAt).toBe(new Date(HTTP_LEDGER_MAX_TIMES + 2).toISOString());
  });
});

describe('http adapter hop events', () => {
  async function hops(target: string, args: Record<string, unknown>) {
    const events: string[] = [];
    const adapter = createHttpTools({ target, jar: new CookieJar(), workDir: await mkdtemp(join(tmpdir(), 'http-ledger-')) });
    const outcome = await adapter.request(args, { run: 'r', sessionID: 's', callID: 'c', signal: new AbortController().signal,
      deadline: Date.now() + 10000, onHop: e => events.push(e) }).then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
    return { outcome, started: events.filter(e => e === 'started').length, responded: events.filter(e => e === 'responded').length };
  }

  it('reports each followed in-scope hop, and never an out-of-scope redirect', async () => {
    const other = await serve((_p, res) => res.end('outside'));
    const target = await serve((path, res) => {
      if (path === '/hop') { res.writeHead(302, { location: '/end' }); res.end(); return; }
      if (path === '/out') { res.writeHead(302, { location: `${other.origin}/x` }); res.end(); return; }
      res.end('ok');
    });
    expect(await hops(target.origin, { url: `${target.origin}/plain` })).toEqual({ outcome: 'ok', started: 1, responded: 1 });
    expect(await hops(target.origin, { url: `${target.origin}/hop`, follow_redirects: true })).toEqual({ outcome: 'ok', started: 2, responded: 2 });
    expect(await hops(target.origin, { url: `${target.origin}/out`, follow_redirects: true })).toEqual({ outcome: 'ok', started: 1, responded: 1 });
    expect(other.requests()).toBe(0);
  });

  it('leaves a hop unresolved when the response never completes', async () => {
    const target = await serve((_p, res) => { res.writeHead(200); res.write('partial'); /* never ends */ });
    expect(await hops(target.origin, { url: `${target.origin}/slow`, timeout_ms: 300 })).toEqual({ outcome: 'timeout', started: 1, responded: 0 });
  });
});

type HttpBudget = Pick<RunBudget, 'httpRatePerSecond' | 'httpBurst' | 'maxHttpHops'>;

async function fixture(target: string | string[], limits: HttpBudget = {}, httpMonotonicNow?: () => number) {
  const root = await mkdtemp(join(tmpdir(), 'http-ledger-c-'));
  const challenges = await Promise.all((typeof target === 'string' ? [target] : target).map(async (url, index) => {
    const id = ['X', 'Y', 'Z'][index]!;
    const materialsDir = join(root, id, 'materials');
    await mkdir(materialsDir, { recursive: true });
    const { hostname, port } = new URL(url);
    return { id, title: null, target: { protocol: 'http' as const, url, host: hostname, port: Number(port || 80) }, reachability: null, materials: [], materialsDir };
  }));
  const workdir = join(root, 'opencode'); await mkdir(workdir, { recursive: true });
  const skillRoot = join(workdir, 'config/opencode/skills'); await mkdir(skillRoot, { recursive: true });
  const roles = new Map<string, string>();
  const client = { session: {
    get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, parentID: 'root', agent: roles.get(sessionID) } }),
    children: async () => ({ data: [] }), abort: async () => ({ data: true }), messages: async () => ({ data: [] }),
  } };
  const service = new ControlService({ runId: 'http-ledger', client: client as never, budget: { maxModelCalls: 100, maxObservableTokens: 100000, ...limits },
    expiresAt: Date.now() + 60000, workdir, skillRoot, challenges, httpMonotonicNow });
  services.push(service); service.bindRoot('root');
  let n = 0;
  const exec = (sid: string, tool: string, args: object = {}) => service.handle(sid, 'tool.execute', { tool, args, callID: `c${++n}` });
  async function bind(sid: string, challenge: string) {
    roles.set(sid, 'domain-solver');
    await exec('root', 'challenge.assign', { role: 'domain-solver', challenge });
    const callID = `dispatch-${sid}`;
    await service.handle('root', 'tool.before', { tool: 'task', callID, args: { subagent_type: 'domain-solver', background: true } });
    await service.handle('root', 'tool.after', { tool: 'task', callID, metadata: { sessionId: sid }, output: 'running' });
    await service.handle(sid, 'chat.message', { agent: 'domain-solver' });
  }
  await bind('solver', 'X');
  return { service, exec, bind };
}

describe('control service writes the ledger', () => {

  it('counts completed calls, the concurrency refusal and every hop', async () => {
    const held: ServerResponse[] = [];
    const target = await serve((path, res) => { if (path === '/hold') held.push(res); else res.end('ok'); });
    const { service, exec } = await fixture(target.origin);
    await exec('solver', 'http.request', { url: `${target.origin}/a` });
    const pending = Array.from({ length: 8 }, () => exec('solver', 'http.request', { url: `${target.origin}/hold` }));
    while (held.length < 8) await new Promise(r => setTimeout(r, 10));
    await expect(exec('solver', 'http.request', { url: `${target.origin}/b` })).rejects.toThrow('http limit');
    for (const res of held) res.end('released');
    await Promise.all(pending);
    const x = service.httpLedgerSnapshot().challenges.find(c => c.challengeId === 'X')!;
    expect(x.origin).toBe(target.origin);
    expect(x.calls).toEqual({ registered: 9, deniedBeforeRegistration: { 'http limit': 1 }, results: { completed: 9 }, unsettled: 0 });
    expect(x.hops).toEqual({ started: 9, responded: 9, unresolved: 0, rejected: {} });
    expect(target.requests()).toBe(9);
    expect(service.httpLedgerSnapshot().limits).toEqual(DEFAULT_HTTP_LIMITS);
  });
});

describe('G §4.6 shared HTTP limits', () => {
  it('explains an unsent rate-limited hop after a redirect was already sent', async () => {
    const target = await serve((_p, res) => { res.writeHead(302, { location: '/next' }); res.end(); });
    const { service, exec } = await fixture(target.origin, { httpBurst: 1 }, () => 0);
    await expect(exec('solver', 'http.request', { url: target.origin, follow_redirects: true })).rejects.toHaveProperty('message',
      'denied: http rate. the per-target rate limit refused this HTTP hop before it was sent. Earlier hops may already have been sent.');
    expect(target.requests()).toBe(1);
    expect(service.httpLedgerSnapshot().challenges[0]?.hops).toEqual({ started: 1, responded: 1, unresolved: 0, rejected: { 'http rate': 1 } });
  });

  it('excludes unrequested out-of-scope and over-limit redirects from the ledger', async () => {
    const outside = await serve((_path, res) => res.end('outside'));
    const target = await serve((path, res) => {
      res.writeHead(302, { location: path === '/outside' ? outside.origin + '/' : '/loop' });
      res.end();
    });
    const { service, exec } = await fixture(target.origin);
    const request = (path: string) => exec('solver', 'http.request', { url: target.origin + path, follow_redirects: true });
    await expect(request('/outside')).resolves.toMatchObject({ redirectChain: expect.arrayContaining([{ origin: outside.origin, path: '/', status: null, stopped: 'out_of_scope' }]) });
    expect(service.httpLedgerSnapshot().challenges[0]?.hops).toEqual({ started: 1, responded: 1, unresolved: 0, rejected: {} });
    await expect(request('/loop')).resolves.toMatchObject({ redirectChain: expect.arrayContaining([{ origin: target.origin, path: '/loop', status: null, stopped: 'hop_limit' }]) });
    expect(service.httpLedgerSnapshot().challenges[0]?.hops).toEqual({ started: MAX_REDIRECTS + 2, responded: MAX_REDIRECTS + 2, unresolved: 0, rejected: {} });
    expect(target.requests()).toBe(MAX_REDIRECTS + 2);
    expect(outside.requests()).toBe(0);
  });

  it('counts every redirect hop toward the run total and stops mid-chain without sending', async () => {
    const target = await serve((path, res) => {
      const n = Number(path.slice(1)) || 0;
      if (n < 5) { res.writeHead(302, { location: `/${n + 1}` }); res.end(); } else res.end('end');
    });
    const { service, exec } = await fixture(target.origin, { maxHttpHops: 3 });
    await expect(exec('solver', 'http.request', { url: `${target.origin}/0`, follow_redirects: true })).rejects.toThrow('denied: http run total');
    expect(target.requests()).toBe(3);
    await expect(exec('solver', 'http.request', { url: `${target.origin}/5` })).rejects.toHaveProperty('message',
      'denied: http run total. this run has used up its total of HTTP hops to targets. No further hop can be sent.');
    expect(target.requests()).toBe(3);
    const snap = service.httpLedgerSnapshot();
    const x = snap.challenges[0]!;
    expect(x.calls).toEqual({ registered: 1, deniedBeforeRegistration: { 'http run total': 1 }, results: { 'http run total': 1 }, unsettled: 0 });
    expect(x.hops).toEqual({ started: 3, responded: 3, unresolved: 0, rejected: { 'http run total': 1 } });
    expect(snap.limits).toEqual({ ...DEFAULT_HTTP_LIMITS, maxHopsPerRun: 3 });
  });
});

describe('HTTP accounting without sockets', () => {
  const target = 'http://127.0.0.1:9';
  const opened = vi.fn();
  const lookupResult = [{ address: '127.0.0.1', family: 4 }];
  const challenge = (service: ControlService, id = 'X'): HttpLedgerChallenge =>
    service.httpLedgerSnapshot().challenges.find(c => c.challengeId === id)!;

  beforeEach(() => {
    opened.mockClear();
    stubs.dns = async () => lookupResult;
    stubs.request = (url, options, respond) => {
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        validateHeaderName(name);
        if (typeof value === 'string') validateHeaderValue(name, value);
      }
      opened(url.origin);
      let closed = false;
      const req = Object.assign(new EventEmitter(), {
        end: () => queueMicrotask(() => {
          if (closed) return;
          if (url.pathname === '/connection-error') {
            req.emit('error', new Error('synthetic connection failure'));
            return;
          }
          const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} as IncomingHttpHeaders });
          respond(res);
          res.emit('data', Buffer.from('ok'));
          res.emit('end');
        }),
        destroy: () => { if (!closed) { closed = true; req.emit('close'); } }
      });
      return req;
    };
  });
  afterEach(() => {
    stubs.request = undefined;
    stubs.dns = undefined;
    stubs.beforeMkdir = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects invalid header names before attempting to create a request or consuming either limit', async () => {
    const { service, exec } = await fixture(target, { httpBurst: 1, maxHttpHops: 1 }, () => 0);
    for (const name of ['bad name', '', 'bad:name', 'bad\n', 'x-K']) {
      await expect(exec('solver', 'http.request', { url: target, headers: { [name]: 'value' } })).rejects.toThrow('denied: header');
    }
    expect(opened).not.toHaveBeenCalled();
    expect(challenge(service).hops).toEqual({ started: 0, responded: 0, unresolved: 0, rejected: {} });
    await expect(exec('solver', 'http.request', { url: target, headers: { 'X-test_1!': 'value' } })).resolves.toMatchObject({ status: 200 });
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('refunds both limits on synchronous construction failure before the request is created', async () => {
    const { service, exec } = await fixture(target, { httpBurst: 1, maxHttpHops: 1 }, () => 0);
    await expect(exec('solver', 'http.request', { url: target, headers: { 'x-fixture': '☃' } })).rejects.toThrow('denied: network');
    expect(challenge(service).hops).toEqual({ started: 0, responded: 0, unresolved: 0, rejected: {} });
    expect(challenge(service).calls.results).toEqual({ network: 1 });
    await expect(exec('solver', 'http.request', { url: target })).resolves.toMatchObject({ status: 200 });
    expect(challenge(service).hops).toEqual({ started: 1, responded: 1, unresolved: 0, rejected: {} });
  });

  it('keeps the hop charged when the created request fails to connect', async () => {
    const { service, exec } = await fixture(target, { maxHttpHops: 1 });
    await expect(exec('solver', 'http.request', { url: target + '/connection-error' })).rejects.toThrow('denied: network');
    expect(challenge(service).hops).toEqual({ started: 1, responded: 0, unresolved: 1, rejected: {} });
    await expect(exec('solver', 'http.request', { url: target })).rejects.toThrow('denied: http run total');
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('refills at one token, clamps at burst and ignores wall clock jumps', async () => {
    let monotonic = 0;
    const wallStart = Date.now();
    const wall = vi.spyOn(Date, 'now').mockReturnValue(wallStart);
    const { service, exec } = await fixture(target, { httpRatePerSecond: 2, httpBurst: 2 }, () => monotonic);
    const send = () => exec('solver', 'http.request', { url: target });
    await send();
    await send();
    wall.mockReturnValue(wallStart + 10_000);
    await expect(send()).rejects.toThrow('denied: http rate');
    monotonic = 499;
    wall.mockReturnValue(wallStart - 10_000);
    await expect(send()).rejects.toThrow('denied: http rate');
    monotonic = 500;
    await send();
    await expect(send()).rejects.toThrow('denied: http rate');
    monotonic = 100_000;
    await send();
    await send();
    await expect(send()).rejects.toThrow('denied: http rate');
    expect(opened).toHaveBeenCalledTimes(5);
    expect(challenge(service).hops).toEqual({ started: 5, responded: 5, unresolved: 0, rejected: { 'http rate': 4 } });
  });

  it('shares a normalized origin across challenges while leaving another origin its own burst', async () => {
    const first = 'http://shared.example.test';
    const second = 'HTTP://SHARED.example.test:80/fixture';
    const third = 'http://other.example.test';
    const { service, exec, bind } = await fixture([first, second, third], { httpBurst: 1 }, () => 0);
    await bind('shared', 'Y');
    await bind('other', 'Z');
    await exec('solver', 'http.request', { url: first });
    await expect(exec('shared', 'http.request', { url: second })).rejects.toThrow('denied: http rate');
    await exec('other', 'http.request', { url: third });
    expect(opened.mock.calls).toEqual([[first], [third]]);
    expect(challenge(service, 'Y')).toMatchObject({ origin: first, hops: { started: 0, rejected: { 'http rate': 1 } } });
  });

  it('charges one of two registered rivals the final hop and keeps unknown cleanup unsettled until confirmed', async () => {
    const host = 'http://shared.example.test';
    const { service, exec, bind } = await fixture([host, host], { maxHttpHops: 1 });
    await bind('unknown', 'Y');
    const preparing = gate();
    const resumePreparation = gate();
    const bothResolving = gate();
    const resumeDns = gate();
    let resolving = 0;
    stubs.beforeMkdir = path => {
      if (!path.endsWith('/work/unknown')) return;
      preparing.resolve();
      return resumePreparation.promise;
    };
    stubs.dns = async () => {
      if (++resolving === 2) bothResolving.resolve();
      await resumeDns.promise;
      return lookupResult;
    };
    const send = (session = 'solver') => exec(session, 'http.request', { url: host });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unknown = send('unknown').catch(error => error);
    try {
      await preparing.promise;
      const revoked = service.revoke('unknown');
      await vi.advanceTimersByTimeAsync(4000);
      await revoked;
      expect(challenge(service, 'Y').calls).toEqual({ registered: 1, deniedBeforeRegistration: {}, results: {}, unsettled: 1 });
      expect(service.resourceSnapshot()).toMatchObject([{ state: 'unknown', result: 'cleanup_unknown' }]);

      const rivals = Promise.allSettled([send(), send()]);
      await bothResolving.promise;
      expect(challenge(service).calls).toMatchObject({ registered: 2, unsettled: 2 });
      resumeDns.resolve();
      expect((await rivals).map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(opened).toHaveBeenCalledTimes(1);
      const resources = service.resourceSnapshot();
      await expect(send()).rejects.toThrow('denied: http run total');
      expect(service.resourceSnapshot()).toEqual(resources);
      expect(challenge(service).calls).toEqual({ registered: 2, deniedBeforeRegistration: { 'http run total': 1 }, results: { completed: 1, 'http run total': 1 }, unsettled: 0 });
      expect(challenge(service).hops).toEqual({ started: 1, responded: 1, unresolved: 0, rejected: { 'http run total': 1 } });
      expect(challenge(service, 'Y').calls.unsettled).toBe(1);
    } finally {
      resumeDns.resolve();
      resumePreparation.resolve();
      expect(await unknown).toHaveProperty('message', 'denied: cancelled');
    }
    expect(service.resourceSnapshot().find(r => r.sessionID === 'unknown')).toMatchObject({ state: 'settled', result: 'cancelled' });
    expect(service.resourceSnapshot().every(r => r.state === 'settled')).toBe(true);
    expect(challenge(service, 'Y').calls).toEqual({ registered: 1, deniedBeforeRegistration: {}, results: { cancelled: 1 }, unsettled: 0 });
    expect(challenge(service, 'Y').hops).toEqual({ started: 0, responded: 0, unresolved: 0, rejected: {} });
  });

  it('cancels during DNS without creating a hop or continuing after resolution', async () => {
    const host = 'http://dns.example.test';
    const { service, exec } = await fixture(host);
    const resolving = gate();
    const addresses = gate<typeof lookupResult>();
    stubs.dns = () => { resolving.resolve(); return addresses.promise; };
    const work = exec('solver', 'http.request', { url: host }).catch(error => error);
    await resolving.promise;
    try {
      await service.revoke('solver');
      expect(await work).toHaveProperty('message', 'denied: cancelled');
    } finally { addresses.resolve(lookupResult); }
    await Promise.resolve();
    expect(opened).not.toHaveBeenCalled();
    expect(challenge(service).hops).toEqual({ started: 0, responded: 0, unresolved: 0, rejected: {} });
    expect(challenge(service).calls).toMatchObject({ results: { cancelled: 1 }, unsettled: 0 });
  });
});

describe('release profile HTTP limit fields', () => {
  it('requires finite positive rates, positive safe integer counts and known budget fields', async () => {
    const base = JSON.parse(await readFile('config/release-profile.m1-opencode.example.json', 'utf8'));
    const dir = await mkdtemp(join(tmpdir(), 'http-ledger-profile-'));
    const path = join(dir, 'profile.json');
    const load = async (budget: Record<string, unknown>) => {
      await writeFile(path, JSON.stringify({ ...base, budget: { ...base.budget, ...budget } }).replace('"overflow"', '1e999'));
      return loadReleaseProfile(path);
    };
    const valid = { httpRatePerSecond: 0.5, httpBurst: Number.MAX_SAFE_INTEGER, maxHttpHops: Number.MAX_SAFE_INTEGER };
    await expect(load(valid)).resolves.toMatchObject({ budget: valid });
    for (const [key, values] of Object.entries({
      httpRatePerSecond: [0, -0.5, '1', 'overflow', null],
      httpBurst: [0, 2.5, Number.MAX_SAFE_INTEGER + 1, null],
      maxHttpHops: [-1, 0.5, '10', Number.MAX_SAFE_INTEGER + 1]
    })) {
      for (const value of values) await expect(load({ [key]: value })).rejects.toThrow(`invalid budget.${key}`);
    }
    await expect(load({ maxHttpHop: 1 })).rejects.toThrow('unknown budget field maxHttpHop');
  });

  it('declares the same HTTP limits in the JSON schema', async () => {
    const schema = JSON.parse(await readFile('config/release-profile.schema.json', 'utf8'));
    const count = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
    expect(schema.properties.budget).toMatchObject({ additionalProperties: false, properties: {
      httpRatePerSecond: { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_VALUE },
      httpBurst: count, maxHttpHops: count
    } });
  });

  it('validates the same HTTP bounds when constructing ControlService directly', async () => {
    const target = 'http://127.0.0.1:9';
    const valid = { httpRatePerSecond: 0.5, httpBurst: Number.MAX_SAFE_INTEGER, maxHttpHops: Number.MAX_SAFE_INTEGER };
    const { service } = await fixture(target, valid);
    expect(service.httpLedgerSnapshot().limits).toEqual({ perSecond: 0.5, burst: valid.httpBurst, maxHopsPerRun: valid.maxHttpHops });
    const cases: [keyof HttpBudget, string, unknown[]][] = [
      ['httpRatePerSecond', 'perSecond', [0, -1, NaN, Infinity, '0.5', null]],
      ['httpBurst', 'burst', [0, 1.5, Number.MAX_SAFE_INTEGER + 1, null]],
      ['maxHttpHops', 'maxHopsPerRun', [0, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, null]]
    ];
    for (const [key, limit, values] of cases) {
      for (const value of values) {
        const outcome = await fixture(target, { [key]: value }).then(() => 'accepted', (error: Error) => error.message);
        expect(outcome).toBe(`invalid http limit ${limit}`);
      }
    }
  });
});
