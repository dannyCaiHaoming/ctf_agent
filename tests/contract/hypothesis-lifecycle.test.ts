import { describe, expect, it } from 'vitest';
import { HypothesisSchema, ExperimentSchema } from '@ctf/contracts';
import { HypothesisManager, experimentFingerprint } from '@ctf/supervisor';

import { ref, hypothesis, experiment, setup } from './hypothesis-fixtures.js';

describe('hypothesis and experiment contracts', () => {
  it('requires exact declarations and rejects model supplied completion/progress flags', () => {
    expect(HypothesisSchema.safeParse(hypothesis()).success).toBe(true);
    expect(HypothesisSchema.safeParse({ ...hypothesis(), falsifier: '' }).success).toBe(false);
    expect(ExperimentSchema.safeParse({ ...experiment(), completed: true }).success).toBe(false);
    expect(ExperimentSchema.safeParse({ ...experiment(), procedure: [] }).success).toBe(false);
    expect(ExperimentSchema.safeParse({ ...experiment(), parameters: { x: Infinity } }).success).toBe(false);
  });
  it('canonicalizes key order while retaining every mechanical dependency and ordered step', () => {
    const original = experiment();
    const reordered = { ...original, parameters: { nested: { a: 1, b: 2 }, expression: '1+1' }, state_dependencies: { session: 's1', generation: 1 } };
    expect(experimentFingerprint(original)).toBe(experimentFingerprint(reordered));
    for (const changed of [
      { ...original, input_refs: [ref('c')] }, { ...original, state_dependencies: { generation: 2 } },
      { ...original, parameters: { expression: '2+2' } },
      { ...original, procedure: [{ id: 'request', tool: 'http.request', input: { path: '/other' } }] }
    ]) expect(experimentFingerprint(changed)).not.toBe(experimentFingerprint(original));
    expect(experimentFingerprint({ ...original, id: 'other', objective: 'wording change' })).toBe(experimentFingerprint(original));
  });
});

describe('host owned experiment lifecycle', () => {
  it('requires a dispatched experiment and host issued matching ordered events', async () => {
    const { manager, events } = setup();
    expect(() => manager.completeExperiment('e1')).toThrow(/unknown/);
    const plan = experiment(); plan.procedure.push({ id: 'compare', tool: 'local.compare', input: { path: 'response' } });
    manager.startExperiment(plan);
    expect(() => manager.completeExperiment('e1')).toThrow(/runtime/);
    events.set('bad', { id: 'bad', experiment_id: 'e1', fingerprint: experimentFingerprint(plan), step_id: 'compare', outcome: 'success', failure_code: null, artifact_refs: [ref('b')] });
    await expect(manager.recordRuntimeEvent('bad')).rejects.toThrow(/ordered/);
    events.set('wrong', { ...events.get('bad') as object, id: 'wrong', step_id: 'request', fingerprint: '0'.repeat(64) });
    await expect(manager.recordRuntimeEvent('wrong')).rejects.toThrow(/fingerprint/);
    await expect(manager.recordRuntimeEvent('forged')).rejects.toThrow(/host event/);
  });
  it.each(['tool_invocation_error', 'output_parse_error', 'timeout', 'http_forbidden', 'platform_rate_limited', 'model_rate_limited'])('cannot reject mechanism from %s', async code => {
    const { manager, event } = setup(); manager.startExperiment(experiment());
    await event('failed', 'e1', 'failure', code); manager.completeExperiment('e1');
    await expect(manager.conclude('e1', { verdict: 'rejected', rationale: 'error means mechanism absent', evidence_refs: [ref('b')] })).rejects.toThrow(/mechanism/);
    await manager.conclude('e1', { verdict: 'inconclusive', rationale: 'tool did not discriminate', evidence_refs: [] });
    expect(manager.hypothesis('h1').state).toBe('inconclusive');
  });
  it('repairs in the same experiment then accepts substantiated mechanism rejection', async () => {
    const { manager, event, validations } = setup(); manager.startExperiment(experiment());
    await event('failed', 'e1', 'failure', 'output_parse_error');
    await expect(event('premature')).rejects.toThrow(/repair/);
    manager.recordActivity('e1', { kind: 'repair', reason: 'correct response decoder' });
    await event('success', 'e1', 'success', null, 'c'); manager.completeExperiment('e1');
    await manager.conclude('e1', { verdict: 'rejected', rationale: 'response contains literal expression under verified prerequisites', evidence_refs: [ref('c')] });
    expect(manager.hypothesis('h1')).toMatchObject({ state: 'rejected', contradicting_refs: [ref('c')] });
    expect(validations).toHaveLength(1);
    await expect(manager.conclude('e1', { verdict: 'supported', rationale: 'change mind', evidence_refs: [ref('c')] })).rejects.toThrow(/transition/);
  });
  it('rejects deduplicated dispatch unless a new reason is recorded', () => {
    const { manager } = setup(); manager.startExperiment(experiment());
    expect(() => manager.startExperiment(experiment('e2'))).toThrow(/fingerprint/);
    const replay = manager.startExperiment(experiment('e2'), { reason: 'original transcript was truncated; re-acquire complete discriminator', basis_refs: [ref('d')] });
    expect(replay.redispatch_reason?.reason).toContain('truncated');
    expect(() => manager.startExperiment(experiment('e3'), { reason: replay.redispatch_reason!.reason, basis_refs: [ref('d')] })).toThrow(/new reason/);
  });
  it('freezes returned records without freezing or retaining caller input', () => {
    const { manager } = setup(); const input = experiment(); const record = manager.startExperiment(input);
    input.parameters.expression = 'changed';
    expect(record.plan.parameters.expression).toBe('1+1');
    expect(() => Object.assign(record.plan.parameters, { expression: 'forged' })).toThrow();
    expect(() => Object.assign(manager.hypothesis('h1'), { state: 'rejected' })).toThrow();
  });
});

describe('negative host authority and state boundaries', () => {
  it('requires every procedure step and rejects reused runtime events', async () => {
    const { manager, events } = setup();
    const plan = experiment(); plan.procedure.push({ id: 'compare', tool: 'compare', input: { path: 'response' } });
    manager.startExperiment(plan);
    events.set('first', { id: 'first', experiment_id: 'e1', fingerprint: experimentFingerprint(plan), step_id: 'request', outcome: 'success', failure_code: null, artifact_refs: [ref('b')] });
    await manager.recordRuntimeEvent('first');
    expect(() => manager.completeExperiment('e1')).toThrow(/incomplete/);
    await expect(manager.recordRuntimeEvent('first')).rejects.toThrow(/consumed/);
    events.set('last', { ...events.get('first') as object, id: 'last', step_id: 'compare' });
    await manager.recordRuntimeEvent('last'); expect(manager.completeExperiment('e1').status).toBe('succeeded');
    expect(() => manager.completeExperiment('e1')).toThrow(/completed/);
  });
  it('requires artifact verification and refuses a runtime failure labeled hypothesis_falsified', async () => {
    const set = setup({ verifyArtifact: async () => { throw new Error('artifact missing'); } });
    set.manager.startExperiment(experiment());
    await expect(set.event('bad')).rejects.toThrow(/artifact missing/);
    expect(set.manager.experiment('e1').events).toHaveLength(0);
    const valid = setup(); valid.manager.startExperiment(experiment());
    await expect(valid.event('fake-verdict', 'e1', 'failure', 'hypothesis_falsified')).rejects.toThrow(/assessment/);
    expect(valid.manager.hypothesis('h1').state).toBe('testing');
  });
  it('rejects concluded-to-testing transitions and preserves conclusion rationale', async () => {
    const set = setup(); set.manager.startExperiment(experiment()); await set.event('done'); set.manager.completeExperiment('e1');
    await set.manager.conclude('e1', { verdict: 'stale', rationale: 'generation changed after experiment', evidence_refs: [] });
    expect(set.manager.experiment('e1').conclusion?.rationale).toContain('generation changed');
    expect(() => set.manager.startExperiment(experiment('e2'), { reason: 'new generation', basis_refs: [ref()] })).toThrow(/transition/);
  });
});

describe('mechanical fingerprint normalization regressions', () => {
  it('deduplicates renamed procedure bookkeeping IDs without a recorded new reason', () => {
    const { manager } = setup(); const original = experiment(); manager.startExperiment(original);
    const renamed = { ...experiment('renamed'), procedure: [{ ...original.procedure[0]!, id: 'same-request-new-label' }] };
    expect(experimentFingerprint(renamed)).toBe(experimentFingerprint(original));
    expect(() => manager.startExperiment(renamed)).toThrow(/fingerprint/);
  });
  it('deduplicates relocated identical content and unordered/repeated evidence refs', () => {
    const { manager } = setup(); const original = { ...experiment(), input_refs: [ref('a'), ref('c')] };
    manager.startExperiment(original);
    const relocated = { ...original, id: 'relocated', input_refs: [{ ...ref('c'), path: '/archive/c' }, { ...ref('a'), path: '/archive/a' }, ref('a')] };
    expect(experimentFingerprint(relocated)).toBe(experimentFingerprint(original));
    expect(() => manager.startExperiment(relocated)).toThrow(/fingerprint/);
    expect(experimentFingerprint({ ...original, input_refs: [{ ...ref('a'), size: 2 }, ref('c')] })).not.toBe(experimentFingerprint(original));
  });
  it('retains executable paths, ordered procedure and ordered tool inputs as mechanical differences', () => {
    const original = experiment(); original.procedure.push({ id: 'compare', tool: 'local.compare', input: { path: '/tmp/response' } });
    for (const changed of [
      { ...original, procedure: [...original.procedure].reverse() },
      { ...original, procedure: [{ ...original.procedure[0]!, input: { path: '/other-executable-input' } }, original.procedure[1]!] },
      { ...original, parameters: { ordered_inputs: ['a', 'b'] } },
      { ...original, state_dependencies: { generation: 2, session: 's1' } }
    ]) expect(experimentFingerprint(changed)).not.toBe(experimentFingerprint(original));
    expect(experimentFingerprint({ ...original, parameters: { ordered_inputs: ['a', 'b'] } }))
      .not.toBe(experimentFingerprint({ ...original, parameters: { ordered_inputs: ['b', 'a'] } }));
  });
});
