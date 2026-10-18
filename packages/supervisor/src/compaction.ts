import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, open } from 'node:fs/promises';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import { ImmutableArtifactRefSchema } from '@ctf/contracts';
import { StateStore, RecoverableSnapshotSchema, snapshotArtifactRefs, RawObservationSchema, type RecoverableSnapshot, type RawObservation } from '@ctf/state';
import { ResponsibilityRegistry, freezeData } from './responsibilities.js';
import { HypothesisManager, type HypothesisManagerOptions } from './hypotheses.js';

export function compactSnapshot(input: unknown) {
  const snapshot = RecoverableSnapshotSchema.parse(input);
  // A bounded working set holds references and goals; full state/raw bytes remain in canonical stores.
  return freezeData({ snapshot_id: snapshot.snapshot_id, sequence: snapshot.sequence, current_goal: snapshot.current_goal,
    next_action: snapshot.next_action, critical_values: snapshot.critical_values,
    failed_fingerprints: snapshot.failed_fingerprints, raw_observations: snapshot.raw_observations,
    hypothesis_states: snapshot.hypothesis_manager.hypotheses.map(value => ({ id: value.id, state: value.state, next_action: value.next_action })),
    active_handles: snapshot.active_handles, deadline: snapshot.deadline, budget: snapshot.budget });
}

/** ArtifactStore itself is not a scope gate. Rehydration verifies both canonical DB identity and rooted real paths. */
export class SnapshotEvidenceReader {
  constructor(private readonly state: StateStore, private readonly artifactRoot: string, private readonly assertCurrent: () => void) {
  }
  private async readVerified(input: { hash: string; size: number; path: string }): Promise<Buffer> {
    const ref = ImmutableArtifactRefSchema.parse(input);
    this.assertCurrent();
    const canonical = this.state.canonicalArtifact(ref.hash);
    if (!canonical || canonical.path !== ref.path || canonical.size !== ref.size) throw new Error('artifact is not canonical');
    const base = await realpath(this.artifactRoot);
    const expected = join(base, ref.hash.slice(0, 2), ref.hash);
    const actual = await realpath(ref.path);
    if (actual !== expected || !actual.startsWith(base + sep)) throw new Error('artifact path escapes authorized store');
    const file = await open(expected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      if (!(await file.stat()).isFile()) throw new Error('immutable artifact is not a regular file');
      bytes = await file.readFile();
    } finally { await file.close(); }
    if (bytes.length !== ref.size) throw new Error('artifact size mismatch');
    if (createHash('sha256').update(bytes).digest('hex') !== ref.hash) throw new Error('artifact hash mismatch');
    if (await realpath(ref.path) !== expected || await realpath(this.artifactRoot) !== base) throw new Error('artifact path changed outside authorized store during read');
    this.assertCurrent();
    return bytes;
  }
  async verify(ref: { hash: string; size: number; path: string }): Promise<true> {
    await this.readVerified(ref);
    return true;
  }
  async readRaw(input: unknown): Promise<Buffer> {
    const raw = RawObservationSchema.parse(input);
    const evidence = this.state.observationEvidence(raw.id);
    if (!evidence || evidence.artifact.hash !== raw.artifact.hash || evidence.startCursor !== raw.source_start_cursor || evidence.endCursor !== raw.source_end_cursor) throw new Error('verification requires original canonical raw observation, never summary-only evidence');
    const bytes = await this.readVerified(raw.artifact);
    return bytes.subarray(raw.start_byte, raw.end_byte);
  }
}

export async function saveCompactionCheckpoint(input: unknown, options: { state: StateStore; artifactRoot: string; assertCurrent: () => void }): Promise<RecoverableSnapshot> {
  const snapshot = RecoverableSnapshotSchema.parse(input);
  const reader = new SnapshotEvidenceReader(options.state, options.artifactRoot, options.assertCurrent);
  for (const ref of snapshotArtifactRefs(snapshot)) await reader.verify(ref);
  for (const raw of snapshot.raw_observations) await reader.readRaw(raw);
  options.assertCurrent();
  return options.state.saveRecoverableSnapshot(snapshot);
}

export function localActionCommand(snapshot: RecoverableSnapshot): string[] {
  const action = snapshot.next_action;
  const observations = action.observation_ids.map(id => {
    const raw = snapshot.raw_observations.find(value => value.id === id);
    if (!raw) throw new Error('missing original observation');
    return { id, path: raw.artifact.path, start_byte: raw.start_byte, end_byte: raw.end_byte };
  });
  return [process.execPath, action.script_ref.path, ...action.input_refs.map(ref => ref.path), ...action.arguments, JSON.stringify(observations)];
}

export async function verifySnapshotWorkspace(snapshot: RecoverableSnapshot, workspacePath: string): Promise<void> {
  const workspace = await realpath(workspacePath);
  for (const file of snapshot.published.workspace_files) {
    if (isAbsolute(file.relative_path) || file.relative_path.split(/[\\/]/).includes('..')) throw new Error('workspace position escapes authorized workspace');
    const location = await realpath(resolve(workspace, file.relative_path));
    if (!location.startsWith(workspace + sep)) throw new Error('workspace symlink escapes authorized workspace');
    const bytes = await readFile(location);
    if (bytes.length !== file.artifact.size || createHash('sha256').update(bytes).digest('hex') !== file.artifact.hash) throw new Error('workspace file differs from published checkpoint');
  }
}

export async function restoreCompactionSession(options: {
  state: StateStore; artifactRoot: string; workspace: string; snapshot: unknown;
  now?: () => number; validateProgress: HypothesisManagerOptions['validateProgress'];
}) {
  const snapshot = RecoverableSnapshotSchema.parse(options.snapshot);
  const now = options.now ?? Date.now;
  let registry: ResponsibilityRegistry | undefined; let sessionId: string | undefined;
  const assertCurrent = () => {
    const current = now();
    if (current >= Date.parse(snapshot.next_action.deadline)) throw new Error('original pending action deadline expired');
    if (current >= Date.parse(snapshot.deadline)) throw new Error('original run deadline expired');
    if (current >= Date.parse(snapshot.task.lease.expires_at)) throw new Error('original task lease expired');
    if (snapshot.budget.remaining.time_ms <= current - Date.parse(snapshot.captured_at)) throw new Error('original time budget exhausted');
    if (registry && sessionId) registry.binding(sessionId);
  };
  assertCurrent();
  const reader = new SnapshotEvidenceReader(options.state, options.artifactRoot, assertCurrent);
  for (const ref of snapshotArtifactRefs(snapshot)) await reader.verify(ref);
  for (const raw of snapshot.raw_observations) await reader.readRaw(raw);
  await verifySnapshotWorkspace(snapshot, options.workspace);
  registry = new ResponsibilityRegistry({ verifyArtifact: ref => reader.verify(ref), now });
  registry.createTask(snapshot.task);
  sessionId = `resume_${randomUUID()}`;
  const context = registry.createReasoningContext();
  registry.bindSession({ task_id: snapshot.task.task_id, session_id: sessionId, context });
  const manager = await HypothesisManager.restoreSnapshot(snapshot.hypothesis_manager, {
    verifyArtifact: ref => reader.verify(ref), assertCurrent, validateProgress: options.validateProgress,
    resolveRuntimeEvent: async id => {
      const event = options.state.events().find(value => value.kind === 'solver.activity' && value.activity === 'tool.result' && value.data.receipt_id === id);
      if (!event || event.kind !== 'solver.activity' || event.runId !== snapshot.run_id || event.challengeId !== snapshot.challenge.id || event.taskId !== snapshot.task.task_id || event.attemptId !== snapshot.task.attempt_id) throw new Error('unknown or foreign canonical runtime receipt');
      return event.data.receipt;
    }
  });
  const experiment = manager.experiment(snapshot.next_action.experiment_id);
  const step = experiment.plan.procedure[experiment.events.filter(value => value.outcome === 'success').length];
  if (JSON.stringify(step?.input) !== JSON.stringify({ command: localActionCommand(snapshot) })) throw new Error('next action command differs from admitted pending experiment');
  assertCurrent();
  return { snapshot, workingSet: compactSnapshot(snapshot), registry, manager, sessionId, context, reader, assertCurrent,
    async readObservation(id: string): Promise<Buffer> {
      const raw = snapshot.raw_observations.find(value => value.id === id);
      if (!raw) throw new Error('unknown original raw observation');
      return reader.readRaw(raw);
    } };
}
