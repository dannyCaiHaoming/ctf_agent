import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArtifactHashSchema, ExperimentSchema, HypothesisSchema, type ImmutableArtifactRef } from '@ctf/contracts';
import { ProviderSolverDriver, type SolverRequest } from '@ctf/supervisor';
import type { ReleaseProfile } from '../composition/releaseProfile.js';

const binding = {
  session_id: 'session_contract_probe', run_id: 'run_contract_probe', challenge_id: 'challenge_contract_probe',
  task_id: 'task_solver', attempt_id: 'attempt_contract_probe',
  responsibility_set: ['domain_solver', 'strategy'] as ['domain_solver', 'strategy'],
  lease_id: 'lease_contract_probe', expires_at: '2030-01-01T00:00:00.000Z'
};
const materialRef: ImmutableArtifactRef = {
  hash: ArtifactHashSchema.parse('a'.repeat(64)), size: 16, path: '/private/artifacts/sha256/payload.txt'
};

function request(input: Partial<SolverRequest>): SolverRequest {
  return {
    phase: 'solver', binding,
    challenge: { ready: true, description: 'Authorized local CTF fixture', material_refs: [materialRef],
      workspace_files: ['solve.mjs', 'payload.txt'], snapshot: { generation: 1 } },
    experiment: null, observation: null, strategy_reason: null,
    remaining: { wall_ms: 600000, steps: 40, tools: 20, tokens: 100000 },
    ...input
  };
}

const workspaceObservation = { tool: 'workspace.read', raw: 'decode payload', outcome: 'success' as const, failure_code: null,
  artifact_refs: [materialRef], complete: true };
const inspectedObservation = { tool: 'workspace.read', raw: 'solve.mjs reads payload.txt and applies an incorrect transform', outcome: 'success' as const,
  failure_code: null, artifact_refs: [materialRef], complete: true };
const failureObservation = { tool: 'job.run', raw: 'TypeError: missing argument', outcome: 'failure' as const,
  failure_code: 'tool_invocation_error' as const, artifact_refs: [materialRef], complete: true };
const staticPayloadObservation = { tool: 'workspace.read', raw: 'ZmxhZ3tsb2NhbF9yZXBhaXJ9\n', outcome: 'success' as const,
  failure_code: null, artifact_refs: [materialRef], complete: true };

const hypothesis = HypothesisSchema.parse({
  id: 'h-probe', claim: 'The local script decode is wrong', preconditions: [], missing_preconditions: [], supporting_refs: [],
  contradicting_refs: [], alternative_explanations: [], falsifier: 'repeatable tool error', minimal_experiment: 'run script',
  expected_observation: 'stdout or stderr', state_dependencies: { generation: 1 }, required_capabilities: ['job.run'],
  route_status: 'queued', next_action: 'run script', cost: { wall_ms: 600000, tokens: 100000, remote_units: 0 }, state: 'proposed'
});
const plan = ExperimentSchema.parse({
  id: 'e-probe', hypothesis_id: 'h-probe', objective: 'run the script', input_refs: [], state_dependencies: { generation: 1 },
  parameters: {}, procedure: [{ id: 'run', tool: 'job.run', input: { command: ['node', 'solve.mjs'] } }],
  expected_support: 'script prints decoded text', expected_refutation: 'same repeatable parse failure',
  budget: { wall_ms: 600000, tokens: 100000, remote_units: 0 }, repair_budget: 1, stop_condition: 'one bounded repair',
  expected_artifacts: ['stdout', 'stderr']
});
const experiment = { plan, fingerprint: ArtifactHashSchema.parse('b'.repeat(64)), status: 'succeeded' as const,
  events: [], activities: [], redispatch_reason: null, conclusion: null };
const states: Array<{ name: string; request: SolverRequest; expectedKind?: 'dispatch' | 'tool' | Array<'conclude' | 'candidate'> }> = [
  { name: 'run1_absolute_material_path', request: request({}) },
  { name: 'run2_job_run_before_dispatch', request: request({}) },
  { name: 'candidate_before_actual_experiment', request: request({ observation: staticPayloadObservation,
    challenge: { ...request({}).challenge, description: 'Both workspace files have been inspected. Execute the experiment rather than submitting a static guess.' } }),
    expectedKind: 'dispatch' },
  { name: 'run3_nested_dispatch_shape', request: request({ observation: inspectedObservation,
    challenge: { ...request({}).challenge, description: 'Workspace files are inspected; dispatch the next runnable experiment now.' } }), expectedKind: 'dispatch' },
  { name: 'run4_bare_hash_input_refs', request: request({ phase: 'strategy', strategy_reason: 'prior dispatch shape was rejected; produce a legal replacement',
    observation: inspectedObservation,
    challenge: { ...request({}).challenge, description: 'Workspace files are inspected; dispatch the next runnable experiment now.' } }), expectedKind: 'dispatch' },
  { name: 'positive_initial_read', request: request({}) },
  { name: 'positive_dispatch_then_run', request: request({ observation: workspaceObservation, experiment: { ...experiment, status: 'running' as const },
    challenge: { ...request({}).challenge, description: 'A runnable experiment is active; execute its admitted job.run step now.' } }), expectedKind: 'tool' },
  { name: 'positive_failed_step_repair', request: request({ experiment: { ...experiment, status: 'running' as const }, observation: failureObservation }) },
  { name: 'positive_success_conclude', request: request({ experiment,
    challenge: { ...request({}).challenge, description: 'The admitted experiment succeeded and its result is in the observation; record it now.' },
    observation: { ...workspaceObservation, raw: 'flag{probe-result}' } }),
    expectedKind: ['conclude', 'candidate'] }
];

function historicalFailure(name: string, decision: { kind: string; tool?: string; input?: Record<string, unknown> }): string | null {
  if (name === 'run1_absolute_material_path' && decision.kind === 'tool' && decision.tool === 'workspace.read') {
    const path = decision.input?.path;
    if (typeof path === 'string' && (path === materialRef.path || path.startsWith('/'))) return 'absolute material artifact path';
  }
  if (name === 'run2_job_run_before_dispatch' && decision.kind === 'tool' && decision.tool === 'job.run') return 'job.run before dispatch';
  return null;
}

export async function m1ContractProbe(options: { profile: ReleaseProfile; out?: string }): Promise<{ code: number; message: string }> {
  const profile = options.profile;
  if (profile.solverMode !== 'm1' || !profile.solverProfile) throw new Error('M1 contract probe requires solverMode=m1');
  if (profile.solverProfile.promptTemplateVersion !== 'solver-action-json/v7') {
    throw new Error(`blocked_configuration: probe requires solver-action-json/v7, got ${profile.solverProfile.promptTemplateVersion}`);
  }
  const model = profile.model;
  const anthropic = model.provider === 'anthropic_compatible' || model.provider === 'volcano_anthropic';
  const openai = model.provider === 'openai_compatible' || model.provider === 'volcano';
  if (!anthropic && !openai) throw new Error(`blocked_configuration: unsupported probe provider ${model.provider}`);
  const keyName = model.apiKeyEnv ?? (model.provider.startsWith('volcano') ? 'ARK_API_KEY' : anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`blocked_external_input: ${keyName} is missing`);
  const baseUrl = model.baseUrl ?? (model.provider === 'volcano_anthropic' ? 'https://ark.cn-beijing.volces.com/api/coding'
    : model.provider === 'volcano' ? 'https://ark.cn-beijing.volces.com/api/v3' : '');
  const driver = new ProviderSolverDriver({ dialect: anthropic ? 'anthropic_compatible' : 'openai_compatible',
    id: model.id, baseUrl, apiKey, temperature: model.temperature });
  const maxTokens = profile.budget.maxObservableTokens;
  const results: Array<Record<string, unknown>> = [];
  for (const state of states) {
    const controller = new AbortController();
    try {
      const decision = await driver.decideSemantic(state.request, { signal: controller.signal, maxTokens });
      const repeated = historicalFailure(state.name, decision.modelAction);
      const expectedKind = state.expectedKind;
      const kindMatch = !expectedKind || (Array.isArray(expectedKind) ? expectedKind.includes(decision.modelAction.kind as 'conclude' | 'candidate') : decision.modelAction.kind === expectedKind);
      results.push({ state: state.name, valid: true, expected_action_match: kindMatch, model_action: decision.modelAction,
        historical_failure: repeated, usage: decision.usage });
    } catch (error) {
      results.push({ state: state.name, valid: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const validCount = results.filter(result => result.valid === true).length;
  const repeatCount = results.filter(result => result.historical_failure).length;
  const actionMatchCount = results.filter(result => result.expected_action_match === true).length;
  const threshold = Math.ceil(states.length * 0.9);
  const passed = validCount >= threshold && repeatCount === 0 && actionMatchCount === results.filter(result => result.expected_action_match !== undefined).length;
  const out = resolve(options.out ?? 'runs/m1-contract-probe');
  await mkdir(out, { recursive: true });
  const report = { profileId: profile.profileId, promptTemplateVersion: profile.solverProfile.promptTemplateVersion,
    toolManifestVersion: profile.solverProfile.toolManifestVersion, threshold, valid_actions: validCount, total_states: states.length,
    expected_action_matches: actionMatchCount, historical_failures: repeatCount, passed, results };
  const path = join(out, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  return { code: passed ? 0 : 1, message: JSON.stringify({ ...report, report_path: path }, null, 2) };
}
