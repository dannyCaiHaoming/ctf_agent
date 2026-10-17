import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunIdSchema } from '../../packages/contracts/src/index.js';
import { StateStore } from '../../packages/state/src/index.js';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';

function budget() { return { wallClockMs: 1000, maxSteps: 10, maxToolJobs: 5, maxObservableTokens: 1000 }; }

describe('state', () => {
  it('validates events, checkpoints, and exports canonical state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-'));
    const state = new StateStore(root, 'run_1');
    expect(() => state.appendEvent({ kind: 'run.state', runId: RunIdSchema.parse('run_1'), from: 'draft', to: 'starting', at: new Date().toISOString() })).not.toThrow();
    const paths = state.runPaths('eval', 'unique');
    expect(paths.statePath).toContain(join('runs', 'eval', 'unique'));
    state.saveCheckpoint({ runId: 'run_1', challengeId: 'c', target: 'http://x', nextAction: 'recon', stage: 'recon', publishedRefs: [], rejectedFingerprints: ['fp1'], activeJobCursors: { job: 4 }, usedBudget: budget() });
    expect(state.loadCheckpoint('run_1')).toMatchObject({ nextAction: 'recon', rejectedFingerprints: ['fp1'], activeJobCursors: { job: 4 } });
    state.exportJson(join(paths.root, 'events.jsonl'), join(paths.root, 'state.json'));
    state.close();
  });

  it('requires an observation source before evidence can be promoted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-evidence-'));
    const artifacts = new ArtifactStore(join(root, 'store'));
    const state = new StateStore(root, 'run_1');
    const ref = await artifacts.publish(Buffer.from('evidence'));
    state.addCanonicalArtifact(ref);
    expect(() => state.addEvidence({ id: 'e1', runId: 'run_1', source: 'fabricated' as never, artifact: ref, startCursor: 0, endCursor: 1 })).toThrow(/observation/);
    expect(() => state.addEvidence({ id: 'e1', runId: 'run_1', source: 'observation', artifact: { ...ref, hash: 'missing' }, startCursor: 0, endCursor: 1 })).toThrow(/canonical/);
    expect(() => state.addEvidence({ id: 'e1', runId: 'run_1', source: 'observation', artifact: ref, startCursor: 0, endCursor: 1 })).not.toThrow();
    state.close();
  });

  it('locks protected-effect state transitions and payload identity', async () => {
    const state = new StateStore(await mkdtemp(join(tmpdir(), 'state-effect-')), 'run_1');
    const base = { id: 'effect1', runId: 'run_1', operation: 'candidate.submit', kind: 'protected_effect', payload: { candidate: 'flag' }, challengeId: 'c1', generation: 1, budget: budget(), deadline: new Date().toISOString(), expectedPostcondition: 'confirmed' };
    expect(state.prepareEffect(base).state).toBe('prepared');
        expect(() => state.prepareEffect({ ...base, id: 'effect1', payload: { candidate: 'different', new: true } })).toThrow(/conflict/);
    expect(() => state.confirmEffect('effect1', {}, 'accepted')).toThrow(/prepared/);
    expect(state.dispatchEffect('effect1').state).toBe('dispatching');
    expect(() => state.failNotDispatched('effect1')).toThrow(/prepared/);
    expect(state.confirmEffect('effect1', { status: 'accepted' }, 'accepted').state).toBe('confirmed');
    state.close();
  });

  it('quarantines only the unknown operation/challenge scope', async () => {
    const state = new StateStore(await mkdtemp(join(tmpdir(), 'state-unknown-')), 'run_1');
    const base = { runId: 'run_1', kind: 'protected_effect', payload: {}, challengeId: 'c1', generation: 1, budget: budget(), deadline: new Date().toISOString(), expectedPostcondition: 'confirmed' };
    state.prepareEffect({ ...base, id: 'e1', operation: 'candidate.submit' });
    state.dispatchEffect('e1');
    state.markUnknown('e1');
    expect(state.isScopeUnknown('candidate.submit', 'c1')).toBe(true);
    expect(state.isScopeUnknown('candidate.submit', 'c2')).toBe(false);
    expect(state.isScopeUnknown('other.operation', 'c1')).toBe(false);
    state.close();
  });
});
