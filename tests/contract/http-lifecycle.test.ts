import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket, type AddressInfo } from 'node:net';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar, createHttpTools } from '../../apps/launcher/src/http-tools.js';

// Replace only the filesystem wait, keeping real sockets and normal file writes elsewhere.
const fileBoundary = vi.hoisted(() => ({ wait: undefined as undefined | (() => Promise<void>) }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    if (fileBoundary.wait) await fileBoundary.wait();
    return actual.writeFile(...args);
  } };
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
const roots: string[] = [];
const servers: (Server | TcpServer)[] = [];
const sockets = new Set<Socket>();
async function listen(server: Server | TcpServer, port = 0, host = '127.0.0.1') {
  servers.push(server);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((r, reject) => { server.once('error', reject); server.listen(port, host, r); });
  return (server.address() as AddressInfo).port;
}
async function root() { const dir = await mkdtemp(join(tmpdir(), 'g-v4-lifecycle-')); roots.push(dir); return dir; }
afterEach(async () => {
  vi.useRealTimers();
  fileBoundary.wait = undefined;
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(r => server.close(() => r()))));
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

// C §7.2 boundary substitute ONLY: production C/RPC does not call this fixture.
// It registers before adapter startup; trusted identity never comes from args.
class HostBoundary {
  private stoppedRuns = new Set<string>();
  private stoppedSessions = new Set<string>();
  active = new Map<string, { run: string; sessionID: string; controller: AbortController }>();
  results: { callID: string; result: string }[] = [];
  private sequence = 0;
  async request(tools: ReturnType<typeof createHttpTools>, args: Record<string, unknown>,
    run = 'r1', sessionID = 's1', deadline = Date.now() + 5000) {
    if (this.stoppedRuns.has(run) || this.stoppedSessions.has(`${run}/${sessionID}`)) return 'stopped';
    if (this.active.size >= 8) return 'capacity';
    const callID = `call-${++this.sequence}`;
    const controller = new AbortController();
    this.active.set(callID, { run, sessionID, controller });
    const result = await outcome(tools.request(args, { run, sessionID, callID, signal: controller.signal, deadline }));
    this.results.push({ callID, result }); // preserve terminal outcome BEFORE releasing quota
    if (result !== 'cleanup_unknown') this.active.delete(callID); // unknown resources stay reserved for host reconciliation
    return result;
  }
  stopSession(run: string, sessionID: string) {
    this.stoppedSessions.add(`${run}/${sessionID}`);
    for (const op of this.active.values()) if (op.run === run && op.sessionID === sessionID) op.controller.abort();
  }
  stopRun(run: string) {
    this.stoppedRuns.add(run);
    for (const op of this.active.values()) if (op.run === run) op.controller.abort();
  }
}
async function tools(target: string, resolve?: (host: string) => Promise<string[]>) {
  return createHttpTools({ target, jar: new CookieJar(), workDir: await root(), resolve });
}

// Removing AbortSignal handling makes these requests connect after stop, or leaves active slots.
describe('G-V4 trusted HTTP lifecycle boundary', () => {
  it('DNS cancellation settles before release; both authorized and outside servers receive zero connections', async () => {
    let allowed = 0, outside = 0;
    const a = await listen(createServer((_q, r) => r.end('a')).on('connection', () => allowed++));
    await listen(createServer((_q, r) => r.end('b')).on('connection', () => outside++));
    const gate = deferred<string[]>();
    const host = new HostBoundary();
    const adapter = await tools(`http://fixture.test:${a}`, () => gate.promise);
    const pending = host.request(adapter, { url: `http://fixture.test:${a}` });
    host.stopSession('r1', 's1');
    let settled = false;
    pending.then(() => { settled = true; });
    await new Promise<void>(r => setImmediate(r));
    const beforeRelease = { settled, active: host.active.size };
    gate.resolve(['127.0.0.1']);
    const result = await pending;
    expect({ result, beforeRelease, allowed, outside, results: host.results.length })
      .toEqual({ result: 'cancelled', beforeRelease: { settled: true, active: 0 }, allowed: 0, outside: 0, results: 1 });
  });

  it('host deadline expires while DNS waits; released DNS cannot open a socket', async () => {
    let connections = 0;
    const port = await listen(createServer((_q, r) => r.end()).on('connection', () => connections++));
    const gate = deferred<string[]>();
    const host = new HostBoundary();
    const adapter = await tools(`http://fixture.test:${port}`, () => gate.promise);
    vi.useFakeTimers();
    const pending = host.request(adapter, { url: `http://fixture.test:${port}`, timeout_ms: 1000 }, 'r1', 's1', Date.now() + 10);
    await vi.advanceTimersByTimeAsync(10);
    const beforeRelease = host.active.size;
    gate.resolve(['127.0.0.1']);
    vi.useRealTimers();
    expect({ result: await pending, beforeRelease, connections }).toEqual({ result: 'timeout', beforeRelease: 0, connections: 0 });
  });

  it('cancels during TLS connection handshake and closes the real socket', async () => {
    const connected = deferred();
    const closed = deferred();
    const port = await listen(createTcpServer(socket => {
      connected.resolve(); socket.on('close', () => closed.resolve()); socket.resume();
    }));
    const host = new HostBoundary();
    const adapter = await tools(`https://127.0.0.1:${port}`);
    const pending = host.request(adapter, { url: `https://127.0.0.1:${port}` });
    await connected.promise;
    host.stopSession('r1', 's1');
    const result = await pending;
    await closed.promise;
    expect({ result, active: host.active.size }).toEqual({ result: 'cancelled', active: 0 });
  });

  it('cancels body reading, destroys the socket, records once and frees capacity', async () => {
    const reading = deferred(); const closed = deferred();
    const port = await listen(createServer((_q, res) => {
      res.writeHead(200); res.write('partial'); reading.resolve(); res.on('close', () => closed.resolve());
    }));
    const host = new HostBoundary(); const adapter = await tools(`http://127.0.0.1:${port}`);
    const pending = host.request(adapter, { url: `http://127.0.0.1:${port}` });
    await reading.promise; host.stopRun('r1');
    const result = await pending; await closed.promise;
    expect({ result, active: host.active.size, records: host.results.length }).toEqual({ result: 'cancelled', active: 0, records: 1 });
  });

  it('cancels while resolving a redirect and never starts the next hop', async () => {
    let requests = 0;
    const port = await listen(createServer((_q, res) => { requests++; res.writeHead(302, { location: '/next' }); res.end(); }));
    const second = deferred(); const gate = deferred<string[]>(); let count = 0;
    const adapter = await tools(`http://fixture.test:${port}`, async () => {
      if (++count === 1) return ['127.0.0.1']; second.resolve(); return gate.promise;
    });
    const host = new HostBoundary();
    const pending = host.request(adapter, { url: `http://fixture.test:${port}`, follow_redirects: true });
    await second.promise; host.stopSession('r1', 's1');
    // Await actual request/socket teardown before releasing DNS, rather than assuming one event-loop turn.
    const result = await pending;
    const activeBeforeRelease = host.active.size; gate.resolve(['127.0.0.1']);
    expect({ result, activeBeforeRelease, requests }).toEqual({ result: 'cancelled', activeBeforeRelease: 0, requests: 1 });
  });

  it('keeps one deadline across redirects instead of restarting timeout on each hop', async () => {
    const reached = deferred(); const allowRedirect = deferred(); const reading = deferred();
    const port = await listen(createServer((q, res) => {
      if (q.url === '/start') { reached.resolve(); void allowRedirect.promise.then(() => { res.writeHead(302, { location: '/body' }); res.end(); }); }
      else { res.writeHead(200); res.write('waiting'); reading.resolve(); }
    }));
    const host = new HostBoundary(); const adapter = await tools(`http://127.0.0.1:${port}`);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pending = host.request(adapter, { url: `http://127.0.0.1:${port}/start`, follow_redirects: true, timeout_ms: 100 });
    await reached.promise; await vi.advanceTimersByTimeAsync(70); allowRedirect.resolve();
    await reading.promise; await vi.advanceTimersByTimeAsync(30);
    expect({ result: await pending, active: host.active.size }).toEqual({ result: 'timeout', active: 0 });
  });

  it('pins a real socket to verified A and never connects to B after DNS changes', async () => {
    let a = 0, b = 0; const local: string[] = [];
    const port = await listen(createServer((q, r) => { local.push(q.socket.localAddress!); r.end('A'); }).on('connection', () => a++));
    await listen(createServer((_q, r) => r.end('B')).on('connection', () => b++), port, '::1');
    let answer = '127.0.0.1'; let calls = 0;
    const adapter = await tools(`http://fixture.test:${port}`, async () => { calls++; const verified = answer; answer = '::1'; return [verified]; });
    const host = new HostBoundary();
    expect({ result: await host.request(adapter, { url: `http://fixture.test:${port}` }), a, b, local, calls })
      .toEqual({ result: 'ok', a: 1, b: 0, local: ['127.0.0.1'], calls: 1 });
  });

  it('isolates session and run stop; refuses stopped sessions before DNS and releases 8 slots', async () => {
    let connections = 0;
    const port = await listen(createServer((_q, r) => r.end('ok')).on('connection', () => connections++));
    const gate = deferred<string[]>(); const adapter = await tools(`http://fixture.test:${port}`, () => gate.promise);
    const host = new HostBoundary();
    const first = host.request(adapter, { url: `http://fixture.test:${port}` }, 'r1', 's1');
    const second = host.request(adapter, { url: `http://fixture.test:${port}` }, 'r1', 's2');
    const third = host.request(adapter, { url: `http://fixture.test:${port}` }, 'r2', 's1');
    const rest = Array.from({ length: 5 }, () => host.request(adapter, { url: `http://fixture.test:${port}` }, 'r1', 's1'));
    expect(await host.request(adapter, { url: `http://fixture.test:${port}` })).toBe('capacity');
    host.stopSession('r1', 's1');
    await new Promise<void>(r => setImmediate(r));
    const afterSession = host.active.size;
    expect(await host.request(adapter, { url: `http://fixture.test:${port}` })).toBe('stopped');
    host.stopRun('r1');
    await new Promise<void>(r => setImmediate(r));
    const afterRun = host.active.size;
    gate.resolve(['127.0.0.1']);
    expect({ first: await first, second: await second, third: await third, rest: await Promise.all(rest), afterSession, afterRun, active: host.active.size, connections, records: host.results.length })
      .toEqual({ first: 'cancelled', second: 'cancelled', third: 'ok', rest: Array(5).fill('cancelled'), afterSession: 2, afterRun: 1, active: 0, connections: 1, records: 8 });
    // A different active run can register and complete again after quota release.
    expect(await host.request(adapter, { url: `http://fixture.test:${port}` }, 'r2', 's2')).toBe('ok');
  });

  it.each(['cancel', 'timeout'] as const)('bounds blocked persistence cleanup on %s and retains unknown reservation', async mode => {
    const writing = deferred(); const gate = deferred();
    fileBoundary.wait = () => { writing.resolve(); return gate.promise; };
    const port = await listen(createServer((_q, res) => res.end('complete body')));
    const dir = await root();
    const adapter = createHttpTools({ target: `http://127.0.0.1:${port}`, jar: new CookieJar(), workDir: dir });
    const host = new HostBoundary();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let settled = false;
    const pending = host.request(adapter, { url: `http://127.0.0.1:${port}`, timeout_ms: 100 })
      .then(result => { settled = true; return result; });
    await writing.promise;
    if (mode === 'cancel') host.stopRun('r1');
    else await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1000); // bounded cleanup grace, never extra network execution time
    const settledBeforeRelease = settled;
    gate.resolve();
    const result = await pending;
    await new Promise<void>(r => setImmediate(r));
    const files = await readdir(join(dir, 'http'));
    expect({ result, settledBeforeRelease, reserved: host.active.size, records: host.results.length, files })
      .toEqual({ result: 'cleanup_unknown', settledBeforeRelease: true, reserved: 1, records: 1, files: [] });
  });

});
