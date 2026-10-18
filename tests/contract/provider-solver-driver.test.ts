import { describe, expect, it, vi } from 'vitest';
import { ArtifactHashSchema } from '@ctf/contracts';
import { ProviderSolverDriver, SolverActionSchema } from '@ctf/supervisor';

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
      expect(body.system).toContain('immutable artifact evidence references, not filesystem paths');
      expect(body.system).toContain('job.run requires a previously dispatched experiment and the exact matching step_id');
      expect(body.system).toContain('dispatch.experiment must use these fields: id, hypothesis_id, objective, input_refs');
      expect(body.system).toContain('dispatch requires both hypothesis and experiment');
      expect(body.system).toContain('"hypothesis":full hypothesis object');
      expect(body.system).not.toContain('"hypothesis": optional hypothesis');
      expect(body.system).toContain('input_refs/evidence_refs contain full objects {hash,size,path}');
      expect(body.messages[0]?.content).toContain('workspace_files');
      expect(body.messages[0]?.content).toContain('solve.mjs');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"kind":"stop","reason":"done"}' }], usage: { input_tokens: 7, output_tokens: 3 } }), { status: 200 });
    });
    const driver = new ProviderSolverDriver({ dialect: 'anthropic_compatible', id: 'test-model', baseUrl: 'https://provider.example', apiKey: 'test-only', fetchImpl });
    await driver.decide({ ...request, challenge: { ...request.challenge,
      material_refs: [{ hash: ArtifactHashSchema.parse('a'.repeat(64)), size: 3, path: '/private/artifacts/sha256/item' }], workspace_files: ['solve.mjs', 'payload.txt'] } },
    { signal: new AbortController().signal, maxTokens: 10000 });
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
    await expect(badAction.decide(request, { signal: new AbortController().signal, maxTokens: 10000 })).rejects.toThrow(/not a JSON SolverAction/);
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
