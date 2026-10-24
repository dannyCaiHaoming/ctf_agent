import { describe, expect, it } from 'vitest';
import { HypothesisManager } from '@ctf/supervisor';
import { experiment, hypothesis, ref, setup } from './hypothesis-fixtures.js';

async function completed(set: ReturnType<typeof setup>, id: string, letter = 'b') {
  set.manager.startExperiment(experiment(id), id === 'e1' ? undefined : { reason: `new diagnostic requirement ${id}`, basis_refs: [ref('f')] });
  await set.event(`event-${id}`, id, 'success', null, letter);
  set.manager.completeExperiment(id);
}
const reduction = (id = 'e1', before = 100, after = 20, letter = 'b') => ({
  kind: 'search_space_reduction', experiment_id: id, scope: 'candidate keys', measure: 'candidate count', before, after,
  rationale: 'tested constraints eliminate candidates', evidence_refs: [ref(letter)]
});

describe('substantiated semantic progress and stall windows', () => {
  it('ignores empty windows and waits; requests Strategy after two real completed no-progress windows then optionally one Critic', async () => {
    const set = setup(); const { manager } = set;
    expect(manager.finishWindow()).toMatchObject({ completed_experiments: [], consecutive_no_progress: 0, request: null });
    manager.startExperiment(experiment()); manager.recordActivity('e1', { kind: 'wait', reason: 'approved job remains within deadline' });
    expect(manager.finishWindow().consecutive_no_progress).toBe(0);
    await set.event('e1-done'); manager.completeExperiment('e1');
    expect(manager.finishWindow()).toMatchObject({ consecutive_no_progress: 1, request: null });
    expect(() => manager.requestRecoveryCritic('need independent diagnosis')).toThrow(/Strategy/);
    await completed(set, 'e2');
    expect(manager.finishWindow()).toMatchObject({ consecutive_no_progress: 2, request: 'strategy' });
    expect(() => manager.requestRecoveryCritic('need independent diagnosis')).toThrow(/Strategy/);
    manager.strategyReplanned('reinspect generation and discriminator');
    expect(manager.requestRecoveryCritic('new strategy still has unresolved assumptions').request).toBe('recovery_critic');
    expect(() => manager.requestRecoveryCritic('again')).toThrow(/once/);
  });
  it('repair and transient retry do not reset a stalled window; repairs are bounded', async () => {
    const set = setup(); const { manager } = set; await completed(set, 'e1'); manager.finishWindow();
    manager.startExperiment(experiment('e2'), { reason: 're-acquire diagnostic output', basis_refs: [ref('a')] });
    await set.event('bad', 'e2', 'failure', 'tool_invocation_error');
    manager.recordActivity('e2', { kind: 'repair', reason: 'correct quoting' });
    await set.event('bad-again', 'e2', 'failure', 'timeout');
    expect(() => manager.recordActivity('e2', { kind: 'repair', reason: 'try again' })).toThrow(/budget/);
    manager.recordActivity('e2', { kind: 'transient_retry', reason: 'observe Retry-After without redispatch' });
    manager.completeExperiment('e2');
    expect(manager.finishWindow()).toMatchObject({ consecutive_no_progress: 2, request: 'strategy' });
  });
  it('requires quantitative evidence, a completed experiment and explicit host substantiation', async () => {
    const set = setup(); const { manager } = set;
    await expect(manager.recordProgress(reduction())).rejects.toThrow(/unknown/);
    await completed(set, 'e1');
    for (const claim of [reduction('e1', 20, 20), reduction('e1', 10, 20), { ...reduction(), evidence_refs: [] }, { ...reduction(), semantic_progress: true }, reduction('e1', 100, 20, 'c')]) {
      await expect(manager.recordProgress(claim)).rejects.toThrow();
    }
    expect((await manager.recordProgress(reduction())).accepted).toBe(true);
    expect(manager.finishWindow()).toMatchObject({ consecutive_no_progress: 0 });
    await completed(set, 'e2');
    expect((await manager.recordProgress({ ...reduction('e2'), rationale: 'same evidence renamed' })).accepted).toBe(false);
    expect(manager.finishWindow().consecutive_no_progress).toBe(1);
    await completed(set, 'e3', 'c');
    await expect(manager.recordProgress(reduction('e3', 100, 10, 'c'))).rejects.toThrow(/baseline/);
    expect((await manager.recordProgress(reduction('e3', 20, 10, 'c'))).accepted).toBe(true);
    expect(manager.finishWindow().consecutive_no_progress).toBe(0);
  });
  it('rejects unsupported host validation and never counts arbitrary output or a caller boolean', async () => {
    const manager = new HypothesisManager({ verifyArtifact: async () => true, resolveRuntimeEvent: async () => ({}), validateProgress: async () => ({ substantiation: '' }) });
    manager.addHypothesis(hypothesis()); manager.setRoutes({ primary: 'h1', counterprobe: null });
    await expect(manager.recordProgress({ kind: 'poll', semantic_progress: true })).rejects.toThrow();
    const set = setup(); await completed(set, 'e1');
    await expect(set.manager.recordProgress({ kind: 'evidence', experiment_id: 'e1', hypothesis_id: 'unrelated', verdict: 'supported', rationale: 'new output', evidence_refs: [ref('b')] })).rejects.toThrow(/hypothesis/);
  });
  it('accepts verifiable intermediate values and corrected semantic prerequisites, not a generic repair label', async () => {
    const set = setup(); await completed(set, 'e1');
    expect((await set.manager.recordProgress({ kind: 'verified_result', experiment_id: 'e1', result_type: 'replayable_poc', result: 'local script replays discriminator', evidence_refs: [ref('b')], rationale: 'verified deterministic replay' })).accepted).toBe(true);
    set.manager.finishWindow(); await completed(set, 'e2', 'c');
    await expect(set.manager.recordProgress({ kind: 'prerequisite_correction', experiment_id: 'e2', error_type: 'repair', scope: 'parser', before: 'bad', after: 'good', rationale: 'fixed', evidence_refs: [ref('c')] })).rejects.toThrow();
    expect((await set.manager.recordProgress({ kind: 'prerequisite_correction', experiment_id: 'e2', error_type: 'session', scope: 'session identity', before: 'expired s1', after: 'verified s2', rationale: 'identity query proves original experiment used wrong session', evidence_refs: [ref('c')] })).accepted).toBe(true);
  });
});

describe('evidence substantiation cannot be laundered through repeats', () => {
  it('rejects host denial/empty proof and retains no progress or verdict', async () => {
    for (const validateProgress of [async () => { throw new Error('not discriminating evidence'); }, async () => ({ substantiation: '' })]) {
      const set = setup({ validateProgress }); await completed(set, 'e1');
      await expect(set.manager.conclude('e1', { verdict: 'rejected', rationale: 'model says so', evidence_refs: [ref('b')] })).rejects.toThrow();
      expect(set.manager.hypothesis('h1').state).toBe('testing');
      expect(set.manager.progressRecords()).toHaveLength(0);
    }
  });
  it('host checks a changed meaning even when its artifact was already counted as progress', async () => {
    const set = setup({ validateProgress: async claim => {
      if (claim.kind === 'evidence') throw new Error('response does not refute mechanism');
      return { substantiation: 'candidate count verified from response' };
    } }); await completed(set, 'e1');
    await set.manager.recordProgress(reduction());
    await expect(set.manager.conclude('e1', { verdict: 'rejected', rationale: 'relabel quantitative proof', evidence_refs: [ref('b')] })).rejects.toThrow(/does not refute/);
    expect(set.manager.hypothesis('h1').state).toBe('testing');
  });
  it('serializes concurrent semantic claims so repeated evidence counts once', async () => {
    const set = setup(); await completed(set, 'e1');
    const results = await Promise.all([set.manager.recordProgress(reduction()), set.manager.recordProgress(reduction())]);
    expect(results.map(result => result.accepted)).toEqual([true, false]);
    expect(set.manager.progressRecords()).toHaveLength(1);
  });
});
