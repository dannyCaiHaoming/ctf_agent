import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LeaseIdSchema, TaskIdSchema } from '@ctf/contracts';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore } from '@ctf/state';
import { Coordinator, PlatformService } from '@ctf/platform';
import { LocalFlagOracle } from '@ctf/local-oracle';
import { AnthropicCompatibleModel, OpenAICompatibleModel, SolverSupervisor, type AnthropicTool, type ModelAdapter } from '@ctf/supervisor';
import { ToolRuntime } from '@ctf/runtime';
import { startLocalTarget, type LocalTarget } from '@ctf/local-target';
import type { ReleaseProfile } from '../composition/releaseProfile.js';
import { solveM1 } from './solveM1.js';

export interface SolveOptions {
  target: string;
  description?: string;
  input?: string;
  profile: ReleaseProfile;
  out?: string;
  allowStub?: boolean;
  startLocalTarget?: boolean;
}

export async function solve(options: SolveOptions): Promise<{ code: number; message: string }> {
  if (options.profile.solverMode === 'm1') return solveM1(options);
  let target = options.target === 'auto' ? 'http://127.0.0.1' : new URL(options.target).toString();
  let localTarget: LocalTarget | undefined;
  if (options.startLocalTarget || options.target === 'auto') {
    localTarget = await startLocalTarget();
    target = localTarget.url;
  }
  const out = resolve(options.out ?? 'runs/local');
  await mkdir(out, { recursive: true });
  const runId = `run_${Date.now().toString(36)}`;
  const state = new StateStore(out, runId);
  const artifacts = new ArtifactStore(join(out, 'artifacts-store'));
  const lease = LeaseIdSchema.parse(crypto.randomUUID());
  const task = TaskIdSchema.parse('task_solver');
  const challengeId = 'challenge_local_target' as never;
  const oracle = new LocalFlagOracle(localTarget ? localTarget.flag : (process.env.LOCAL_ORACLE_FLAG ?? ''));
  const platform = new PlatformService(state, oracle);
  const coordinator = new Coordinator(platform, runId);
  let model: ModelAdapter;
  if (options.profile.model.provider === 'stub' && options.allowStub) {
    const { ScriptedSolverModel } = await import('@ctf/supervisor');
    model = new ScriptedSolverModel(process.env.STUB_CANDIDATE ?? '');
  } else if (options.profile.model.provider === 'anthropic_compatible' || options.profile.model.provider === 'volcano_anthropic') {
    const apiKeyEnv = options.profile.model.apiKeyEnv ?? 'ARK_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      state.close();
      if (localTarget) await localTarget.close();
      return { code: 2, message: `blocked_external_input: ${apiKeyEnv} is missing` };
    }
    const baseUrl = options.profile.model.baseUrl ?? (options.profile.model.provider === 'volcano_anthropic' ? 'https://ark.cn-beijing.volces.com/api/coding' : '');
    const runtime = new ToolRuntime(artifacts, join(out, 'workspaces'), runId, challengeId, target);
    const httpTool: AnthropicTool = {
      name: 'http_request',
      description: 'Perform a GET request against the authorized local challenge target and return the response body.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute HTTP URL within the challenge target.' } },
        required: ['url'],
        additionalProperties: false
      },
      execute: async input => {
        const args = input as { url?: unknown };
        const url = String(args.url ?? '');
        const session = await runtime.openHttpSession();
        try {
          const response = await runtime.httpRequest(session, url, { method: 'GET' });
          const body = response.body.toString('utf8');
          return {
            status: response.status,
            url,
            bytes: response.body.length,
            truncated: body.length > 12000,
            body: body.slice(0, 12000),
            artifact: response.artifact
          };
        } finally {
          runtime.closeHttpSession(session);
        }
      }
    };
    if (!baseUrl) {
      state.close();
      if (localTarget) await localTarget.close();
      return { code: 2, message: 'blocked_configuration: model.baseUrl is required' };
    }
    model = new AnthropicCompatibleModel({ id: options.profile.model.id, baseUrl, apiKey, tools: [httpTool], maxToolRounds: 8, requestTimeoutMs: 60000 });
  } else if (options.profile.model.provider === 'openai_compatible' || options.profile.model.provider === 'volcano') {
    const apiKeyEnv = options.profile.model.apiKeyEnv ?? (options.profile.model.provider === 'volcano' ? 'ARK_API_KEY' : 'OPENAI_API_KEY');
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      state.close();
      if (localTarget) await localTarget.close();
      return { code: 2, message: `blocked_external_input: ${apiKeyEnv} is missing` };
    }
    const baseUrl = options.profile.model.baseUrl ?? (options.profile.model.provider === 'volcano' ? 'https://ark.cn-beijing.volces.com/api/v3' : '');
    if (!baseUrl) {
      state.close();
      if (localTarget) await localTarget.close();
      return { code: 2, message: 'blocked_configuration: model.baseUrl is required' };
    }
    model = new OpenAICompatibleModel({ id: options.profile.model.id, baseUrl, apiKey });
  } else {
    state.close();
    if (localTarget) await localTarget.close();
    return {
      code: 2,
      message: `blocked_configuration: unsupported model provider ${options.profile.model.provider}`
    };
  }
  const supervisor = new SolverSupervisor({
    runRoot: join(out, runId),
    challengeId,
    challengeTarget: target,
    description: options.description ?? options.input ?? 'Authorized local HTTP challenge: discover a hidden path through the running service and submit its flag.',
    budget: options.profile.budget,
    coordinator,
    model,
    lease,
    task,
    runId
  });
  const result = await supervisor.run();
  state.close();
  if (localTarget) await localTarget.close();
  if (result.outcome === 'solved') return { code: 0, message: `solved: ${result.runId}` };
  return { code: 1, message: `${result.outcome}: ${result.stopReason}` };
}
