import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';
import { ToolRuntime, type RuntimeOwner, type RuntimeTaskLease } from '../../packages/runtime/src/index.js';

const roots: string[] = [];
const runtimes: ToolRuntime[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();
const owner: RuntimeOwner = { sessionId: 's1', leaseId: 'l1' };
const nextOwner: RuntimeOwner = { sessionId: 's2', leaseId: 'l2' };
const expiresAt = new Date(Date.now() + 60000).toISOString();
const lease = (taskId = 'task1', context = owner): RuntimeTaskLease => ({ taskId, ...context, expiresAt });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-interactive-')); roots.push(root);
  const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
  runtimes.push(runtime); runtime.registerTaskLease(lease()); runtime.registerTaskLease(lease('task2', nextOwner));
  return runtime;
}
async function endpoint() {
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', bytes => socket.write(bytes)); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  return { host: '127.0.0.1', port: address.port };
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('real interactive runtime', () => {
  it('allocates a real PTY, accepts input and keeps independent immutable records', async () => {
    const runtime = await setup();
    const job = await runtime.jobStart({ taskId: 'task1', owner, mode: 'pty', command: ['python3', '-u', '-c', 'import os; print("TTY="+str(os.isatty(0) and os.isatty(1)), flush=True); print("ANSWER="+input(), flush=True)'], timeoutMs: 3000 });
    expect(Object.isFrozen(job)).toBe(true); expect(Object.isFrozen(job.command)).toBe(true);
    await vi.waitUntil(async () => (await runtime.jobRead(job.id, 0, 1000, owner)).bytes.includes('TTY=True'));
    await runtime.jobWrite(job.id, { encoding: 'base64', data: Buffer.from('hello\n').toString('base64') }, owner);
    await vi.waitUntil(() => runtime.jobStatus(job.id, owner)?.status === 'completed');
    const read = await runtime.jobRead(job.id, 0, 1000, owner); expect(read.bytes.toString()).toContain('ANSWER=hello');
    expect(job.status).toBe('running'); expect(read.nextCursor).toBe(read.bytes.length);
  });

  it('uses TCP bytes, explicit gaps, ownership transfer and bounded cleanup', async () => {
    const runtime = await setup(); const target = await endpoint();
    const events: string[] = []; runtime.onTerminal(event => events.push(event.state));
    const job = await runtime.jobStart({ taskId: 'task1', owner, mode: 'tcp_session', endpoint: target, timeoutMs: 3000, maxRetainedBytes: 4 });
    const bytes = Buffer.from([0, 255, 1, 254, 2, 253]);
    await runtime.jobWrite(job.id, { encoding: 'bytes', data: bytes }, owner);
    await vi.waitUntil(() => runtime.jobStatus(job.id, owner)?.endCursor === bytes.length);
    const gap = await runtime.jobRead(job.id, 0, 100, owner); expect(gap.gap).toEqual({ from: 0, to: 2 });
    const read = await runtime.jobRead(job.id, gap.nextCursor, 100, owner); expect(read.bytes).toEqual(bytes.subarray(2));
    expect(() => runtime.jobStatus(job.id, nextOwner)).toThrow(/owner|lease/);
    expect(runtime.jobList({ taskId: 'task1', ...owner })).toHaveLength(1);
    const transfer = runtime.jobTransfer(job.id, lease('task2', nextOwner), owner); expect(transfer.taskId).toBe('task2');
    expect(() => runtime.jobStatus(job.id, owner)).toThrow(/owner|lease/);
    await runtime.jobCancel(job.id, 'cancelled', nextOwner); expect(events).toEqual(['cancelled']);
  });

  it('exposes full channel lifecycle and rejects invalid encoding, cursors and leases', async () => {
    const runtime = await setup(); const target = await endpoint();
    const channel = await runtime.channelOpen({ taskId: 'task1', owner, endpoint: target, timeoutMs: 3000 });
    expect(Object.isFrozen(channel)).toBe(true);
    await runtime.channelWrite(channel.id, { encoding: 'base64', data: 'AP8=' }, owner);
    await vi.waitUntil(() => runtime.channelStatus(channel.id, owner)?.endCursor === 2);
    expect((await runtime.channelRead(channel.id, 0, 10, owner)).bytes).toEqual(Buffer.from([0, 255]));
    await expect(runtime.channelWrite(channel.id, { encoding: 'base64', data: '%%%=' }, owner)).rejects.toThrow(/base64/);
    await expect(runtime.channelRead(channel.id, -1, 10, owner)).rejects.toThrow(/cursor/);
    await expect(runtime.channelRead(channel.id, 3, 10, owner)).rejects.toThrow(/cursor/);
    expect(() => runtime.channelTransfer(channel.id, { ...lease('task2', nextOwner), leaseId: 'fake' }, owner)).toThrow(/lease/);
    runtime.channelTransfer(channel.id, lease('task2', nextOwner), owner);
    await runtime.channelClose(channel.id, nextOwner);
    expect(runtime.channelStatus(channel.id, nextOwner)?.status).toBe('cancelled');
    await expect(runtime.channelWrite(channel.id, { encoding: 'bytes', data: Buffer.from('x') }, nextOwner)).rejects.toThrow(/running|closed/);
  });

  it('fails closed for hard limits without enforceable transport before any connection', async () => {
    const runtime = await setup(); const target = await endpoint();
    const capability = runtime.meteringCapability({ unit_definition: 'query', hard_limit: 1, budget_scope: 'challenge', counting_point: 'send', reset_rule: 'never', authority_ref: 'fixture', managed_transport: 'tcp', retry_redirect_batch_policy: 'disabled', confirmation_condition: 'reply', quarantine_scope: 'endpoint' });
    expect(capability.status).toBe('metering_unavailable'); expect(Object.isFrozen(capability)).toBe(true);
    await expect(runtime.channelOpen({ taskId: 'task1', owner, endpoint: target, hardLimit: capability })).rejects.toThrow(/metering_unavailable/);
    expect(sockets.size).toBe(0);
    const ordinary = await runtime.channelOpen({ taskId: 'task1', owner, endpoint: target });
    expect(ordinary.status).toBe('running');
  });

  it('kills real PTY descendants before cancel resolves and emits one final callback', async () => {
    const runtime = await setup(); const seen: string[] = [];
    const unsubscribe = runtime.onTerminal(event => { seen.push(event.state); expect(Object.isFrozen(event.record)).toBe(true); });
    const script = 'import subprocess,time; p=subprocess.Popen(["python3","-c","import time; time.sleep(60)"]); print("PID="+str(p.pid),flush=True); time.sleep(60)';
    const job = await runtime.jobStart({ taskId: 'task1', owner, mode: 'pty', command: ['python3', '-u', '-c', script], timeoutMs: 3000 });
    await vi.waitUntil(async () => /PID=\d+/.test((await runtime.jobRead(job.id, 0, 1000, owner)).bytes.toString()));
    const text = (await runtime.jobRead(job.id, 0, 1000, owner)).bytes.toString();
    const pid = Number(/PID=(\d+)/.exec(text)![1]);
    process.kill(pid, 0);
    await runtime.jobCancel(job.id, 'cancelled', owner);
    await vi.waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    const end = runtime.jobStatus(job.id, owner)!.endCursor;
    await runtime.jobCancel(job.id, 'cancelled', owner);
    expect(runtime.jobStatus(job.id, owner)!.endCursor).toBe(end); expect(seen).toEqual(['cancelled']); unsubscribe();
  });

  it('cleans a descendant when the main batch command exits naturally', async () => {
    const runtime = await setup();
    const script = 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log("PID="+child.pid); child.unref();';
    const job = await runtime.jobStart({ taskId: 'legacy', command: [process.execPath, '-e', script], timeoutMs: 3000 });
    await vi.waitUntil(() => runtime.jobStatus(job.id)?.status === 'completed');
    const text = (await runtime.jobRead(job.id, 0, 1000)).bytes.toString();
    const pid = Number(/PID=(\d+)/.exec(text)![1]);
    await vi.waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  });

  it('keeps spawn errors contained, supports empty evidence and maps error/lost exactly once', async () => {
    const runtime = await setup(); const states: string[] = [];
    runtime.onTerminal(event => states.push(event.state));
    const failed = await runtime.jobStart({ taskId: 'legacy', command: ['/definitely/missing-executable-task6'], timeoutMs: 500 });
    await vi.waitUntil(() => runtime.jobStatus(failed.id)?.status === 'failed');
    await runtime.dispose(); expect(states).toEqual(['error']);
    await expect(runtime.jobStart({ taskId: 'legacy', command: ['true'] })).rejects.toThrow(/disposed/);
    const second = await setup(); second.onTerminal(event => states.push(event.state));
    const empty = await second.jobStart({ taskId: 'legacy', command: [process.execPath, '-e', ''], timeoutMs: 1000 });
    await vi.waitUntil(() => second.jobStatus(empty.id)?.status === 'completed');
    expect((await second.publishJobEvidence(empty.id, 0, 0)).size).toBe(0);
    const lost = await second.jobStart({ taskId: 'task1', owner, mode: 'pty', command: ['python3', '-c', 'import time; time.sleep(60)'], timeoutMs: 3000 });
    await second.jobMarkLost(lost.id, owner);
    expect((await second.jobRead(lost.id, 0, 10, owner)).readState).toBe('lost');
    expect(states).toEqual(['error', 'completed', 'lost']);
  });

  it('bounds TCP lifetime, reports errors, and enforces lease revocation', async () => {
    const runtime = await setup(); const target = await endpoint(); const states: string[] = [];
    runtime.onTerminal(event => states.push(event.state));
    const channel = await runtime.channelOpen({ taskId: 'task1', owner, endpoint: target, timeoutMs: 30 });
    await vi.waitUntil(() => runtime.channelStatus(channel.id, owner)?.status === 'timeout');
    await vi.waitUntil(() => sockets.size === 0); expect(states).toEqual(['error']);
    runtime.revokeTaskLease(owner);
    expect(() => runtime.channelStatus(channel.id, owner)).toThrow(/lease/);
    await expect(runtime.channelOpen({ taskId: 'task1', owner, endpoint: target })).rejects.toThrow(/lease/);
    const dead = createServer(); await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve));
    const address = dead.address(); if (!address || typeof address === 'string') throw new Error('address');
    await new Promise<void>(resolve => dead.close(() => resolve()));
    const failed = await runtime.channelOpen({ taskId: 'task2', owner: nextOwner, endpoint: { host: '127.0.0.1', port: address.port }, timeoutMs: 1000 });
    expect(failed.status).toBe('failed'); expect(states).toEqual(['error', 'error']);
  });


  it('rejects expired owners, workspace traversal and unreasonable resource limits before launch', async () => {
    const runtime = await setup();
    expect(() => runtime.registerTaskLease({ ...lease(), sessionId: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() })).toThrow(/expired/);
    expect(() => runtime.workspace('../outside')).toThrow(/taskId/);
    await expect(runtime.jobStart({ taskId: 'legacy', command: ['true'], timeoutMs: Infinity })).rejects.toThrow(/timeout/);
    await expect(runtime.jobStart({ taskId: 'legacy', command: ['true'], maxRetainedBytes: -1 })).rejects.toThrow(/Retained/);
    await expect(runtime.jobStart({ taskId: 'legacy', command: ['true'], cwd: '../outside' })).rejects.toThrow(/outside/);
    await expect(runtime.jobStart({ taskId: 'task1', command: ['true'] })).rejects.toThrow(/owner/);
    await expect(runtime.jobStart({ taskId: 'legacy', mode: 'pty', command: ['true'] })).rejects.toThrow(/owner/);
  });

  it('drains complete PTY output while a large input write is backpressured', async () => {
    const runtime = await setup();
    const input = Buffer.alloc(64 * 1024, 0x69);
    const output = Buffer.alloc(512 * 1024, 0x6f);
    const script = [
      'import os,tty,time',
      'tty.setraw(0)',
      'os.write(1,b"READY\\n")',
      'time.sleep(0.15)',
      'output=b"o"*(512*1024)',
      'while output:',
      ' n=os.write(1,output); output=output[n:]',
      'received=b""',
      'while len(received)<64*1024:',
      ' received+=os.read(0,64*1024-len(received))',
      'assert received==b"i"*(64*1024)',
      'os.write(1,b"DONE=65536\\n")'
    ].join('\n');
    const job = await runtime.jobStart({ taskId: 'task1', owner, mode: 'pty', command: ['python3', '-u', '-c', script], timeoutMs: 1500, maxRetainedBytes: 1024 * 1024 });
    await vi.waitUntil(async () => (await runtime.jobRead(job.id, 0, 100, owner)).bytes.includes('READY\n'), { timeout: 1000, interval: 5 });
    expect(await runtime.jobWrite(job.id, { encoding: 'bytes', data: input }, owner)).toEqual({ bytesWritten: input.length, encoding: 'bytes' });
    await vi.waitUntil(() => runtime.jobStatus(job.id, owner)?.status !== 'running', { timeout: 2500, interval: 5 });
    const status = runtime.jobStatus(job.id, owner)!;
    expect(status.status).toBe('completed'); expect(status.exitCode).toBe(0);
    const read = await runtime.jobRead(job.id, 0, 1024 * 1024, owner);
    const expected = Buffer.concat([Buffer.from('READY\n'), output, Buffer.from('DONE=65536\n')]);
    expect(read.gap).toBeUndefined(); expect(read.retainedStartCursor).toBe(0);
    expect(read.bytes.equals(expected)).toBe(true); expect(read.nextCursor).toBe(expected.length);
    expect(status.endCursor).toBe(expected.length); expect(read.readState).toBe('eof');
  });

});
