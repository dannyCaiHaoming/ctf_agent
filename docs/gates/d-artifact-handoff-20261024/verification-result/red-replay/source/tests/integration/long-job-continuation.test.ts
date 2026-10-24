import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime, type RuntimeOwner } from '@ctf/runtime';
import { StateStore } from '@ctf/state';
import { DurableJobWatchService } from '../../packages/supervisor/src/long-job-watch.js';

const roots: string[] = [];
const runtimes: ToolRuntime[] = [];
const states: StateStore[] = [];
const owner: RuntimeOwner = { sessionId: 'long-job-session', leaseId: 'long-job-lease' };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'long-job-continuation-')); roots.push(root);
  const state = new StateStore(join(root, 'state'), 'long-job-run'); states.push(state);
  const runtime = new ToolRuntime(new ArtifactStore(join(root, 'artifacts')), join(root, 'workspaces'), 'long-job-run', 't3-fixture'); runtimes.push(runtime);
  runtime.registerTaskLease({ ...owner, taskId: 'solver', expiresAt: new Date(Date.now() + 10_000).toISOString() });
  const service = new DurableJobWatchService(runtime, state);
  return { root, state, runtime, service };
}
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  for (const state of states.splice(0)) state.close();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const services: DurableJobWatchService[] = [];

describe('durable long-job continuation', () => {
  it('releases the Worker, wakes from a terminal event, and claims one saved continuation', async () => {
    const { state, runtime, service } = await setup(); services.push(service);
    const job = await runtime.jobStart({ taskId: 'solver', owner, command: [process.execPath, '-e', 'setTimeout(()=>console.log("LONG_JOB_DONE"),250)'], timeoutMs: 3000 });
    const continuationRef = 'continuation:task-solver:experiment-long:step-2';
    await service.watch({ jobId: job.id, taskId: 'solver', experimentId: 'experiment-long', cursor: 0, continuationRef,
      deadline: new Date(Date.now() + 2500).toISOString(), owner });

    // The model Worker is released here. No periodic model call or polling is used while the process runs.
    const resumed = await service.awaitContinuation(job.id, owner);
    expect(resumed.terminalState).toBe('completed');
    expect(resumed.cursor).toBeGreaterThan(0);
    expect(resumed.experimentId).toBe('experiment-long');
    expect(state.pendingOutbox()).toHaveLength(1);
    const output = await runtime.jobRead(job.id, 0, 4096, owner);
    expect(output.bytes.toString()).toContain('LONG_JOB_DONE');

    // A repeated terminal delivery is idempotent and cannot create a second runnable claim.
    state.commitLongJobTerminal({ runId: 'long-job-run', jobId: job.id, eventId: resumed.terminalEventId!, state: 'completed', cursor: resumed.cursor, payload: { duplicate: true } });
    const claim = service.claimContinuation(job.id);
    expect(claim.claimState).toBe('claimed'); expect(claim.claimedContinuationRef).toBe(continuationRef);
    expect(service.claimContinuation(job.id)).toEqual(claim);
    expect(state.pendingOutbox()).toHaveLength(1);
    state.markOutboxDelivered(resumed.terminalEventId!);
    state.markOutboxDelivered(resumed.terminalEventId!);
    expect(state.pendingOutbox()).toHaveLength(0);
  });

  it('deadline cancels the managed job and wakes the same continuation error branch', async () => {
    const { runtime, service } = await setup(); services.push(service);
    const job = await runtime.jobStart({ taskId: 'solver', owner, command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 5000 });
    await service.watch({ jobId: job.id, taskId: 'solver', experimentId: 'experiment-deadline', cursor: 0, continuationRef: 'continuation:deadline',
      deadline: new Date(Date.now() + 50).toISOString(), owner });
    const resumed = await service.awaitContinuation(job.id, owner);
    expect(resumed.terminalState).toBe('error');
    expect(runtime.jobStatus(job.id, owner)?.status).toBe('timeout');
  });

  it('rejects a watch rebound to a different experiment or continuation', async () => {
    const { runtime, service } = await setup(); services.push(service);
    const job = await runtime.jobStart({ taskId: 'solver', owner, command: [process.execPath, '-e', 'setTimeout(()=>{},500)'], timeoutMs: 2000 });
    const input = { jobId: job.id, taskId: 'solver', experimentId: 'experiment-a', cursor: 0, continuationRef: 'continuation:a', deadline: new Date(Date.now() + 1500).toISOString(), owner };
    await service.watch(input);
    await expect(service.watch({ ...input, experimentId: 'experiment-b' })).rejects.toThrow(/immutable/);
    await expect(service.watch({ ...input, continuationRef: 'continuation:b' })).rejects.toThrow(/immutable/);
  });
});
