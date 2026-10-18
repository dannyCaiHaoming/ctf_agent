import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateStore, nextActionDigest, RecoverableSnapshotSchema, type RecoverableSnapshot, type ResumeResult } from '@ctf/state';
import { ArtifactStore } from '@ctf/artifacts';
import { ImmutableArtifactRefSchema } from '@ctf/contracts';
import { ToolRuntime } from '@ctf/runtime';
import { localActionCommand, restoreCompactionSession, verifySnapshotWorkspace } from './compaction.js';

const Text = z.string().min(1);
export const LocalResumeAuthorizationSchema = z.object({
  version: z.literal(1), kind: z.literal('host_authorized_local_resume'), run_id: Text, challenge_id: Text,
  resource_generation: z.number().int().nonnegative().safe(), snapshot_id: Text,
  next_action_digest: z.string().regex(/^[a-f0-9]{64}$/), state_root: Text, artifact_root: Text, workspace: Text,
  script_hash: z.string().regex(/^[a-f0-9]{64}$/), input_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  expires_at: z.string().datetime(), remote_units: z.literal(0)
}).strict();
export type LocalResumeAuthorization = z.infer<typeof LocalResumeAuthorizationSchema>;

/** Host calls this while checkpointing an already authorized local command. No worker can mint grants. */
export async function createLocalResumeAuthorization(input: unknown, options: {
  stateRoot: string; artifactRoot: string; workspace: string;
  authorizeCommand: (command: readonly string[], cwd: string) => void | Promise<void>;
}): Promise<LocalResumeAuthorization> {
  const snapshot = RecoverableSnapshotSchema.parse(input);
  const workspace = await realpath(options.workspace);
  await options.authorizeCommand(localActionCommand(snapshot), workspace);
  if (Date.now() >= Math.min(Date.parse(snapshot.next_action.deadline), Date.parse(snapshot.deadline), Date.parse(snapshot.task.lease.expires_at))) throw new Error('cannot authorize expired checkpoint');
  return LocalResumeAuthorizationSchema.parse({ version: 1, kind: 'host_authorized_local_resume',
    run_id: snapshot.run_id, challenge_id: snapshot.challenge.id, resource_generation: snapshot.challenge.resource_generation,
    snapshot_id: snapshot.snapshot_id, next_action_digest: nextActionDigest(snapshot.next_action),
    state_root: await realpath(options.stateRoot), artifact_root: await realpath(options.artifactRoot), workspace,
    script_hash: snapshot.next_action.script_ref.hash, input_hashes: snapshot.next_action.input_refs.map(ref => ref.hash),
    expires_at: new Date(Math.min(Date.parse(snapshot.next_action.deadline), Date.parse(snapshot.deadline), Date.parse(snapshot.task.lease.expires_at))).toISOString(), remote_units: 0 });
}

function assertDead(pid: number): void {
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw new Error('cannot prove previous checkpoint process stopped'); }
  throw new Error('previous checkpoint process is still alive; refusing concurrent restart');
}

export async function resumeLocalCheckpoint(options: { stateRoot: string; runId: string; authorization: unknown }): Promise<ResumeResult> {
  const policy = LocalResumeAuthorizationSchema.parse(options.authorization);
  if (!/^[a-zA-Z0-9_-]+$/.test(options.runId)) throw new Error('invalid local run id');
  const stateRoot = await realpath(options.stateRoot);
  if (stateRoot !== policy.state_root || policy.run_id !== options.runId) throw new Error('local resume authorization scope mismatch');
  const state = new StateStore(stateRoot, options.runId);
  let runtime: ToolRuntime | undefined;
  try {
    const checkpoint = state.loadRecoverableSnapshot();
    if (!checkpoint) throw new Error('canonical SQLite recoverable checkpoint missing');
    if (checkpoint.action_state !== 'ready') throw new Error(`next action is ${checkpoint.action_state}; refusing completed or unknown-action replay`);
    const snapshot = checkpoint.snapshot;
    assertDead(snapshot.process.owner_pid);
    if (snapshot.active_handles.some(value => value.state === 'active')) throw new Error('active process/channel handles require fail-stop reconciliation; local resume cannot adopt them');
    const authorize = () => {
      if (policy.snapshot_id !== snapshot.snapshot_id || policy.challenge_id !== snapshot.challenge.id || policy.resource_generation !== snapshot.challenge.resource_generation || policy.next_action_digest !== nextActionDigest(snapshot.next_action) || policy.script_hash !== snapshot.next_action.script_ref.hash || JSON.stringify(policy.input_hashes) !== JSON.stringify(snapshot.next_action.input_refs.map(ref => ref.hash))) throw new Error('exact pending action is outside host local authorization');
      if (Date.now() >= Date.parse(policy.expires_at)) throw new Error('local resume authorization expired');
      const experiment = snapshot.hypothesis_manager.experiments.find(value => value.plan.id === snapshot.next_action.experiment_id)!;
      if (experiment.plan.budget.remote_units !== 0) throw new Error('local resume permits zero declared remote units only');
    };
    authorize();
    const session = await restoreCompactionSession({ state, artifactRoot: policy.artifact_root, workspace: policy.workspace, snapshot,
      // Recovery retains previously validated facts; new semantic conclusions need a separately supplied trusted discriminator.
      validateProgress: async () => { throw new Error('local restart cannot substantiate new semantic claims'); } });
    authorize(); session.assertCurrent();
    const artifacts = new ArtifactStore(policy.artifact_root);
    if (/[\\/]/.test(snapshot.task.task_id) || ['.', '..'].includes(snapshot.task.task_id)) throw new Error('task identity escapes authorized workspace');
    runtime = new ToolRuntime(artifacts, dirname(policy.workspace), snapshot.run_id, snapshot.challenge.id);
    if (await realpath(runtime.workspace(snapshot.task.task_id).path) !== await realpath(policy.workspace)) throw new Error('runtime task workspace differs from authorized workspace');
    const owner = { sessionId: session.sessionId, leaseId: snapshot.task.lease.lease_id };
    runtime.registerTaskLease({ ...owner, taskId: snapshot.task.task_id, expiresAt: snapshot.task.lease.expires_at });
    const command = localActionCommand(snapshot);
    // Actual cwd must be the already-authorized workspace, not Runtime's generated task subdirectory.
    authorize(); session.assertCurrent();
    for (const ref of [snapshot.next_action.script_ref, ...snapshot.next_action.input_refs]) await session.reader.verify(ref);
    for (const id of snapshot.next_action.observation_ids) await session.readObservation(id);
    authorize(); session.assertCurrent();
    state.claimSnapshotAction(snapshot.snapshot_id, process.pid);
    const started = Date.now();
    let jobId: string | undefined;
    const chunks: Buffer[] = [];
    let output = Buffer.alloc(0); let exitCode: number | null = null; let reason: string | null = null;
    try {
      const budgetLeft = snapshot.budget.remaining.time_ms - (Date.now() - Date.parse(snapshot.captured_at));
      const job = await runtime.jobStart({ taskId: snapshot.task.task_id, owner, command, cwd: policy.workspace,
        timeoutMs: Math.max(1, Math.min(budgetLeft, Date.parse(snapshot.next_action.deadline) - Date.now(), Date.parse(snapshot.deadline) - Date.now(), Date.parse(snapshot.task.lease.expires_at) - Date.now())), maxRetainedBytes: 1024 * 1024 });
      jobId = job.id;
      let cursor = 0;
      while (true) {
        try { authorize(); session.assertCurrent(); }
        catch (error) { await runtime.jobCancel(job.id, 'timeout', owner); throw error; }
        const read = await runtime.jobRead(job.id, cursor, 65536, owner);
        if (read.gap || read.readState === 'cursor_evicted' || read.readState === 'lost') throw new Error('original resumed output has an unrecoverable range gap');
        if (read.bytes.length) { chunks.push(read.bytes); cursor = read.nextCursor; }
        if (read.readState === 'eof') break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      output = Buffer.concat(chunks);
      const current = runtime.jobStatus(job.id, owner)!; exitCode = current.exitCode;
      if (current.status !== 'completed') reason = `local command ${current.status}`;
      authorize(); session.assertCurrent();
      // Recheck immutable dependencies and workspace state after actual execution before accepting it.
      for (const ref of [snapshot.next_action.script_ref, ...snapshot.next_action.input_refs]) await session.reader.verify(ref);
      for (const id of snapshot.next_action.observation_ids) await session.readObservation(id);
      await verifySnapshotWorkspace(snapshot, policy.workspace);
      authorize(); session.assertCurrent();
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      if (jobId) { try { await runtime.jobCancel(jobId, 'cancelled', owner); } catch { /* dispose handles expired ownership below */ } }
      await runtime.dispose();
      // This is a diagnostic receipt; it never becomes successful mechanism evidence.
      output = Buffer.concat([Buffer.concat(chunks), Buffer.from(`\nresume failure: ${reason}\n`)]);
    }
    const ref = await artifacts.publish(output);
    state.addCanonicalArtifact(ref);
    const receiptId = `resume_receipt_${randomUUID()}`;
    let success = reason === null && exitCode === 0;
    const receipt = { id: receiptId, experiment_id: snapshot.next_action.experiment_id, fingerprint: snapshot.next_action.fingerprint,
      step_id: snapshot.next_action.step_id, outcome: success ? 'success' : 'failure', failure_code: success ? null : 'tool_invocation_error', artifact_refs: [ref] };
    state.appendEvent({ kind: 'solver.activity', runId: snapshot.run_id as never, challengeId: snapshot.challenge.id as never,
      taskId: snapshot.task.task_id, sessionId: session.sessionId as never, attemptId: snapshot.task.attempt_id,
      activity: 'tool.result', data: { receipt_id: receiptId, tool: 'job.run', receipt, restored_from: snapshot.snapshot_id }, at: new Date().toISOString() });
    // Retain ordinary failed receipts in the original experiment. Revoked/expired authority
    // preserves diagnostics only and cannot advance the state machine.
    let mayRecord = true;
    try { authorize(); session.assertCurrent(); } catch { mayRecord = false; }
    if (mayRecord) {
      await session.manager.recordRuntimeEvent(receiptId);
      const experiment = session.manager.experiment(snapshot.next_action.experiment_id);
      if (!success || experiment.events.filter(value => value.outcome === 'success').length === experiment.plan.procedure.length) session.manager.completeExperiment(snapshot.next_action.experiment_id);
    }
    try { authorize(); session.assertCurrent(); } catch (error) { success = false; reason = error instanceof Error ? error.message : String(error); }
    const wallMs = Date.now() - started;
    const elapsed = Math.max(0, Date.now() - Date.parse(snapshot.captured_at));
    const timeCharged = Math.min(snapshot.budget.remaining.time_ms, elapsed);
    const result: ResumeResult = { output_ref: ImmutableArtifactRefSchema.parse(ref), exit_code: exitCode, wall_ms: wallMs, state: success ? 'completed' : 'failed', reason,
      hypothesis_manager: session.manager.exportSnapshot(),
      budget_used: { ...snapshot.budget.used, time_ms: snapshot.budget.used.time_ms + timeCharged },
      budget_remaining: { ...snapshot.budget.remaining, time_ms: snapshot.budget.remaining.time_ms - timeCharged },
      session_id: session.sessionId, context_id: session.context.id,
      lost_handle_ids: snapshot.active_handles.filter(value => value.state === 'lost').map(value => value.id), model_calls: 0 };
    state.finishSnapshotAction(snapshot.snapshot_id, process.pid, result);
    return result;
  } finally { if (runtime) await runtime.dispose(); state.close(); }
}
