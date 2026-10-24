import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore, RecoverableSnapshotSchema } from '@ctf/state';
import { compactSnapshot, restoreCompactionSession, SnapshotEvidenceReader } from '@ctf/supervisor';
import { LocalCompactionAdapter } from '@ctf/opencode-bridge';
import { prepareCompactionFixture } from '../../fixtures/trajectories/t4-compaction/checkpoint-process.js';

describe('fresh compaction evidence/context', () => {
  let root: string; let fixture: Awaited<ReturnType<typeof prepareCompactionFixture>>; let state: StateStore;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'compaction-evidence-')); fixture = await prepareCompactionFixture(root, 2147483647); state = new StateStore(fixture.stateRoot, 'compaction-run'); });
  afterEach(async () => { state.close(); await rm(root, { recursive: true, force: true }); });
  const noNewSemantics = async () => { throw new Error('new claims require trusted semantics'); };
  const restore = () => restoreCompactionSession({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot: fixture.snapshot, validateProgress: noNewSemantics });

  it('creates short worksets and new registry sessions, recovers exact original bytes and denies Solver context reuse for Verification', async () => {
    const originalBytes = await readFile(fixture.snapshot.raw_observations[0]!.artifact.path);
    const workingSet = compactSnapshot(fixture.snapshot);
    expect(JSON.stringify(workingSet).length).toBeLessThan(originalBytes.length / 10);
    const first = await restore();
    const adapter = await new LocalCompactionAdapter().recreate({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot: fixture.snapshot, validateProgress: noNewSemantics });
    expect(adapter.workingSet.snapshot_id).toBe(fixture.snapshot.snapshot_id);
    expect(adapter.sessionId).not.toBe(first.sessionId);
    expect(adapter.context).not.toBe(first.context);
    expect((await adapter.readObservation('original-observation')).toString()).toBe('MODE=literal\nDECODING_KEY=73\n');
    expect(first.manager.exportSnapshot()).toEqual(fixture.snapshot.hypothesis_manager);
    expect(() => first.manager.setRoutes({ primary: 'expression', counterprobe: null })).toThrow(/rejected/);
    const rejected = fixture.snapshot.hypothesis_manager.hypotheses.find(value => value.id === 'expression')!;
    first.manager.addHypothesis({ ...rejected, id: 'renamed-expression', state: 'proposed', route_status: 'queued' });
    first.manager.abandonExperiment('pending-experiment', 'host confirms no tool was dispatched; inspect deduplication guard');
    first.manager.setRoutes({ primary: 'renamed-expression', counterprobe: null });
    const oldPlan = fixture.snapshot.hypothesis_manager.experiments.find(value => value.plan.id === 'rejected-experiment')!.plan;
    expect(() => first.manager.startExperiment({ ...oldPlan, id: 'renamed-experiment', hypothesis_id: 'renamed-expression' })).toThrow(/duplicate experiment fingerprint/);
    first.registry.createTask({ ...fixture.snapshot.task, task_id: 'independent-verifier', responsibility_set: ['verification'] });
    expect(() => first.registry.bindSession({ session_id: 'verifier-session', task_id: 'independent-verifier', context: first.context })).toThrow(/different task/);
  });

  it('names every missing required snapshot field, including budgets, next action, raw ranges and manager ledgers', () => {
    const paths: string[][] = [];
    const add = (path: string[], object: object) => { for (const key of Object.keys(object)) paths.push([...path, key]); };
    const snapshot = fixture.snapshot;
    add([], snapshot); add(['challenge'], snapshot.challenge); add(['next_action'], snapshot.next_action); add(['published'], snapshot.published);
    add(['raw_observations', '0'], snapshot.raw_observations[0]!); add(['task'], snapshot.task); add(['task', 'lease'], snapshot.task.lease);
    add(['budget'], snapshot.budget); for (const key of ['limit', 'used', 'remaining'] as const) add(['budget', key], snapshot.budget[key]);
    add(['hypothesis_manager'], snapshot.hypothesis_manager); add(['process'], snapshot.process);
    for (const path of paths) {
      const damaged: any = structuredClone(snapshot); let parent = damaged;
      for (const segment of path.slice(0, -1)) parent = parent[segment];
      delete parent[path.at(-1)!];
      const parsed = RecoverableSnapshotSchema.safeParse(damaged);
      expect(parsed.success, `missing ${path.join('.')}`).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some(issue => issue.path.join('.') === path.join('.')), `named ${path.join('.')}`).toBe(true);
    }
    expect(paths.length).toBeGreaterThan(80);
  });

  it('refuses summary chains, unpublished observations, range gaps and rejected next fingerprints', async () => {
    const reader = new SnapshotEvidenceReader(state, fixture.artifactRoot, () => {});
    await expect(reader.readRaw({ source: 'summary', summary: 'refer to earlier summary', refs: ['summary-2'] })).rejects.toThrow();
    await expect(reader.readRaw({ ...fixture.snapshot.raw_observations[0]!, id: 'unpublished-summary' })).rejects.toThrow(/original canonical raw/);
    expect(() => RecoverableSnapshotSchema.parse({ ...fixture.snapshot, raw_observations: [] })).toThrow(/missing original raw|at least 1/);
    expect(() => RecoverableSnapshotSchema.parse({ ...fixture.snapshot, raw_observations: [{ ...fixture.snapshot.raw_observations[0]!, end_byte: 99999999 }] })).toThrow(/outside artifact/);
    expect(() => RecoverableSnapshotSchema.parse({ ...fixture.snapshot, next_action: { ...fixture.snapshot.next_action, fingerprint: fixture.snapshot.failed_fingerprints[0]!.fingerprint } })).toThrow(/redo a rejected/);
  });

  it('rejects immutable artifact tampering and external symlinks despite matching lexical paths', async () => {
    const raw = fixture.snapshot.raw_observations[0]!;
    await writeFile(raw.artifact.path, Buffer.alloc(raw.artifact.size, 65));
    await expect(restore()).rejects.toThrow(/hash mismatch/);
    const external = join(root, 'external-data'); await writeFile(external, Buffer.alloc(raw.artifact.size, 65));
    await unlink(raw.artifact.path); await symlink(external, raw.artifact.path);
    await expect(restore()).rejects.toThrow(/escapes authorized store/);
  });

  it('rejects workspace changes and outside paths', async () => {
    await writeFile(join(fixture.workspace, 'continue.cjs'), '// changed by another process');
    await expect(restore()).rejects.toThrow(/workspace file differs/);
    const snapshot = structuredClone(fixture.snapshot); snapshot.published.workspace_files[0]!.relative_path = '../outside';
    await expect(restoreCompactionSession({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot, validateProgress: noNewSemantics })).rejects.toThrow(/escapes authorized workspace/);
  });

  it('checks original deadline/lease and authority again after awaited evidence reads', async () => {
    const snapshot = fixture.snapshot;
    await expect(restoreCompactionSession({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot, now: () => Date.parse(snapshot.deadline) + 1, validateProgress: noNewSemantics })).rejects.toThrow(/deadline expired/);
    const earlierLease = { ...snapshot, task: { ...snapshot.task, lease: { ...snapshot.task.lease, expires_at: new Date(Date.parse(snapshot.captured_at) + 1000).toISOString() } } };
    await expect(restoreCompactionSession({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot: earlierLease, now: () => Date.parse(snapshot.captured_at) + 2000, validateProgress: noNewSemantics })).rejects.toThrow(/lease expired/);
    let reads = 0;
    await expect(restoreCompactionSession({ state, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, snapshot, now: () => ++reads < 4 ? Date.parse(snapshot.captured_at) : Date.parse(snapshot.deadline) + 1, validateProgress: noNewSemantics })).rejects.toThrow(/deadline expired/);
  });

  it('rechecks revocation on later cross-session raw reads', async () => {
    const session = await restore();
    session.registry.revokeLease(fixture.snapshot.task.task_id, fixture.snapshot.task.lease.lease_id);
    await expect(session.readObservation('original-observation')).rejects.toThrow(/lease revoked/);
  });
});
