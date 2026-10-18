import { describe, expect, it } from 'vitest';
import { hypothesis, setup } from './hypothesis-fixtures.js';

const decisions = [{ result: 'literal output', decision: 'park primary and test literal parsing' }, { result: 'evaluated output', decision: 'continue primary' }];
describe('one primary and a genuinely cheaper discriminating counterprobe', () => {
  it('rejects multiple primaries, equal cost solutions and a probe without a primary', () => {
    const { manager } = setup(); manager.addHypothesis(hypothesis('h2'));
    expect(() => manager.setRoutes({ primary: ['h1', 'h2'], counterprobe: null })).toThrow();
    expect(() => manager.setRoutes({ primary: 'h1', counterprobe: { hypothesis_id: 'h2', result_to_decision: decisions } })).toThrow(/cheaper/);
    expect(() => manager.setRoutes({ primary: null, counterprobe: { hypothesis_id: 'h2', result_to_decision: decisions } })).toThrow(/primary/);
    expect(manager.hypothesis('h1').route_status).toBe('primary');
  });
  it('requires different observations to change the decision and parks replaced routes atomically', () => {
    const { manager } = setup(); manager.addHypothesis(hypothesis('h2', { wall_ms: 10, tokens: 10, remote_units: 1 }));
    for (const result_to_decision of [[], [decisions[0]], [decisions[0], { result: 'other', decision: decisions[0]!.decision }]]) {
      expect(() => manager.setRoutes({ primary: 'h1', counterprobe: { hypothesis_id: 'h2', result_to_decision } })).toThrow();
    }
    const routes = manager.setRoutes({ primary: 'h1', counterprobe: { hypothesis_id: 'h2', result_to_decision: decisions } });
    expect(manager.hypothesis('h2').route_status).toBe('probe');
    expect(Object.isFrozen(routes.counterprobe!.result_to_decision)).toBe(true);
    manager.setRoutes({ primary: 'h2', counterprobe: null });
    expect(manager.hypothesis('h1').route_status).toBe('parked');
  });
});

describe('route budget and state dependency enforcement', () => {
  it('cannot declare a cheap probe then dispatch a full-cost experiment or omit known state', async () => {
    const { manager } = setup(); manager.addHypothesis(hypothesis('h2', { wall_ms: 10, tokens: 10, remote_units: 1 }));
    manager.setRoutes({ primary: 'h1', counterprobe: { hypothesis_id: 'h2', result_to_decision: decisions } });
    const { experiment } = await import('./hypothesis-fixtures.js');
    expect(() => manager.startExperiment(experiment('probe', 'h2'))).toThrow(/cost budget/);
    expect(() => manager.startExperiment({ ...experiment(), state_dependencies: { generation: 1 } })).toThrow(/state dependency/);
  });
});

describe('route updates during host verification', () => {
  it('does not restore an old primary assignment when an async conclusion completes', async () => {
    const set = setup({ validateProgress: async () => {
      set.manager.setRoutes({ primary: 'h2', counterprobe: null });
      return { substantiation: 'literal response verified' };
    } });
    const { experiment, ref } = await import('./hypothesis-fixtures.js');
    set.manager.addHypothesis(hypothesis('h2')); set.manager.startExperiment(experiment());
    await set.event('done'); set.manager.completeExperiment('e1');
    await set.manager.conclude('e1', { verdict: 'rejected', rationale: 'literal response', evidence_refs: [ref('b')] });
    expect(set.manager.hypothesis('h1')).toMatchObject({ state: 'rejected', route_status: 'parked' });
    expect(set.manager.hypothesis('h2').route_status).toBe('primary');
  });
});

describe('running experiment admission regressions', () => {
  it('cannot park a running primary then admit a second full-cost route', async () => {
    const { manager } = setup(); const { experiment } = await import('./hypothesis-fixtures.js');
    manager.addHypothesis(hypothesis('h2')); manager.startExperiment(experiment());
    expect(() => manager.setRoutes({ primary: 'h2', counterprobe: null })).toThrow(/running/);
    expect(manager.hypothesis('h1').route_status).toBe('primary');
    expect(manager.hypothesis('h2').route_status).toBe('queued');
    expect(() => manager.startExperiment({ ...experiment('second', 'h2'), parameters: { discriminator: 'different' } })).toThrow(/active route/);
    expect(() => manager.setRoutes({ primary: null, counterprobe: null })).toThrow(/running/);
  });
  it('cannot reclassify running full-cost work as a cheap probe', async () => {
    const { manager } = setup(); const { experiment } = await import('./hypothesis-fixtures.js');
    manager.addHypothesis(hypothesis('h2', { wall_ms: 200, tokens: 200, remote_units: 20 }));
    manager.startExperiment(experiment());
    // A larger new declaration must not launder already-admitted primary work into the probe slot.
    expect(() => manager.setRoutes({ primary: 'h2', counterprobe: { hypothesis_id: 'h1', result_to_decision: decisions } })).toThrow(/running/);
    expect(manager.hypothesis('h1').route_status).toBe('primary');
  });
  it('allows a bounded cheap probe alongside a running primary, and switching after host completion', async () => {
    const set = setup(); const { manager } = set; const { experiment } = await import('./hypothesis-fixtures.js');
    manager.addHypothesis(hypothesis('cheap', { wall_ms: 10, tokens: 10, remote_units: 1 }));
    manager.startExperiment(experiment());
    manager.setRoutes({ primary: 'h1', counterprobe: { hypothesis_id: 'cheap', result_to_decision: decisions } });
    manager.startExperiment({ ...experiment('probe', 'cheap'), budget: { wall_ms: 10, tokens: 10, remote_units: 1 }, parameters: { discriminator: 'cheap precondition check' } });
    expect(manager.experiment('e1').status).toBe('running'); expect(manager.experiment('probe').status).toBe('running');
    expect(() => manager.setRoutes({ primary: 'h1', counterprobe: null })).toThrow(/running/);
    await set.event('primary-done'); manager.completeExperiment('e1');
    // Receipt must bind the real probe plan/fingerprint, not the default fixture plan.
    const { experimentFingerprint } = await import('@ctf/supervisor');
    const { ref } = await import('./hypothesis-fixtures.js');
    set.events.set('probe-done', { id: 'probe-done', experiment_id: 'probe', fingerprint: experimentFingerprint(manager.experiment('probe').plan), step_id: 'request', outcome: 'success', failure_code: null, artifact_refs: [ref('c')] });
    await manager.recordRuntimeEvent('probe-done'); manager.completeExperiment('probe');
    manager.setRoutes({ primary: 'cheap', counterprobe: null });
    expect(manager.hypothesis('h1').route_status).toBe('parked'); expect(manager.hypothesis('cheap').route_status).toBe('primary');
  });
});
