import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';
import { ToolRuntime } from '../../packages/runtime/src/index.js';

describe('batch stdout/stderr evidence for trajectory 1', () => {
  it.each([1024, 4])('retains separate streams and marks incomplete capture at %i bytes', async maxRetainedBytes => {
    const root = await mkdtemp(join(tmpdir(), 'batch-output-'));
    const runtime = new ToolRuntime(new ArtifactStore(join(root, 'store')), root, 'run', 'challenge');
    try {
      const job = await runtime.jobStart({ taskId: 'solver', command: [process.execPath, '-e',
        'process.stdout.write("stdout");process.stderr.write("stderr");process.exitCode=1'], maxRetainedBytes });
      await vi.waitUntil(() => runtime.jobStatus(job.id)?.status !== 'running');
      const output = runtime.jobOutput(job.id);
      expect(output.complete).toBe(maxRetainedBytes === 1024);
      if (output.complete) {
        expect(output.stdout.toString()).toBe('stdout'); expect(output.stderr.toString()).toBe('stderr');
      } else expect(output.stdout.length + output.stderr.length).toBeLessThanOrEqual(maxRetainedBytes);
    } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
  });
});
