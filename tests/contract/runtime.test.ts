import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';
import { ToolRuntime } from '../../packages/runtime/src/index.js';

describe('tool runtime', () => {
  it('rejects workspace escapes and treats .opencode as data-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-'));
    const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
    const ws = runtime.workspace('task1');
    await expect(ws.read('../secret')).rejects.toThrow(/outside/);
    await expect(ws.read('.opencode/config.json')).rejects.toThrow(/\.opencode/);
    await expect(ws.stat(join(root, 'outside.txt'))).rejects.toThrow(/outside/);
  });

  it('records jobs before launch, streams reads, and returns an explicit evicted cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-jobs-'));
    const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
    const job = await runtime.jobStart({ taskId: 'task1', command: ['node', '-e', 'process.stdout.write("0123456789")'], maxRetainedBytes: 5, timeoutMs: 3000 });
    expect(job.status).toBe('running');
    expect(runtime.jobStatus(job.id)?.id).toBe(job.id);
    await vi.waitUntil(() => runtime.jobStatus(job.id)?.status === 'completed');
    const evicted = await runtime.jobRead(job.id, 0, 100);
    expect(evicted.readState).toBe('cursor_evicted');
    expect(evicted.gap).toEqual({ from: 0, to: 5 });
    const current = await runtime.jobRead(job.id, evicted.nextCursor, 100);
    expect(current.bytes.toString()).toBe('56789');
    expect(current.retainedStartCursor).toBe(5);
    await runtime.jobCancel(job.id, 'cancelled');
  });

  it('terminates timeout process groups and avoids duplicate attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-timeout-'));
    const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
    const job = await runtime.jobStart({ taskId: 'task1', command: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 30 });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(runtime.jobStatus(job.id)?.status).toBe('timeout');
    expect(runtime.jobStart).toBeDefined();
  }, 5000);

  it('fails to publish evidence when a transcript gap exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-publish-'));
    const artifacts = new ArtifactStore(join(root, 'store'));
    const runtime = new ToolRuntime(artifacts, root, 'run', 'challenge');
    const job = await runtime.jobStart({ taskId: 'task1', command: ['node', '-e', 'process.stdout.write("abcdefghij")'], maxRetainedBytes: 4, timeoutMs: 3000 });
    await new Promise(resolve => setTimeout(resolve, 80));
    await expect(runtime.publishJobEvidence(job.id, 0, 10)).rejects.toThrow(/incomplete/);
    const read = await runtime.jobRead(job.id, 4, 10);
    const ref = await artifacts.publishRange('run', 'challenge', read.bytes, 4, 10);
    expect(ref.startCursor).toBe(4);
  });

  it('uses a filtered tool environment without provider/platform secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-env-'));
    const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
    const job = await runtime.jobStart({ taskId: 'task1', command: ['node', '-e', 'process.stdout.write(Object.keys(process.env).join(","))'], env: { OK: 'yes' }, timeoutMs: 3000 });
    await new Promise(resolve => setTimeout(resolve, 80));
    const read = await runtime.jobRead(job.id, 0, 1000);
    expect(read.bytes.toString()).not.toContain('MODEL_API_KEY');
    expect(read.bytes.toString()).toContain('OK');
  });
});
