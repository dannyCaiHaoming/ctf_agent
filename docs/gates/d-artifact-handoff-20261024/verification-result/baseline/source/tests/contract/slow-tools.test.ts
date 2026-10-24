import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type RequestListener } from 'node:http';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';

const fsGate = vi.hoisted(() => ({ suffix: '', entered: undefined as (() => void) | undefined, wait: undefined as Promise<void> | undefined }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
    if (fsGate.suffix && String(args[0]).endsWith(fsGate.suffix)) { fsGate.entered?.(); await fsGate.wait; }
    return fs.mkdir(...args);
  } };
});
const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { fsGate.suffix = ''; fsGate.wait = undefined; fsGate.entered = undefined; vi.useRealTimers(); for (const f of clean.splice(0).reverse()) await f(); });
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function server(handler: RequestListener) {
  const s = createServer(handler); await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  clean.push(() => new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); }));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function fixture(target?: string, expiresAt = Date.now() + 60000) {
  const dir = await mkdtemp(join(tmpdir(), 'g-c-slow-')); clean.push(() => rm(dir, { recursive: true, force: true }));
  const challenges = await Promise.all(['X', 'Y'].map(async id => {
    const materialsDir = join(dir, id, 'materials'); await mkdir(materialsDir, { recursive: true });
    return { id, title: null, reachability: null, materials: [], materialsDir,
      target: target ? { protocol: 'http' as const, url: target, host: '127.0.0.1', port: Number(new URL(target).port) } : null };
  }));
  const client = { session: { get: async ({ sessionID }: { sessionID: string }) => ({ data: { parentID: 'root', agent: sessionID.startsWith('eng') ? 'engineer' : 'recon' } }),
    messages: async () => ({ data: [] }), children: async () => ({ data: [] }), abort: async () => ({ data: true }) } };
  const c = new ControlService({ client: client as never, runId: 'run-fixture', budget: { maxModelCalls: 50, maxObservableTokens: 10000 }, expiresAt,
    workdir: join(dir, 'opencode'), skillRoot: dir, challenges } as never); c.bindRoot('root'); clean.push(() => c.stopAll('cleanup'));
  async function bind(id: string, challenge = 'X') {
    const role = id.startsWith('eng') ? 'engineer' : 'recon';
    await c.handle('root', 'tool.execute', { tool: 'challenge.assign', args: { role, challenge } });
    await c.handle('root', 'tool.before', { tool: 'task', callID: `dispatch-${id}`, args: { subagent_type: role } });
    await c.handle(id, 'chat.message', { agent: role });
  }
  await bind('a'); return { c, dir, bind };
}
async function execute(c: ControlService, sessionID: string, tool: string, args: object, callID = `call-${Math.random()}`, signal?: AbortSignal) {
  await c.handle(sessionID, 'tool.before', { tool: `ctf_${tool.replaceAll('.', '_')}`, callID, args });
  return c.handle(sessionID, 'tool.execute', { tool, args, callID }, signal);
}

// Moving the slow response back into C's global serial queue makes the admission race lose.
it('real C lets another session admit and revoke before a blocked HTTP body is released', async () => {
  const entered = gate(); const release = gate();
  const target = await server(async (_req, res) => { res.writeHead(200); res.write('first'); entered.resolve(); await release.promise; res.end('last'); });
  const { c, bind } = await fixture(target); await bind('b', 'Y');
  const slow = execute(c, 'a', 'http.request', { url: target, timeout_ms: 30000 }, 'slow').catch(e => e);
  await Promise.race([entered.promise, slow.then(e => { throw e; })]);
  const admission = await Promise.race([c.handle('b', 'model.call', { agent: 'recon' }), new Promise(r => setTimeout(() => r('blocked'), 500))]);
  expect(admission).toMatchObject({ role: 'recon' });
  await c.revoke('a'); expect(String(await slow)).toContain('cancelled');
  expect(c.audit.some(r => r.op === 'tool.settled' && (r.detail as { callID?: string })?.callID === 'slow')).toBe(true);
  release.resolve();
});

it('real C enforces eight HTTP slots per challenge, with independent capacity for another challenge', async () => {
  const entered = gate(); let count = 0;
  const target = await server((_req, res) => { res.writeHead(200); res.write('held'); if (++count === 9) entered.resolve(); });
  const { c, bind } = await fixture(target); await bind('b'); await bind('other', 'Y');
  const calls = Array.from({ length: 8 }, (_, n) => execute(c, n % 2 ? 'b' : 'a', 'http.request', { url: target }, `slot-${n}`).catch(e => e));
  await vi.waitFor(() => expect(count).toBe(8));
  await expect(execute(c, 'b', 'http.request', { url: target }, 'overflow')).rejects.toThrow('http limit');
  const other = execute(c, 'other', 'http.request', { url: target }, 'other').catch(e => e); await entered.promise;
  await c.stopAll('test'); const results = await Promise.all([...calls, other]); expect(results.every(r => String(r).includes('cancelled'))).toBe(true);
  expect(c.resourceSnapshot().filter(r => r.state === 'active')).toHaveLength(0);
});

it('RPC disconnect cancels the real registered operation and preserves its session/call trace', async () => {
  const entered = gate(); const target = await server((_req, res) => { res.writeHead(200); res.write('held'); entered.resolve(); });
  const { c } = await fixture(target); const rpc = await startControlRpc((id, op, input, signal) => c.handle(id, op, input, signal)); clean.push(rpc.close);
  const abort = new AbortController();
  const call = fetch(rpc.url, { method: 'POST', headers: { authorization: `Bearer ${rpc.token}` }, signal: abort.signal,
    body: JSON.stringify({ sessionID: 'a', operation: 'tool.execute', input: { tool: 'http.request', callID: 'disconnect', args: { url: target } } }) }).catch(e => e);
  await entered.promise; abort.abort(); await call;
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'disconnect')).toMatchObject({ sessionID: 'a', state: 'settled', result: 'cancelled' }));
});

it('jobs remain registered after handle delivery; revoke cancels only that session including grandchildren', async () => {
  const { c, bind, dir } = await fixture(); await bind('b');
  const args = { argv: [process.execPath, '-e', "const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('grandchild.pid',String(child.pid)); console.log('ready'); setInterval(()=>{},1000)"], wait_ms: 0 };
  const a = await execute(c, 'a', 'job.run', args, 'job-a') as { job: string };
  const b = await execute(c, 'b', 'job.run', args, 'job-b') as { job: string };
  const pid = async (id: string) => Number(await readFile(join(dir, 'X/work', id, 'grandchild.pid'), 'utf8'));
  await vi.waitFor(async () => { expect(await pid('a')).toBeGreaterThan(0); expect(await pid('b')).toBeGreaterThan(0); });
  const aPid = await pid('a'); const bPid = await pid('b');
  await c.revoke('a'); expect(() => process.kill(aPid, 0)).toThrow(); expect(() => process.kill(bPid, 0)).not.toThrow();
  expect(c.resourceSnapshot().find(r => r.callID === 'job-a')).toMatchObject({ state: 'settled', result: 'cancelled', job: a.job });
  const read = await execute(c, 'b', 'job.read', { job: b.job, stream: 'stdout' }) as { state: string }; expect(read.state).toBe('running');
  await expect(execute(c, 'b', 'job.cancel', { job: a.job })).rejects.toThrow('job handle');
  await c.stopAll('test'); expect(() => process.kill(bPid, 0)).toThrow(); expect(c.resourceSnapshot().filter(r => r.state === 'active')).toHaveLength(0);
});

it('fake-clock host wait approval caps at binding lifetime and expires an already registered HTTP operation', async () => {
  const entered = gate();
  const target = await server((_req, res) => { res.writeHead(200); res.write('held'); entered.resolve(); });
  const expires = Date.now() + 10000; const { c } = await fixture(target, expires);
  const approval = await c.handle('a', 'tool.before', { tool: 'ctf_http_request', callID: 'deadline', args: { url: target, timeout_ms: 60000 } }) as { rpcTimeoutMs: number };
  expect(approval.rpcTimeoutMs).toBeLessThanOrEqual(15000); expect(approval.rpcTimeoutMs).toBeGreaterThan(14000);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const work = c.handle('a', 'tool.execute', { tool: 'http.request', callID: 'deadline', args: { url: target, timeout_ms: 60000 } }).catch(e => e);
  await entered.promise;
  expect(c.resourceSnapshot().find(r => r.callID === 'deadline')?.state).toBe('active');
  await vi.advanceTimersByTimeAsync(10000); expect(String(await work)).toMatch(/timeout|lapsed/);
  expect(c.resourceSnapshot().find(r => r.callID === 'deadline')?.state).not.toBe('active');
});

it('product plugin correlates trusted before/execute args without a non-public ToolContext.callID', async () => {
  const seen: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const rpc = await startControlRpc(async (_id, operation, input) => { seen.push({ operation, input: input as Record<string, unknown> }); return operation === 'tool.before' ? { allowed: true, rpcTimeoutMs: 25000 } : { ok: true }; }); clean.push(rpc.close);
  const hooks = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: ['http.request'] });
  const args = { url: 'http://127.0.0.1:1', timeout_ms: 20000 };
  await hooks['tool.execute.before']!({ sessionID: 'a', tool: 'ctf_http_request', callID: 'trusted-call' }, { args });
  await hooks.tool!.ctf_http_request!.execute(args as never, { sessionID: 'a', abort: new AbortController().signal } as never);
  expect(seen.find(r => r.operation === 'tool.execute')?.input.callID).toBe('trusted-call');
});


it('stop during registered workspace preparation returns bounded unknown and prevents a late job spawn', async () => {
  const { c, dir } = await fixture(); const entered = gate(); const release = gate();
  fsGate.suffix = '/work/a'; fsGate.entered = entered.resolve; fsGate.wait = release.promise;
  const work = execute(c, 'a', 'job.run', { argv: [process.execPath, '-e', "require('fs').writeFileSync('spawned','bad')"], wait_ms: 0 }, 'preparing').catch(e => e);
  await entered.promise;
  const start = Date.now(); await c.revoke('a'); expect(Date.now() - start).toBeLessThan(5000);
  expect(c.resourceSnapshot().find(r => r.callID === 'preparing')).toMatchObject({ state: 'unknown', result: 'cleanup_unknown' });
  release.resolve(); expect(String(await work)).toContain('cancelled');
  await expect(readFile(join(dir, 'X/work/a/spawned'))).rejects.toThrow();
  expect(c.resourceSnapshot().find(r => r.callID === 'preparing')).toMatchObject({ state: 'settled', result: 'cancelled' });
});

it('handle produced before an abandoned RPC response is cancelled and remains traceable', async () => {
  const { c } = await fixture(); const produced = gate(); const deliver = gate(); let handle = '';
  const rpc = await startControlRpc(async (id, op, input, signal) => {
    const result = await c.handle(id, op, input, signal) as { job: string }; handle = result.job; produced.resolve(); await deliver.promise; return result;
  }); clean.push(rpc.close);
  const abort = new AbortController();
  const request = fetch(rpc.url, { method: 'POST', headers: { authorization: `Bearer ${rpc.token}` }, signal: abort.signal,
    body: JSON.stringify({ sessionID: 'a', operation: 'tool.execute', input: { tool: 'job.run', callID: 'delivery-race', args: { argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], wait_ms: 0 } } }) }).catch(e => e);
  await produced.promise; abort.abort(); await request;
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'delivery-race')).toMatchObject({ job: handle, state: 'settled', result: 'cancelled' }));
  expect(c.audit.find(r => r.op === 'rpc.abandoned')?.detail).toMatchObject({ callID: 'delivery-race', job: handle, delivery: 'not_finished' });
  await c.stopAll('test'); deliver.resolve();
  expect(c.resourceSnapshot().find(r => r.callID === 'delivery-race')).toMatchObject({ state: 'settled', result: 'cancelled' });
  await expect(c.handle('a', 'tool.execute', { tool: 'job.run', callID: 'delivery-race', args: { argv: ['true'] } })).rejects.toThrow();
});

it('C retains HTTP cleanup_unknown reservation when response persistence is blocked', async () => {
  const target = await server((_req, res) => res.end('body')); const { c } = await fixture(target);
  const entered = gate(); const release = gate(); fsGate.suffix = '/a/http'; fsGate.entered = entered.resolve; fsGate.wait = release.promise;
  const work = execute(c, 'a', 'http.request', { url: target, timeout_ms: 30000 }, 'persist').catch(e => e);
  await entered.promise; await c.revoke('a'); expect(String(await work)).toContain('cleanup_unknown');
  expect(c.resourceSnapshot().find(r => r.callID === 'persist')).toMatchObject({ state: 'unknown', result: 'cleanup_unknown' });
  release.resolve();
});


it('normal RPC finish delivers a running handle without cancelling it; session stop still owns it', async () => {
  const { c } = await fixture();
  const rpc = await startControlRpc((id, op, input, signal) => c.handle(id, op, input, signal)); clean.push(rpc.close);
  const response = await fetch(rpc.url, { method: 'POST', headers: { authorization: `Bearer ${rpc.token}` },
    body: JSON.stringify({ sessionID: 'a', operation: 'tool.execute', input: { tool: 'job.run', callID: 'delivered', args: { argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], wait_ms: 0 } } }) });
  const reply = await response.json() as { result: { job: string; state: string } }; expect(reply.result.state).toBe('running');
  expect(c.resourceSnapshot().find(r => r.callID === 'delivered')).toMatchObject({ job: reply.result.job, state: 'active' });
  expect(c.audit.some(r => r.op === 'rpc.abandoned')).toBe(false);
  await c.revoke('a'); expect(c.resourceSnapshot().find(r => r.callID === 'delivered')).toMatchObject({ state: 'settled', result: 'cancelled' });
});


it('expiry cancels an already delivered job and refuses its handle after expiry', async () => {
  const { c } = await fixture(undefined, Date.now() + 1000);
  const result = await execute(c, 'a', 'job.run', { argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], wait_ms: 0, timeout_ms: 5000 }, 'expiry') as { job: string };
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'expiry')).toMatchObject({ state: 'settled', result: 'timed_out' }), { timeout: 2000 });
  await expect(execute(c, 'a', 'job.read', { job: result.job, stream: 'stdout' })).rejects.toThrow('binding lapsed');
});

it('concurrent same-session same-tool calls retain distinct trusted markers and cannot replay one', async () => {
  const seen: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const rpc = await startControlRpc(async (_id, operation, input) => { seen.push({ operation, input: input as Record<string, unknown> }); return { allowed: true }; }); clean.push(rpc.close);
  const hooks = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: ['workspace.read'] });
  const argsA = { path: 'work/A' }; const argsB = { path: 'work/B' };
  await Promise.all([hooks['tool.execute.before']!({ sessionID: 'a', tool: 'ctf_workspace_read', callID: 'A' }, { args: argsA }), hooks['tool.execute.before']!({ sessionID: 'a', tool: 'ctf_workspace_read', callID: 'B' }, { args: argsB })]);
  const context = { sessionID: 'a', abort: new AbortController().signal } as never;
  await Promise.all([hooks.tool!.ctf_workspace_read!.execute(argsB as never, context), hooks.tool!.ctf_workspace_read!.execute(argsA as never, context)]);
  expect(seen.filter(r => r.operation === 'tool.execute').map(r => [r.input.callID, (r.input.args as { path: string }).path])).toEqual([['B', 'work/B'], ['A', 'work/A']]);
  await expect(hooks.tool!.ctf_workspace_read!.execute(argsA as never, context)).rejects.toThrow('missing trusted call');
});

it('real C applies session and challenge job limits with independent capacity in another challenge', async () => {
  const { c, bind } = await fixture();
  for (const id of ['b', 'c', 'd']) await bind(id); await bind('e', 'Y');
  const args = { argv: ['sleep', '30'], wait_ms: 0 };
  for (const id of ['a', 'b', 'c', 'd']) { await execute(c, id, 'job.run', args); await execute(c, id, 'job.run', args); }
  await expect(execute(c, 'a', 'job.run', args)).rejects.toThrow('session job limit');
  await bind('f'); await expect(execute(c, 'f', 'job.run', args)).rejects.toThrow('challenge job limit');
  expect(await execute(c, 'e', 'job.run', args)).toMatchObject({ state: 'running' });
  await c.stopAll('test'); expect(c.resourceSnapshot().filter(r => r.state !== 'settled')).toHaveLength(0);
});

it('unknown process-group cleanup keeps its session quota reserved', async () => {
  const { c } = await fixture();
  const args = { argv: ['sleep', '30'], wait_ms: 0 };
  const a = await execute(c, 'a', 'job.run', args, 'unknown-a') as { job: string };
  const b = await execute(c, 'a', 'job.run', args, 'unknown-b') as { job: string };
  const realKill = process.kill.bind(process);
  const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => pid < 0 && signal === 0 ? true : realKill(pid, signal));
  try {
    expect(await execute(c, 'a', 'job.cancel', { job: a.job })).toMatchObject({ reapIncomplete: true });
    expect(c.resourceSnapshot().find(r => r.callID === 'unknown-a')).toMatchObject({ state: 'unknown', result: 'cleanup_unknown' });
    await expect(execute(c, 'a', 'job.run', args)).rejects.toThrow('session job limit');
  } finally { spy.mockRestore(); await execute(c, 'a', 'job.cancel', { job: b.job }); }
});

it('creates the design-mapped private work directory before a child can request its first model admission', async () => {
  const { c, dir } = await fixture();
  expect(await import('node:fs/promises').then(fs => fs.readdir(join(dir, 'X/work/a')))).toEqual([]);
  expect(await c.handle('a', 'model.call', { agent: 'recon' })).toMatchObject({ admitNo: 1 });
});

// Long-job decision prototype: removing C's terminal wait makes the first assertion fail.
it('terminal candidate keeps one execute pending beyond wait_ms, permits admission and incremental reads, then returns final result once', async () => {
  const { c, bind } = await fixture(); await bind('b', 'Y');
  let delivered = false;
  const pending = execute(c, 'a', 'job.run', { argv: [process.execPath, '-e', "console.log('early');setTimeout(()=>console.log('late'),700)"], wait_ms: 20, timeout_ms: 2000, completion: 'terminal' }, 'terminal-one').then(value => { delivered = true; return value; });
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'terminal-one')?.job).toBeTruthy());
  await new Promise(r => setTimeout(r, 150)); expect(delivered).toBe(false);
  const handle = c.resourceSnapshot().find(r => r.callID === 'terminal-one')!.job!;
  const early = await execute(c, 'a', 'job.read', { job: handle, stream: 'stdout' }) as { data: string; nextCursor: string; done: boolean };
  expect(Buffer.from(early.data, 'base64').toString()).toBe('early\n'); expect(early.done).toBe(false);
  expect(await Promise.race([c.handle('b', 'model.call', { agent: 'recon' }), new Promise(r => setTimeout(() => r('blocked'), 300))])).toMatchObject({ role: 'recon' });
  expect(await pending).toMatchObject({ job: handle, state: 'exited', exitCode: 0 });
  const late = await execute(c, 'a', 'job.read', { job: handle, stream: 'stdout', cursor: early.nextCursor }) as { data: string; done: boolean };
  expect(Buffer.from(late.data, 'base64').toString()).toBe('late\n'); expect(late.done).toBe(true);
  expect(c.audit.filter(r => r.op === 'tool.settled' && (r.detail as { callID?: string } | undefined)?.callID === 'terminal-one')).toHaveLength(1);
  await expect(execute(c, 'a', 'job.run', { argv: ['true'], completion: 'terminal' }, 'terminal-one')).rejects.toThrow('duplicate tool call');
});

it('terminal candidate cancellation is idempotent and returns to the same call without a completion notifier', async () => {
  const { c } = await fixture();
  const pending = execute(c, 'a', 'job.run', { argv: ['sleep', '30'], wait_ms: 0, timeout_ms: 60000, completion: 'terminal' }, 'terminal-cancel');
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'terminal-cancel')?.job).toBeTruthy());
  const handle = c.resourceSnapshot().find(r => r.callID === 'terminal-cancel')!.job!;
  expect(await execute(c, 'a', 'job.cancel', { job: handle })).toMatchObject({ state: 'cancelled' });
  expect(await pending).toMatchObject({ job: handle, state: 'cancelled' });
  expect(await execute(c, 'a', 'job.cancel', { job: handle })).toMatchObject({ state: 'cancelled' });
  expect(c.audit.filter(r => r.op === 'tool.settled' && (r.detail as { callID?: string } | undefined)?.callID === 'terminal-cancel')).toHaveLength(1);
});

it('terminal candidate timeout and binding expiry do not return an early running handle', async () => {
  const { c } = await fixture();
  expect(await execute(c, 'a', 'job.run', { argv: ['sleep', '30'], wait_ms: 0, timeout_ms: 150, completion: 'terminal' }, 'terminal-timeout')).toMatchObject({ state: 'timed_out' });
  const expiring = await fixture(undefined, Date.now() + 500);
  expect(await execute(expiring.c, 'a', 'job.run', { argv: ['sleep', '30'], wait_ms: 0, timeout_ms: 60000, completion: 'terminal' }, 'terminal-expiry')).toMatchObject({ state: 'timed_out' });
  await expect(execute(expiring.c, 'a', 'job.read', { job: 'unused', stream: 'stdout' })).rejects.toThrow('binding lapsed');
});

it('terminal candidate RPC disconnect cancels the still waiting job and never starts a duplicate', async () => {
  const { c } = await fixture(); const rpc = await startControlRpc((id, op, input, signal) => c.handle(id, op, input, signal)); clean.push(rpc.close);
  const abort = new AbortController(); const request = fetch(rpc.url, { method: 'POST', signal: abort.signal, headers: { authorization: `Bearer ${rpc.token}` },
    body: JSON.stringify({ sessionID: 'a', operation: 'tool.execute', input: { tool: 'job.run', callID: 'terminal-disconnect', args: { argv: ['sleep', '30'], wait_ms: 0, completion: 'terminal' } } }) }).catch(e => e);
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'terminal-disconnect')?.job).toBeTruthy());
  abort.abort(); await request;
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'terminal-disconnect')).toMatchObject({ state: 'settled', result: 'cancelled' }));
  expect(c.audit.filter(r => r.op === 'tool.registered' && (r.detail as { callID?: string } | undefined)?.callID === 'terminal-disconnect')).toHaveLength(1);
  expect(c.audit.some(r => r.op === 'rpc.abandoned' && (r.detail as { callID?: string } | undefined)?.callID === 'terminal-disconnect')).toBe(true);
});

it('terminal candidate RPC limit follows timeout and cleanup rather than wait_ms, and plugin accepts the bounded approval', async () => {
  const { c } = await fixture(undefined, Date.now() + 700000);
  const args = { argv: ['true'], wait_ms: 1, timeout_ms: 600000, completion: 'terminal' };
  const approval = await c.handle('a', 'tool.before', { tool: 'ctf_job_run', callID: 'long-approval', args }) as { rpcTimeoutMs: number };
  expect(approval.rpcTimeoutMs).toBe(609000);
  const rpc = await startControlRpc(async (_id, op) => op === 'tool.before' ? approval : { state: 'exited' }); clean.push(rpc.close);
  const hooks = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: ['job.run'] });
  await hooks['tool.execute.before']!({ sessionID: 'a', tool: 'ctf_job_run', callID: 'long-approval' }, { args });
  await expect(hooks.tool!.ctf_job_run!.execute(args as never, { sessionID: 'a', abort: new AbortController().signal } as never)).resolves.toMatchObject({ output: '{"state":"exited"}' });
  await expect(execute(c, 'a', 'job.run', { ...args, completion: 'garbage' }, 'bad-completion')).rejects.toThrow();
});

it('terminal candidate reports incomplete reaping as unknown and keeps its slot reserved', async () => {
  const { c } = await fixture();
  const pending = execute(c, 'a', 'job.run', { argv: ['sleep', '30'], wait_ms: 0, completion: 'terminal' }, 'terminal-unknown');
  await vi.waitFor(() => expect(c.resourceSnapshot().find(r => r.callID === 'terminal-unknown')?.job).toBeTruthy());
  const handle = c.resourceSnapshot().find(r => r.callID === 'terminal-unknown')!.job!;
  const realKill = process.kill.bind(process);
  const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => pid < 0 && signal === 0 ? true : realKill(pid, signal));
  try {
    await execute(c, 'a', 'job.cancel', { job: handle });
    expect(await pending).toMatchObject({ job: handle, state: 'cancelled', reapIncomplete: true });
    expect(c.resourceSnapshot().find(r => r.callID === 'terminal-unknown')).toMatchObject({ state: 'unknown', result: 'cleanup_unknown' });
    await execute(c, 'a', 'job.run', { argv: ['sleep', '30'], wait_ms: 0 }, 'remaining-slot');
    await expect(execute(c, 'a', 'job.run', { argv: ['true'], completion: 'terminal' }, 'blocked-slot')).rejects.toThrow('session job limit');
  } finally { spy.mockRestore(); }
});
