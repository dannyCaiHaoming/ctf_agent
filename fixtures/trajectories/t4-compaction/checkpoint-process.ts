import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore, RecoverableSnapshotSchema, type RecoverableSnapshot } from '@ctf/state';
import { ToolRuntime } from '@ctf/runtime';
import { HypothesisManager, experimentFingerprint, saveCompactionCheckpoint, localActionCommand, createLocalResumeAuthorization } from '@ctf/supervisor';
import { ImmutableArtifactRefSchema } from '@ctf/contracts';

export async function prepareCompactionFixture(root: string, ownerPid = process.pid) {
  const stateRoot = join(root, 'state'); const artifactRoot = join(root, 'artifacts'); const workspace = join(root, 'workspaces', 'solver');
  await mkdir(workspace, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const fixture = resolve('fixtures/trajectories/t4-compaction');
  for (const file of ['inspect.cjs', 'continue.cjs', 'input.json']) await cp(join(fixture, file), join(workspace, file));
  const state = new StateStore(stateRoot, 'compaction-run'); const artifacts = new ArtifactStore(artifactRoot);
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'compaction-run', 'compaction-challenge');
  const capture = async (name: string) => {
    const ref = ImmutableArtifactRefSchema.parse(await artifacts.publish(await readFile(join(workspace, name)))); state.addCanonicalArtifact(ref); return ref;
  };
  const script = await capture('continue.cjs'); const input = await capture('input.json'); const inspect = await capture('inspect.cjs');
  const deadline = new Date(Date.now() + 90000).toISOString();
  const task = { run_id: 'compaction-run', challenge_id: 'compaction-challenge', task_id: 'solver', attempt_id: 'original-attempt', responsibility_set: ['domain_solver', 'strategy'], lease: { lease_id: 'original-lease', expires_at: deadline } };
  const appendReceipt = (receipt: unknown) => state.appendEvent({ kind: 'solver.activity', runId: 'compaction-run' as never, challengeId: 'compaction-challenge' as never, taskId: 'solver' as never, sessionId: 'original-session' as never, attemptId: 'original-attempt', activity: 'tool.result', data: { receipt_id: (receipt as { id: string }).id, receipt }, at: new Date().toISOString() });
  const manager = new HypothesisManager({ verifyArtifact: ref => artifacts.verify(ref), resolveRuntimeEvent: async id => {
    const event = state.events().find(value => value.kind === 'solver.activity' && value.data.receipt_id === id);
    if (!event || event.kind !== 'solver.activity') throw new Error('unknown canonical fixture receipt'); return event.data.receipt;
  }, validateProgress: async (claim, experiment) => {
    const text = (await artifacts.read(experiment.events[0]!.artifact_refs[0]!)).toString('utf8');
    if (claim.kind !== 'evidence' || claim.verdict !== 'rejected' || !text.startsWith('MODE=literal\n')) throw new Error('literal output does not substantiate rejected expression mechanism');
    return { substantiation: 'actual successful parser output explicitly identifies literal mode' };
  } });
  const declaration = (id: string) => ({ id, claim: id === 'expression' ? 'parser evaluates expressions' : 'payload XOR key exists in earlier raw observation', preconditions: ['local material available'], missing_preconditions: [], supporting_refs: [], contradicting_refs: [], alternative_explanations: ['literal material'], falsifier: 'explicit literal mode', minimal_experiment: 'run supplied local script', expected_observation: 'interpretable output', state_dependencies: { generation: 1 }, required_capabilities: ['local_process'], route_status: 'queued', next_action: 'run immutable script with raw observation', cost: { wall_ms: 90000, tokens: 100, remote_units: 0 }, state: 'proposed' });
  const plan = (id: string, hypothesis: string, command: string[]) => ({ id, hypothesis_id: hypothesis, objective: 'interpret supplied material', input_refs: [input], state_dependencies: { generation: 1 }, parameters: {}, procedure: [{ id: 'run', tool: 'job.run', input: { command } }], expected_support: 'decoded material', expected_refutation: 'literal mode', budget: { wall_ms: 90000, tokens: 100, remote_units: 0 }, repair_budget: 1, stop_condition: 'one successful output', expected_artifacts: ['raw stdout'] });
  manager.addHypothesis(declaration('expression')); manager.setRoutes({ primary: 'expression', counterprobe: null });
  const rejectedPlan = plan('rejected-experiment', 'expression', [process.execPath, inspect.path]);
  manager.startExperiment(rejectedPlan);
  const job = await runtime.jobStart({ taskId: 'solver', command: [process.execPath, inspect.path], cwd: workspace, timeoutMs: 10000, maxRetainedBytes: 1024 * 1024 });
  let cursor = 0;
  while (true) { const read = await runtime.jobRead(job.id, cursor); if (read.gap) throw new Error('fixture raw gap'); cursor = read.nextCursor; if (read.readState === 'eof') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  const range = await runtime.publishJobEvidence(job.id, 0, cursor);
  const rawRef = ImmutableArtifactRefSchema.parse({ hash: range.hash, size: range.size, path: range.path }); state.addCanonicalArtifact(rawRef);
  state.addEvidence({ id: 'original-observation', runId: 'compaction-run', source: 'observation', artifact: rawRef, startCursor: 0, endCursor: cursor });
  const receipt = { id: 'original-receipt', experiment_id: 'rejected-experiment', fingerprint: experimentFingerprint(rejectedPlan), step_id: 'run', outcome: 'success', failure_code: null, artifact_refs: [rawRef] };
  appendReceipt(receipt); await manager.recordRuntimeEvent(receipt.id); manager.completeExperiment('rejected-experiment');
  await manager.conclude('rejected-experiment', { verdict: 'rejected', rationale: 'actual output is explicitly literal', evidence_refs: [rawRef] }); manager.finishWindow();
  manager.addHypothesis(declaration('decode')); manager.setRoutes({ primary: 'decode', counterprobe: null });
  const action = { kind: 'local_node_script', action_id: 'decode-original-key', objective: 'decode input with original output key', experiment_id: 'pending-experiment', step_id: 'run', fingerprint: '0'.repeat(64), deadline, script_ref: script, input_refs: [input], observation_ids: ['original-observation'], arguments: [], expected_output: 'decoded printable material' };
  const raw = { id: 'original-observation', source: 'raw_observation', artifact: rawRef, start_byte: 0, end_byte: Buffer.byteLength('MODE=literal\nDECODING_KEY=73\n'), source_job: job.id, source_start_cursor: 0, source_end_cursor: cursor };
  const pendingCommand = localActionCommand({ next_action: action, raw_observations: [raw] } as unknown as RecoverableSnapshot);
  const pendingPlan = plan('pending-experiment', 'decode', pendingCommand); action.fingerprint = experimentFingerprint(pendingPlan); manager.startExperiment(pendingPlan);
  const snapshot = RecoverableSnapshotSchema.parse({ schema_version: 1, snapshot_id: `snapshot_${randomUUID()}`, sequence: 1, run_id: 'compaction-run', challenge: { id: 'compaction-challenge', description: 'Decode supplied local material from an earlier observation', resource_generation: 1 }, current_goal: 'continue previously admitted decoder', next_action: action,
    published: { latest_script_refs: [script], latest_input_refs: [input], workspace_files: [{ relative_path: 'continue.cjs', artifact: script }, { relative_path: 'input.json', artifact: input }] },
    hypothesis_manager: manager.exportSnapshot(), failed_fingerprints: [{ fingerprint: receipt.fingerprint, hypothesis_id: 'expression', no_redo_reason: 'successful raw observation explicitly reports literal mode', observation_ids: ['original-observation'] }],
    critical_values: [{ name: 'key_location', value: 'original-observation first line range; reopen it', observation_ids: ['original-observation'] }], raw_observations: [raw], active_handles: [], task, previous_session_id: 'original-session', deadline, captured_at: new Date().toISOString(),
    budget: { limit: { time_ms: 90000, tokens: 100, instances: 1, hints: 1, remote_units: 0 }, used: { time_ms: 1000, tokens: 7, instances: 0, hints: 0, remote_units: 0 }, remaining: { time_ms: 89000, tokens: 93, instances: 1, hints: 1, remote_units: 0 } }, process: { owner_pid: ownerPid, incarnation: 'original-incarnation' } });
  await saveCompactionCheckpoint(snapshot, { state, artifactRoot, assertCurrent: () => { if (Date.now() >= Date.parse(deadline)) throw new Error('fixture expired'); } });
  const authorization = await createLocalResumeAuthorization(snapshot, { stateRoot, artifactRoot, workspace, authorizeCommand: command => {
    if (command[0] !== process.execPath || command[1] !== script.path || command[2] !== input.path || command.length !== 4) throw new Error('only the pinned supplied local fixture command is authorized');
  } });
  const authorizationPath = join(root, 'local-authorization.json'); await writeFile(authorizationPath, JSON.stringify(authorization));
  await runtime.dispose(); state.close();
  return { snapshot, authorization, authorizationPath, stateRoot, artifactRoot, workspace };
}

if (process.argv[2] === '--deterministic-local-fixture') {
  const root = process.argv[3]; if (!root) throw new Error('new fixture root is required');
  const prepared = await prepareCompactionFixture(resolve(root));
  console.log(JSON.stringify({ ready: true, snapshot_id: prepared.snapshot.snapshot_id, authorization: prepared.authorizationPath, pid: process.pid }));
  setInterval(() => {}, 1000);
}
