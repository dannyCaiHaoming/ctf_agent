import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { StateStore, type RecoverableSnapshot } from '@ctf/state';
import { resumeLocalCheckpoint, createLocalResumeAuthorization, compactSnapshot } from '@ctf/supervisor';
import { prepareCompactionFixture } from '../../fixtures/trajectories/t4-compaction/checkpoint-process.js';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('strict local restart authorization/reconciliation', () => {
  let root: string; let fixture: Awaited<ReturnType<typeof prepareCompactionFixture>>;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'compaction-guards-')); fixture = await prepareCompactionFixture(root, 2147483647); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const resume = (authorization: unknown = fixture.authorization) => resumeLocalCheckpoint({ stateRoot: fixture.stateRoot, runId: 'compaction-run', authorization });
  const update = async (mutate: (snapshot: RecoverableSnapshot) => void) => {
    const snapshot = structuredClone(fixture.snapshot); snapshot.sequence++; snapshot.snapshot_id += '-updated'; mutate(snapshot);
    const state = new StateStore(fixture.stateRoot, 'compaction-run'); state.saveRecoverableSnapshot(snapshot); state.close();
    return { snapshot, policy: await createLocalResumeAuthorization(snapshot, { stateRoot: fixture.stateRoot, artifactRoot: fixture.artifactRoot, workspace: fixture.workspace, authorizeCommand: () => {} }) };
  };

  it('requires host-pinned exact action/scope, refuses expired grants and never reads exported JSON as authorization', async () => {
    for (const policy of [ { ...fixture.authorization, run_id: 'other-run' }, { ...fixture.authorization, resource_generation: 2 },
      { ...fixture.authorization, next_action_digest: 'f'.repeat(64) }, { ...fixture.authorization, input_hashes: [] },
      { ...fixture.authorization, expires_at: new Date(Date.now() - 1).toISOString() } ]) await expect(resume(policy)).rejects.toThrow(/authorization/);
    await expect(resume({ next_action: 'node arbitrary.js', artifact: 'summary-only' })).rejects.toThrow();
    const state = new StateStore(fixture.stateRoot, 'compaction-run'); expect(state.loadRecoverableSnapshot()!.action_state).toBe('ready'); state.close();
  });

  it('preserves typed completion subscriptions in compaction, but refuses active-handle adoption on restart', async () => {
    const { snapshot, policy } = await update(snapshot => { snapshot.active_handles.push({ id: 'long-job', kind: 'job', state: 'active', owner_task: snapshot.task.task_id, experiment_id: 'pending-experiment', cursor: 27, deadline: snapshot.deadline,
      completion_subscription: { id: 'watch-1', waiting_task: snapshot.task.task_id, continuation_ref: snapshot.next_action.script_ref, state: 'waiting' } }); });
    expect(compactSnapshot(snapshot).active_handles).toEqual(snapshot.active_handles);
    await expect(resume(policy)).rejects.toThrow(/cannot adopt/);
  });

  it('fails closed when a prior dispatch has unknown outcome and cannot replace that checkpoint', async () => {
    const state = new StateStore(fixture.stateRoot, 'compaction-run'); state.claimSnapshotAction(fixture.snapshot.snapshot_id, 2147483647);
    expect(() => state.saveRecoverableSnapshot({ ...fixture.snapshot, sequence: 2, snapshot_id: 'replacement' })).toThrow(/must be reconciled/); state.close();
    await expect(resume()).rejects.toThrow(/unknown-action replay/);
  });

  it('missing required persisted fields fail actual recovery with named errors, without silently filling defaults', async () => {
    const paths: string[][] = [];
    const add = (path: string[], object: object) => { for (const key of Object.keys(object)) paths.push([...path, key]); };
    const snapshot = fixture.snapshot;
    add([], snapshot); add(['challenge'], snapshot.challenge); add(['next_action'], snapshot.next_action); add(['published'], snapshot.published);
    add(['raw_observations', '0'], snapshot.raw_observations[0]!); add(['task'], snapshot.task); add(['task', 'lease'], snapshot.task.lease);
    add(['budget'], snapshot.budget); for (const key of ['limit', 'used', 'remaining'] as const) add(['budget', key], snapshot.budget[key]);
    add(['hypothesis_manager'], snapshot.hypothesis_manager); add(['process'], snapshot.process);
    const db = new DatabaseSync(join(fixture.stateRoot, 'compaction-run.sqlite'));
    try {
      for (const path of paths) {
        const damaged: any = structuredClone(snapshot); let parent = damaged;
        for (const segment of path.slice(0, -1)) parent = parent[segment]; delete parent[path.at(-1)!];
        db.prepare('UPDATE recoverable_snapshots SET payload = ? WHERE snapshot_id = ?').run(JSON.stringify(damaged), snapshot.snapshot_id);
        await expect(resume(), `missing persisted ${path.join('.')}`).rejects.toThrow(path.at(-1)!);
      }
    } finally { db.prepare('UPDATE recoverable_snapshots SET payload = ? WHERE snapshot_id = ?').run(JSON.stringify(snapshot), snapshot.snapshot_id); db.close(); }
    const state = new StateStore(fixture.stateRoot, 'compaction-run'); expect(state.loadRecoverableSnapshot()!.action_state).toBe('ready'); state.close();
  });

  it('checks workspace integrity after command completion and retains failure diagnostics in canonical experiment state', async () => {
    // Host explicitly authorizes a local fixture script that changes the original working file.
    // Recovery must reject successful command exit as sufficient integrity proof.
    const scriptText = `const fs = require('node:fs'); console.log('observed-before-failure'); fs.writeFileSync('input.json', 'changed');`;
    const { ArtifactStore } = await import('@ctf/artifacts');
    const { experimentFingerprint } = await import('@ctf/supervisor');
    const store = new ArtifactStore(fixture.artifactRoot); const script = await store.publish(Buffer.from(scriptText));
    const state = new StateStore(fixture.stateRoot, 'compaction-run'); state.addCanonicalArtifact(script); state.close();
    const { policy } = await update(snapshot => {
      snapshot.next_action.script_ref = script as any; snapshot.published.latest_script_refs = [script as any];
      const plan = snapshot.hypothesis_manager.experiments.find(value => value.plan.id === 'pending-experiment')!;
      const command = (plan.plan.procedure[0]!.input as { command: string[] }).command; command[1] = script.path;
      const oldFingerprint = plan.fingerprint; plan.fingerprint = experimentFingerprint(plan.plan); snapshot.next_action.fingerprint = plan.fingerprint;
      snapshot.hypothesis_manager.fingerprints.find(value => value.fingerprint === oldFingerprint)!.fingerprint = plan.fingerprint;
    });
    const result = await resume(policy);
    expect(result.state).toBe('failed'); expect(result.reason).toContain('workspace file differs');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(result.output_ref.path, 'utf8')).toContain('observed-before-failure');
    expect(result.hypothesis_manager.experiments.find(value => value.plan.id === 'pending-experiment')!.status).toBe('failed');
    await expect(resume(policy)).rejects.toThrow(/unknown-action replay/);
  });
});
