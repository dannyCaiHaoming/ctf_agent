import { HypothesisManager, experimentFingerprint, type HypothesisManagerOptions } from '@ctf/supervisor';

export const ref = (letter = 'a') => ({ hash: letter.repeat(64), size: 1, path: `/artifacts/${letter}` });
export const hypothesis = (id = 'h1', cost = { wall_ms: 100, tokens: 100, remote_units: 10 }) => ({
  id, claim: 'parser treats input as executable', preconditions: ['parser reachable'], missing_preconditions: [],
  supporting_refs: [], contradicting_refs: [], alternative_explanations: ['literal parsing'], falsifier: 'literal output',
  minimal_experiment: 'compare expression and literal', expected_observation: 'expression is evaluated',
  state_dependencies: { generation: 1, session: 's1' }, required_capabilities: ['http'], route_status: 'queued',
  next_action: 'run differential request', cost, state: 'proposed'
});
export const experiment = (id = 'e1', hypothesis_id = 'h1') => ({
  id, hypothesis_id, objective: 'distinguish executable and literal parsing', input_refs: [ref()],
  state_dependencies: { generation: 1, session: 's1' }, parameters: { expression: '1+1', nested: { b: 2, a: 1 } },
  procedure: [{ id: 'request', tool: 'http.request', input: { path: '/parse' } }],
  expected_support: '2', expected_refutation: '1+1', budget: { wall_ms: 100, tokens: 100, remote_units: 10 },
  repair_budget: 1, stop_condition: 'one interpretable response', expected_artifacts: ['response']
});
export function setup(overrides: Partial<HypothesisManagerOptions> = {}) {
  const events = new Map<string, unknown>();
  const validations: unknown[] = [];
  const manager = new HypothesisManager({
    verifyArtifact: async () => true,
    resolveRuntimeEvent: async id => { const event = events.get(id); if (!event) throw new Error('unknown host event'); return event; },
    validateProgress: async claim => { validations.push(claim); return { substantiation: 'host compared immutable response with the declared discriminator' }; },
    ...overrides
  });
  manager.addHypothesis(hypothesis());
  manager.setRoutes({ primary: 'h1', counterprobe: null });
  const event = (id: string, experiment_id = 'e1', outcome = 'success', failure_code: string | null = null, letter = 'b', step_id = 'request') => {
    events.set(id, { id, experiment_id, fingerprint: experimentFingerprint(experiment(experiment_id)), step_id, outcome, failure_code, artifact_refs: [ref(letter)] });
    return manager.recordRuntimeEvent(id);
  };
  return { manager, events, event, validations };
}
