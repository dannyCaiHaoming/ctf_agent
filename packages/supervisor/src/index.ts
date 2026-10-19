import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChallengeIdSchema, pipelineStages, solveStates, type Budget, type LeaseId, type TaskId } from '@ctf/contracts';
import type { Coordinator } from '@ctf/platform';
import type { ArtifactReferenceRecord, StateStore } from '@ctf/state';
import { ModelDataGateway } from '@ctf/policy';

export interface ModelTurn {
  stage: (typeof pipelineStages)[number];
  challenge: { id: string; target: string; description: string };
  observations: string[];
  candidate?: string;
}

export interface ModelResponse {
  text: string;
  observableTokens?: number;
}

export interface ModelAdapter {
  id: string;
  invoke(turn: ModelTurn): Promise<ModelResponse>;
}

export interface SolveResult {
  runId: string;
  outcome: 'solved' | 'partial' | 'candidate_only' | 'unsolved' | 'inconclusive' | 'infrastructure_invalid';
  solveState: (typeof solveStates)[number];
  candidate?: string;
  steps: number;
  wallClockMs: number;
  evidenceRefs: Array<{ hash: string; path: string }>;
  stopReason: string;
}

export class SolverSupervisor {
  private readonly startedAt = Date.now();

  constructor(private readonly input: {
    runRoot: string;
    challengeId: string;
    challengeTarget: string;
    description: string;
    budget: Budget;
    coordinator: Coordinator;
    model: ModelAdapter;
    lease: LeaseId;
    runId?: string;
    task: TaskId;
    observations?: string[];
    state?: StateStore;
    evidenceRefs?: ArtifactReferenceRecord[];
  }) {}

  private leftBudget(): { left: boolean; reason?: string } {
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= this.input.budget.wallClockMs) return { left: false, reason: 'wall clock deadline exceeded' };
    return { left: true };
  }

  async run(): Promise<SolveResult> {
    if (this.input.challengeTarget.startsWith('http://') || this.input.challengeTarget.startsWith('https://')) {
      try {
        const health = await fetch(new URL('/health', this.input.challengeTarget));
        if (!health.ok) return await this.finishAsInfrastructureInvalid(`target health returned ${health.status}`);
      } catch (error) {
        return await this.finishAsInfrastructureInvalid(error instanceof Error ? error.message : String(error));
      }
    }
    const runId = this.input.runId ?? `run_${randomUUID()}`;
    let usedSteps = 0;
    let usedTokens = 0;
    let candidate: string | undefined;
    let outcome: SolveResult['outcome'] = 'unsolved';
    let solveState: SolveResult['solveState'] = 'active';
    let stopReason = 'oracle rejected final candidate';
    const checkpointRefs: ArtifactReferenceRecord[] = [...(this.input.evidenceRefs ?? [])];
    const evidenceRefs: SolveResult['evidenceRefs'] = checkpointRefs.map(({ hash, path }) => ({ hash, path }));
    const saveCheckpoint = (stage: string, nextAction: string, solveState: string) => {
      this.input.state?.saveCheckpoint({
        runId,
        challengeId: this.input.challengeId,
        target: this.input.challengeTarget,
        nextAction,
        stage,
        publishedRefs: checkpointRefs,
        rejectedFingerprints: [],
        activeJobCursors: {},
        usedBudget: {
          wallClockMs: Date.now() - this.startedAt,
          maxSteps: usedSteps,
          maxToolJobs: 0,
          maxObservableTokens: usedTokens
        }
      });
      void solveState;
    };
    saveCheckpoint('intake', 'run pipeline', solveState);

    for (const stage of pipelineStages) {
      const budget = this.leftBudget();
      if (!budget.left) {
        solveState = 'deadline_exceeded';
        outcome = candidate ? 'candidate_only' : 'unsolved';
        stopReason = budget.reason!;
        saveCheckpoint(stage, 'stop: wall clock deadline', solveState);
        break;
      }
      if (usedSteps >= this.input.budget.maxSteps) {
        solveState = 'finished';
        outcome = candidate ? 'candidate_only' : 'unsolved';
        stopReason = 'step budget exhausted';
        saveCheckpoint(stage, 'stop: step budget', solveState);
        break;
      }
      usedSteps++;
      try {
        const response = await this.input.model.invoke({
          stage,
          challenge: { id: this.input.challengeId, target: this.input.challengeTarget, description: this.input.description },
          observations: this.input.observations ?? [],
          candidate
        });
        usedTokens += response.observableTokens ?? Math.ceil(response.text.length / 4);
        if (usedTokens > this.input.budget.maxObservableTokens) {
          solveState = 'finished';
          outcome = candidate ? 'candidate_only' : 'unsolved';
          stopReason = 'observable token budget exceeded';
          break;
        }
        const extracted = /(?:flag\{[^}]+\}|CANDIDATE:\s*(.+))/i.exec(response.text)?.[0]?.replace(/^CANDIDATE:\s*/i, '');
        if (extracted) candidate = extracted;
        if (stage === 'submitting' && candidate) {
          const submission = await this.input.coordinator.submitCandidate({
            candidate,
            challengeId: ChallengeIdSchema.parse(this.input.challengeId),
            task: this.input.task,
            lease: this.input.lease
          });
          if (submission.businessOutcome === 'accepted') {
            outcome = 'solved';
            solveState = 'finished';
            stopReason = 'local oracle accepted';
            break;
          }
          if (submission.businessOutcome === 'duplicate') {
            outcome = 'candidate_only';
            solveState = 'finished';
            stopReason = 'candidate was already submitted';
            break;
          }
        }
      } catch (error) {
        solveState = 'blocked_runtime';
        outcome = 'inconclusive';
        stopReason = error instanceof Error ? error.message : String(error);
        saveCheckpoint(stage, 'stop: runtime blocker', solveState);
        break;
      }
    }

    if (solveState === 'active') {
      solveState = 'finished';
      outcome = candidate ? 'candidate_only' : 'unsolved';
      stopReason = 'pipeline completed without authoritative acceptance';
    }
    saveCheckpoint('finalizing', stopReason, solveState);

    const result: SolveResult = {
      runId,
      outcome,
      solveState,
      ...(candidate ? { candidate } : {}),
      steps: usedSteps,
      wallClockMs: Date.now() - this.startedAt,
      evidenceRefs,
      stopReason
    };
    await this.writeRun(result, usedTokens);
    return result;
  }

  private async finishAsInfrastructureInvalid(reason: string): Promise<SolveResult> {
    const result: SolveResult = {
      runId: `run_${randomUUID()}`,
      outcome: 'infrastructure_invalid',
      solveState: 'blocked_runtime',
      steps: 0,
      wallClockMs: Date.now() - this.startedAt,
      evidenceRefs: [],
      stopReason: `target unavailable: ${reason}`
    };
    await this.writeRun(result, 0);
    return result;
  }

  private async writeRun(result: SolveResult, tokens: number): Promise<void> {
    await mkdir(join(this.input.runRoot, 'input'), { recursive: true });
    await writeFile(join(this.input.runRoot, 'challenge.json'), JSON.stringify({ id: this.input.challengeId, target: this.input.challengeTarget, description: this.input.description }, null, 2));
    await mkdir(join(this.input.runRoot, 'artifacts'), { recursive: true });
    await mkdir(join(this.input.runRoot, 'scripts'), { recursive: true });
    const events = pipelineStages.map((stage, index) => JSON.stringify({
      seq: index + 1,
      kind: 'pipeline_stage',
      stage,
      runId: result.runId,
      at: new Date().toISOString()
    })).join('\n') + '\n';
    await Promise.all([
      writeFile(join(this.input.runRoot, 'events.jsonl'), events),
      writeFile(join(this.input.runRoot, 'result.json'), JSON.stringify({
        ...result,
        model: this.input.model.id,
        observableTokens: tokens,
        budget: this.input.budget
      }, null, 2))
    ]);
  }
}

export class ScriptedSolverModel implements ModelAdapter {
  readonly id = 'scripted-m0-solver';
  constructor(private readonly candidate: string) {}
  async invoke(turn: ModelTurn): Promise<ModelResponse> {
    if (turn.stage === 'submitting') return { text: `CANDIDATE: ${this.candidate}`, observableTokens: 12 };
    return { text: `stage=${turn.stage} observations=${turn.observations.length}`, observableTokens: 8 };
  }
}

export interface OpenAICompatibleModelOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  temperature?: number;
}

/**
 * Minimal OpenAI-compatible chat adapter (used by Volcano Ark and other compatible gateways).
 * It deliberately supports text output only; M0 smoke still requires the model to return a CANDIDATE.
 */
export class OpenAICompatibleModel implements ModelAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleModelOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get id(): string { return this.options.id; }

  async invoke(turn: ModelTurn): Promise<ModelResponse> {
    const gateway = new ModelDataGateway();
    const userPayload = gateway.request({
      dataClass: 'challenge_analysis_data',
      operation: 'model.invoke',
      value: turn
    });
    const response = await this.fetchImpl(new URL('chat/completions', this.options.baseUrl.endsWith('/') ? this.options.baseUrl : this.options.baseUrl + '/'), {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.options.id,
        temperature: this.options.temperature ?? 0.2,
        messages: [
          { role: 'system', content: 'You are an authorized CTF solver. Return concise findings. For a candidate, return CANDIDATE: <value>.' },
          { role: 'user', content: JSON.stringify(userPayload) }
        ]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`model request failed: ${response.status} ${body.slice(0, 500)}`);
    }
    const parsed = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number; completion_tokens?: number };
    };
    const text = parsed.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('model response had no text content');
    return {
      text,
      observableTokens: parsed.usage?.total_tokens ?? parsed.usage?.completion_tokens ?? Math.ceil(text.length / 4)
    };
  }
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}

export interface AnthropicCompatibleModelOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  version?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  temperature?: number;
  tools?: AnthropicTool[];
  maxToolRounds?: number;
  requestTimeoutMs?: number;
}

/**
 * Anthropic Messages-compatible adapter for gateways such as Volcano Ark coding endpoints.
 */
export class AnthropicCompatibleModel implements ModelAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AnthropicCompatibleModelOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get id(): string { return this.options.id; }

  private async callAnthropic(messages: Array<{ role: 'user' | 'assistant'; content: unknown }>): Promise<{
    content: Array<any>;
    usage?: { input_tokens?: number; output_tokens?: number };
  }> {
    const gateway = new ModelDataGateway();
    const tools = this.options.tools ?? [];
    const base = this.options.baseUrl.endsWith('/') ? this.options.baseUrl : this.options.baseUrl + '/';
    const response = await this.fetchImpl(new URL('v1/messages', base), {
      method: 'POST',
      headers: {
        'x-api-key': this.options.apiKey,
        'authorization': `Bearer ${this.options.apiKey}`,
        'anthropic-version': this.options.version ?? '2023-06-01',
        'content-type': 'application/json'
      },
      signal: this.options.requestTimeoutMs ? AbortSignal.timeout(this.options.requestTimeoutMs) : undefined,
      body: JSON.stringify({
        model: this.options.id,
        max_tokens: this.options.maxTokens ?? 4096,
        temperature: this.options.temperature ?? 0.2,
        system: 'You are an authorized CTF solver. Use the provided observation tools before concluding. Return concise findings. For a candidate, return CANDIDATE: <value>.',
        ...(tools.length ? { tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })) } : {}),
        messages
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`model request failed: ${response.status} ${body.slice(0, 500)}`);
    }
    const parsed = await response.json() as { content?: Array<any>; usage?: { input_tokens?: number; output_tokens?: number } };
    if (!parsed.content) throw new Error('model response had no content');
    return parsed as { content: Array<any>; usage?: { input_tokens?: number; output_tokens?: number } };
  }

  async invoke(turn: ModelTurn): Promise<ModelResponse> {
    const gateway = new ModelDataGateway();
    const userPayload = gateway.request({
      dataClass: 'challenge_analysis_data',
      operation: 'model.invoke',
      value: turn
    });
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: JSON.stringify(userPayload) }
    ];
    let tokens = 0;
    const maxRounds = this.options.maxToolRounds ?? 6;
    for (let round = 0; round <= maxRounds; round++) {
      const response = await this.callAnthropic(messages);
      tokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      const text = response.content.filter((item: any) => item?.type === 'text').map((item: any) => item.text ?? '').join('').trim();
      const toolUses = response.content.filter((item: any) => item?.type === 'tool_use');
      if (!toolUses.length) {
        if (!text) throw new Error('model response had no text content');
        return { text, observableTokens: tokens || Math.ceil(text.length / 4) };
      }
      if (round === maxRounds) throw new Error('model tool budget exhausted');
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const toolUse of toolUses) {
        const tool = this.options.tools?.find(candidate => candidate.name === toolUse.name);
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `unknown tool: ${toolUse.name}` });
          continue;
        }
        try {
          const output = await tool.execute(toolUse.input);
          const serialized = JSON.stringify(output);
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: serialized.length > 12000 ? serialized.slice(0, 12000) + '\n...[truncated]' : serialized });
        } catch (error) {
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: error instanceof Error ? error.message : String(error) });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    throw new Error('unreachable model tool loop state');
  }
}

// M1 Task 1 foundation; the M0 linear smoke pipeline above remains unchanged.
export { ResponsibilityRegistry } from './responsibilities.js';
export type { ResponsibilityBinding, ReasoningContext, VerifyArtifact, DeepReadonly } from './responsibilities.js';
export { PublishedRevisionService } from './revisions.js';
export type { PublishedOutput, AdoptedOutput, AdoptionResult } from './revisions.js';

export { HypothesisManager, experimentFingerprint } from './hypotheses.js';
export type { HypothesisManagerOptions, ExperimentRecord, ProgressRecord, ProgressAcceptance, ProgressWindow } from './hypotheses.js';
export { SolverLoop, SolverFailure, SolverActionSchema, solverDisposition } from './solver-loop.js';
export type { SolverAction, SolverDriver, SolverRequest, SolverObservation, SolverUsage, SolverFailureCode, SolverLoopOptions, SolverResult, CandidateResolverInput } from './solver-loop.js';
export { ProviderSolverDriver, SolverModelActionSchema, materializeSolverAction } from './provider-solver-driver.js';
export type { ProviderSolverDriverOptions, SolverModelAction } from './provider-solver-driver.js';
export { DurableJobWatchService } from './long-job-watch.js';
export * from './compaction.js';
export * from './local-resume.js';
export * from './candidate-verification.js';
export * from './http-progress-adjudicator.js';
export * from './multiflag.js';
