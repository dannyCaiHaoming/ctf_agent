import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore } from '@ctf/state';
import { ToolRuntime } from '@ctf/runtime';
import { ResponsibilityRegistry, SolverLoop, type SolverAction, type SolverDriver, type SolverRequest, type SolverLoopOptions } from '@ctf/supervisor';

export const declaration = (id = 'decode') => ({
  id, claim: id === 'expression' ? 'parser evaluates expression inputs' : 'payload is base64 text',
  preconditions: ['local materials readable'], missing_preconditions: [], supporting_refs: [], contradicting_refs: [],
  alternative_explanations: ['literal text'], falsifier: 'successful literal response', minimal_experiment: 'run local script',
  expected_observation: 'decoded text', state_dependencies: { generation: 1 }, required_capabilities: ['local_process'],
  route_status: 'queued' as const, next_action: 'execute script', cost: { wall_ms: 10000, tokens: 10000, remote_units: 0 }, state: 'proposed' as const
});
export const plan = (id = 'e1', hypothesis_id = 'decode', command = [process.execPath, 'solve.mjs'], repair_budget = 1) => ({
  id, hypothesis_id, objective: 'interpret local challenge material', input_refs: [], state_dependencies: { generation: 1 }, parameters: {},
  procedure: [{ id: 'run', tool: 'job.run', input: { command } }], expected_support: 'decoded text', expected_refutation: 'literal response',
  budget: { wall_ms: 10000, tokens: 10000, remote_units: 0 }, repair_budget, stop_condition: 'one successful result', expected_artifacts: ['raw output']
});
export const dispatch = (id = 'decode', command?: string[], repair = 1): SolverAction => ({
  kind: 'dispatch', hypothesis: declaration(id), experiment: plan(`e-${id}`, id, command, repair)
});
export const run: SolverAction = { kind: 'tool', tool: 'job.run', input: { command: [process.execPath, 'solve.mjs'] }, step_id: 'run' };
export function scripted(actions: Array<SolverAction | ((request: SolverRequest) => SolverAction)>): { driver: SolverDriver; requests: SolverRequest[] } {
  const requests: SolverRequest[] = [];
  return { requests, driver: { async decide(request) {
    requests.push(structuredClone(request));
    const action = actions.shift(); if (!action) throw new Error('unexpected extra decision');
    return { action: typeof action === 'function' ? action(request) : action, usage: { provenance: 'deterministic', input_tokens: 1, output_tokens: 1, model_calls: 0 } };
  } } };
}
export async function setup(fixture: string, driver: SolverDriver, options: Partial<SolverLoopOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'solver-loop-'));
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const state = new StateStore(join(root, 'state'), 'run');
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'run', 'challenge');
  await cp(resolve('fixtures/trajectories', fixture), runtime.workspace('solver').path, { recursive: true });
  const registry = new ResponsibilityRegistry({ verifyArtifact: ref => artifacts.verify(ref) });
  registry.createTask({ run_id: 'run', challenge_id: 'challenge', task_id: 'solver', attempt_id: 'attempt', responsibility_set: ['domain_solver', 'strategy'], lease: { lease_id: 'lease', expires_at: new Date(Date.now() + 60000).toISOString() } });
  registry.bindSession({ session_id: 'session', task_id: 'solver', context: registry.createReasoningContext() });
  const loop = new SolverLoop({
    state, artifacts, runtime, registry, sessionId: 'session', driver,
    challenge: { ready: true, description: 'Inspect local supplied materials', material_refs: [], snapshot: { generation: 1 } },
    budget: { wallClockMs: 10000, maxSteps: 30, maxToolJobs: 20, maxObservableTokens: 1000 },
    authorizeCommand: command => { if (command[0] !== process.execPath) throw new Error('local node fixture commands only'); },
    validateProgress: async (claim, experiment, hypothesis) => {
      const outputs = await Promise.all(experiment.events.filter(event => event.outcome === 'success').flatMap(event => event.artifact_refs).map(ref => artifacts.read(ref)));
      const text = outputs.map(bytes => bytes.toString('utf8')).join('\n');
      if (claim.kind !== 'evidence') throw new Error('unsupported fixture semantic claim');
      if (claim.verdict === 'rejected' && hypothesis.id === 'expression' && text.trim() === '{"mode":"literal","value":"2+2"}') return { substantiation: 'actual successful parser output retained the exact expression and explicitly reports literal mode' };
      if (claim.verdict === 'supported' && hypothesis.id === 'decode' && /^flag\{[a-z_]+\}\s*$/.test(text)) return { substantiation: 'actual local decoder produced printable framed challenge material' };
      throw new Error('immutable output does not substantiate the declared mechanism');
    }, ...options
  });
  return { loop, state, runtime, artifacts, registry, root, async close() { state.close(); await rm(root, { recursive: true, force: true }); } };
}
