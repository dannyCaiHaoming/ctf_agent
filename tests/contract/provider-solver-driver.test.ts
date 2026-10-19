import { describe, expect, it, vi } from 'vitest';
import { ArtifactHashSchema, ExperimentSchema, HypothesisSchema } from '@ctf/contracts';
import { ProviderSolverDriver, SolverActionSchema, SolverFailure, materializeSolverAction } from '@ctf/supervisor';

const request = {
  phase: 'solver' as const,
  binding: { session_id: 's', run_id: 'r', challenge_id: 'c', task_id: 't', attempt_id: 'a', responsibility_set: ['domain_solver'] as ['domain_solver'], lease_id: 'l', expires_at: '2030-01-01T00:00:00.000Z' },
  challenge: { ready: true, description: 'local challenge', material_refs: [], snapshot: { generation: 1 } },
  experiment: null, observation: null, strategy_reason: null,
  remaining: { wall_ms: 1000, steps: 4, tools: 2, tokens: 500 }
};

describe('ProviderSolverDriver', () => {
  it('requires a declared hypothesis whose identity matches each dispatched experiment', () => {
    const experiment = { id: 'e1', hypothesis_id: 'h1', objective: 'run the script', input_refs: [], state_dependencies: { generation: 1 }, parameters: {},
      procedure: [{ id: 'run', tool: 'job.run', input: { command: ['node', 'solve.mjs'] } }], expected_support: 'script runs', expected_refutation: 'script fails',
      budget: { wall_ms: 1000, tokens: 100, remote_units: 0 }, repair_budget: 1, stop_condition: 'one repair', expected_artifacts: ['stderr'] };
    const hypothesis = { id: 'h1', claim: 'script runs', preconditions: [], missing_preconditions: [], supporting_refs: [], contradicting_refs: [],
      alternative_explanations: [], falsifier: 'repeatable tool error', minimal_experiment: 'run script', expected_observation: 'stdout or stderr',
      state_dependencies: { generation: 1 }, required_capabilities: ['job.run'], route_status: 'queued', next_action: 'run script',
      cost: { wall_ms: 1000, tokens: 100, remote_units: 0 }, state: 'proposed' };
    expect(SolverActionSchema.safeParse({ kind: 'dispatch', experiment }).success).toBe(false);
    expect(SolverActionSchema.safeParse({ kind: 'dispatch', hypothesis, experiment: { ...experiment, hypothesis_id: 'other' } }).success).toBe(false);
    expect(SolverActionSchema.safeParse({ kind: 'dispatch', hypothesis, experiment }).success).toBe(true);
  });

  it('distinguishes relative workspace paths from immutable artifact references', async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { system: string; messages: Array<{ content: string }> };
      expect(body.system).toContain('Workspace tool paths are relative to the task workspace root');
      expect(body.system).toContain('Never write hashes, IDs, step IDs, or budget numbers');
      expect(body.system).toContain('"claim":string,"falsifier":string');
      expect(body.system).not.toContain('"hypothesis":full hypothesis object');
      expect(body.system).not.toContain('step_id":optional string except required for job.run');
      expect(body.messages[0]?.content).toContain('workspace_files');
      expect(body.messages[0]?.content).toContain('solve.mjs');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"kind":"stop","reason":"done"}' }], usage: { input_tokens: 7, output_tokens: 3 } }), { status: 200 });
    });
    const driver = new ProviderSolverDriver({ dialect: 'anthropic_compatible', id: 'test-model', baseUrl: 'https://provider.example', apiKey: 'test-only', fetchImpl });
    await driver.decide({ ...request, challenge: { ...request.challenge,
      material_refs: [{ hash: ArtifactHashSchema.parse('a'.repeat(64)), size: 3, path: '/private/artifacts/sha256/item' }], workspace_files: ['solve.mjs', 'payload.txt'] } },
    { signal: new AbortController().signal, maxTokens: 10000 });
  });

  it('materializes a minimal dispatch into canonical hypothesis and experiment data', () => {
    const payloadRef = { hash: ArtifactHashSchema.parse('a'.repeat(64)), size: 3, path: '/private/artifacts/sha256/payload.txt' };
    const result = materializeSolverAction({ ...request, challenge: { ...request.challenge,
      material_refs: [payloadRef], workspace_files: ['solve.mjs', 'payload.txt'] } }, {
      kind: 'dispatch', claim: 'script parameter handling is wrong', falsifier: 'after correction the same parse error remains',
      expected_observation: 'stderr names the parse error', expected_support: 'script prints decoded text',
      expected_refutation: 'script succeeds but output is empty', uses: ['payload.txt'],
      procedure: [{ tool: 'job.run', input: { command: ['node', 'solve.mjs'] } }]
    });
    expect(SolverActionSchema.safeParse(result).success).toBe(true);
    if (result.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(result.hypothesis.id).toMatch(/^hypothesis_/);
    expect(result.experiment.hypothesis_id).toBe(result.hypothesis.id);
    expect(result.experiment.input_refs).toEqual([payloadRef]);
    expect(result.experiment.procedure[0]).toMatchObject({ id: 'step_1', tool: 'job.run', input: { command: ['node', 'solve.mjs'] } });
    expect(result.experiment.budget).toEqual({ wall_ms: 1000, tokens: 500, remote_units: 0 });
    expect(result.hypothesis.state_dependencies).toEqual({ generation: 1 });
  });

  it('injects the matching step id into model tool actions and resolves evidence uses', () => {
    const payloadRef = { hash: ArtifactHashSchema.parse('b'.repeat(64)), size: 3, path: '/private/artifacts/sha256/payload.txt' };
    const hypothesis = HypothesisSchema.parse({ id: 'h1', claim: 'c', preconditions: [], missing_preconditions: [], supporting_refs: [], contradicting_refs: [],
      alternative_explanations: [], falsifier: 'f', minimal_experiment: 'm', expected_observation: 'o', state_dependencies: { generation: 1 },
      required_capabilities: ['job.run'], route_status: 'queued', next_action: 'run', cost: { wall_ms: 1000, tokens: 100, remote_units: 0 }, state: 'proposed' });
    const plan = ExperimentSchema.parse({ id: 'e1', hypothesis_id: 'h1', objective: 'run', input_refs: [], state_dependencies: { generation: 1 }, parameters: {},
      procedure: [{ id: 'run', tool: 'job.run', input: { command: ['node', 'solve.mjs'] } }], expected_support: 's', expected_refutation: 'r',
      budget: { wall_ms: 1000, tokens: 100, remote_units: 0 }, repair_budget: 1, stop_condition: 'one repair', expected_artifacts: ['stderr'] });
    const experiment = { plan, fingerprint: ArtifactHashSchema.parse('c'.repeat(64)), status: 'running' as const, events: [], activities: [], redispatch_reason: null, conclusion: null };
    const materialized = materializeSolverAction({ ...request, challenge: { ...request.challenge,
      material_refs: [payloadRef], workspace_files: ['solve.mjs', 'payload.txt'] }, experiment }, {
      kind: 'tool', tool: 'job.run', input: { command: ['node', 'solve.mjs'] } });
    expect(materialized).toEqual({ kind: 'tool', tool: 'job.run', input: { command: ['node', 'solve.mjs'] }, step_id: 'run' });
    expect(materializeSolverAction({ ...request, challenge: { ...request.challenge, material_refs: [payloadRef] } }, { kind: 'candidate', value: 'flag', uses: ['payload.txt'] }))
      .toEqual({ kind: 'candidate', value: 'flag', evidence_refs: [payloadRef] });
  });

  it.each([
    ['openai_compatible', 'https://provider.example/v1/', 'https://provider.example/v1/chat/completions'],
    ['anthropic_compatible', 'https://provider.example/', 'https://provider.example/v1/messages']
  ] as const)('maps %s responses to one action with provider usage', async (dialect, baseUrl, expectedUrl) => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe(expectedUrl);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body = dialect === 'openai_compatible'
        ? { choices: [{ message: { content: '{"kind":"stop","reason":"done"}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }
        : { content: [{ type: 'text', text: '{"kind":"stop","reason":"done"}' }], usage: { input_tokens: 7, output_tokens: 3 } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const driver = new ProviderSolverDriver({ dialect, id: 'test-model', baseUrl, apiKey: 'test-only', fetchImpl });
    const result = await driver.decide(request, { signal: new AbortController().signal, maxTokens: 10000 });
    expect(result).toEqual({ action: { kind: 'stop', reason: 'done' }, usage: { provenance: 'provider_reported', input_tokens: 7, output_tokens: 3, model_calls: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed action JSON and missing provider usage', async () => {
    const noUsage = new ProviderSolverDriver({ dialect: 'openai_compatible', id: 'm', baseUrl: 'https://provider.example/v1', apiKey: 'x', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] }), { status: 200 }) });
    await expect(noUsage.decide(request, { signal: new AbortController().signal, maxTokens: 10000 })).rejects.toThrow(/authoritative token usage/);

    const badAction = new ProviderSolverDriver({ dialect: 'openai_compatible', id: 'm', baseUrl: 'https://provider.example/v1', apiKey: 'x', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }) });
    const failure = await badAction.decide(request, { signal: new AbortController().signal, maxTokens: 10000 }).catch(error => error);
    expect(failure).toBeInstanceOf(SolverFailure);
    expect(failure.message).toMatch(/no JSON object|malformed JSON action/);
    expect(failure.usage).toEqual({ provenance: 'provider_reported', input_tokens: 1, output_tokens: 1, model_calls: 1 });
  });

  it('accepts markdown-framed JSON while keeping the semantic action contract', async () => {
    const framed = new ProviderSolverDriver({ dialect: 'openai_compatible', id: 'm', baseUrl: 'https://provider.example/v1', apiKey: 'x', fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"kind":"stop","reason":"framed"}\n```' } }],
      usage: { prompt_tokens: 2, completion_tokens: 2 }
    }), { status: 200 }) });
    await expect(framed.decide(request, { signal: new AbortController().signal, maxTokens: 10000 }))
      .resolves.toMatchObject({ action: { kind: 'stop', reason: 'framed' }, usage: { input_tokens: 2, output_tokens: 2 } });
  });

  it('rejects failed provider calls and passes through abort cancellation', async () => {
    const signal = new AbortController().signal;
    const failed = new ProviderSolverDriver({ dialect: 'anthropic_compatible', id: 'm', baseUrl: 'https://provider.example', apiKey: 'x', fetchImpl: async (_input, init) => {
      expect(init?.signal).toBe(signal);
      return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), { status: 401 });
    } });
    await expect(failed.decide(request, { signal, maxTokens: 10000 })).rejects.toThrow(/provider request failed \(401\)/);
  });
});
