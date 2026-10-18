import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { BudgetSchema, EventDeltaSchema, ExperimentSchema, HypothesisSchema, ImmutableArtifactRefSchema,
  RuntimeExperimentEventSchema, SolveStateSchema, OutcomeSchema, type Budget, type EventDelta, type HypothesisConclusion, type ImmutableArtifactRef } from '@ctf/contracts';
import type { ArtifactStore } from '@ctf/artifacts';
import type { StateStore } from '@ctf/state';
import type { BinaryData, ToolRuntime } from '@ctf/runtime';
import type { ReferenceService } from '@ctf/reference';
import { HypothesisManager, type HypothesisManagerOptions } from './hypotheses.js';
import { freezeData, type ResponsibilityBinding, type ResponsibilityRegistry } from './responsibilities.js';
import { DurableJobWatchService } from './long-job-watch.js';
import { loadDomainSkill, type Domain } from './skills/index.js';

const text = z.string().min(1);
const commandInput = z.object({ command: z.array(text).min(1), timeout_ms: z.number().int().positive().optional(), max_retained_bytes: z.number().int().positive().optional() }).strict();
const pathInput = z.object({ path: text }).strict();
const endpointInput = z.object({ host: text, port: z.number().int().min(1).max(65535) }).strict();
const boundedTimeoutInput = { timeout_ms: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(), max_retained_bytes: z.number().int().positive().max(16 * 1024 * 1024).optional() };
const ownerResourceInput = z.object({ id: text }).strict();
const cursorInput = z.object({ id: text, cursor: z.number().int().nonnegative(), max_bytes: z.number().int().positive().max(65536).optional() }).strict();
const writeInput = z.object({ id: text, data: z.union([
  z.object({ encoding: z.literal('bytes'), data: z.array(z.number().int().min(0).max(255)).max(1024 * 1024) }).strict(),
  z.object({ encoding: z.literal('base64'), data: z.string().max(4 * 1024 * 1024) }).strict()
]) }).strict();
const ToolActionSchema = z.discriminatedUnion('tool', [
  z.object({ kind: z.literal('tool'), tool: z.literal('workspace.read'), input: pathInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('workspace.search'), input: pathInput.extend({ needle: text }), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('workspace.patch'), input: pathInput.extend({ find: text, replace: z.string() }), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('reference.search'), input: z.object({ query: text, limit: z.number().int().min(1).max(5).optional() }).strict(), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('reference.get'), input: z.object({ id: text }).strict(), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('skill.load'), input: z.object({ domain: z.enum(['web', 'misc', 'crypto']) }).strict(), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('http.request'), input: z.object({ url: z.string().url() }).strict(), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.start'), input: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('pty'), command: z.array(text).min(1), ...boundedTimeoutInput }).strict(),
    z.object({ mode: z.literal('tcp_session'), endpoint: endpointInput, ...boundedTimeoutInput }).strict()
  ]), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.status'), input: ownerResourceInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.read'), input: cursorInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.write'), input: writeInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.list'), input: z.object({}).strict(), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.cancel'), input: ownerResourceInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('channel.open'), input: endpointInput.extend(boundedTimeoutInput), step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('channel.status'), input: ownerResourceInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('channel.read'), input: cursorInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('channel.write'), input: writeInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('channel.close'), input: ownerResourceInput, step_id: text.optional() }).strict(),
  z.object({ kind: z.literal('tool'), tool: z.literal('job.run'), input: commandInput, step_id: text }).strict()
]);
const DispatchSchema = z.object({ kind: z.literal('dispatch'), hypothesis: HypothesisSchema.optional(), experiment: ExperimentSchema }).strict();
const ConcludeSchema = z.object({ kind: z.literal('conclude'), verdict: z.enum(['supported', 'rejected', 'inconclusive', 'stale']), rationale: text, evidence_refs: z.array(ImmutableArtifactRefSchema) }).strict();
const CandidateSchema = z.object({ kind: z.literal('candidate'), value: text, evidence_refs: z.array(ImmutableArtifactRefSchema).min(1) }).strict();
const StopSchema = z.object({ kind: z.literal('stop'), reason: text }).strict();
export const SolverActionSchema = z.union([ToolActionSchema, DispatchSchema, ConcludeSchema, CandidateSchema, StopSchema]);
export type SolverAction = z.infer<typeof SolverActionSchema>;
export type SolverFailureCode = 'tool_invocation_error' | 'output_parse_error' | 'model_transient' | 'model_rate_limited' | 'blocked_data' | 'scope_denied' | 'resource_exhausted';
const UsageSchema = z.object({ provenance: z.enum(['deterministic', 'provider_reported']), input_tokens: z.number().int().nonnegative().safe(), output_tokens: z.number().int().nonnegative().safe(), model_calls: z.number().int().nonnegative().safe() }).strict();
export type SolverUsage = z.infer<typeof UsageSchema>;
export class SolverFailure extends Error {
  constructor(readonly code: SolverFailureCode, raw: string, readonly retryAfterMs = 0, readonly usage?: SolverUsage) { super(raw); }
}
export interface SolverObservation {
  tool: string; raw: string; outcome: 'success' | 'failure'; failure_code: SolverFailureCode | null;
  artifact_refs: ImmutableArtifactRef[]; job_id?: string; complete: boolean;
}
export interface SolverRequest {
  phase: 'solver' | 'strategy'; binding: ResponsibilityBinding;
  challenge: { ready: boolean; description: string; material_refs: ImmutableArtifactRef[]; snapshot: Record<string, unknown> };
  experiment: ReturnType<HypothesisManager['experiment']> | null;
  observation: SolverObservation | null; strategy_reason: string | null;
  remaining: { wall_ms: number; steps: number; tools: number; tokens: number };
}
/** Provider adapters own credential/model parsing and return authoritative usage, never worker-supplied usage. */
export interface SolverDriver {
  decide(request: SolverRequest, control: { signal: AbortSignal; maxTokens: number }): Promise<{ action: SolverAction; usage: SolverUsage }>;
}
export interface CandidateResolution {
  /** Host-owned result. A candidate is never accepted from model text alone. */
  status: 'accepted' | 'partial' | 'rejected' | 'inconclusive';
  authoritative: boolean;
  detail: string;
  evidence_refs?: ImmutableArtifactRef[];
  correct_flag_count?: number;
  total_flag_count?: number;
  matched_slot?: number;
  submit_effect_id?: string;
  completed?: boolean;
  verification?: { id: string; status: 'verified' | 'rejected' | 'inconclusive' | 'stale'; candidateHash: string; generation: number; current: boolean };
}
export interface CandidateResolverInput {
  candidateId: string; runId: string; challengeId: string; taskId: string; sessionId: string; generation: number; value: string;
  valueRef: ImmutableArtifactRef; evidenceRefs: ImmutableArtifactRef[]; experimentId: string;
  experiment: ReturnType<HypothesisManager['experiment']>;
  control: CandidateResolverControl;
  stageEvent: (stage: 'engineering' | 'verification' | 'oracle_submit', state: 'started' | 'completed' | 'failed') => void;
}
export interface CandidateResolverControl {
  signal: AbortSignal;
  deadline: string;
  remaining: () => { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
  /** Reserve shared run budget immediately before starting a resolver stage/side effect. */
  admit: (stage: 'engineering' | 'verification' | 'verification_replay' | 'oracle_submit') => Budget;
}
export interface SolverLoopOptions {
  registry: ResponsibilityRegistry; sessionId: string; state: StateStore; artifacts: ArtifactStore; runtime: ToolRuntime;
  driver: SolverDriver; challenge: SolverRequest['challenge']; budget: Budget;
  /** Trusted host policy. Must reject commands outside the authorized local challenge scope. No shell is used. */
  authorizeCommand: (command: readonly string[], workspace: string) => void | Promise<void>;
  /** Raw TCP access is denied unless the host explicitly authorizes the exact challenge endpoint. */
  authorizeTcpEndpoint?: (endpoint: { host: string; port: number }) => void | Promise<void>;
  /** Real immutable-artifact discriminator. No unconditional semantic acceptance default exists. */
  validateProgress: HypothesisManagerOptions['validateProgress'];
  /** Host orchestration must bind Engineering, independent Verification and VerifiedCoordinator here. */
  resolveCandidate?: (input: CandidateResolverInput) => Promise<CandidateResolution>;
  reference?: ReferenceService;
  deadline?: string; maxModelRetries?: number; maxPatchBytes?: number;
}
export interface SolverResult {
  status: 'solved' | 'partial' | 'candidate_only' | 'blocked' | 'resource_exhausted' | 'no_route'; reason: string;
  solve_state: z.infer<typeof SolveStateSchema>; outcome: z.infer<typeof OutcomeSchema>;
  candidate?: { value: string; value_ref: ImmutableArtifactRef; evidence_refs: ImmutableArtifactRef[] };
}
/** Total public result mapping to the exact spec §7.1 vocabulary. No unverified result is solved. */
export function solverDisposition(status: SolverResult['status'], failureCode?: SolverFailureCode, deadlineExceeded = false): Pick<SolverResult, 'solve_state' | 'outcome'> {
  switch (status) {
    case 'solved': return { solve_state: 'finished', outcome: 'solved' };
    case 'partial': return { solve_state: 'paused', outcome: 'partial' };
    case 'candidate_only': return { solve_state: 'paused', outcome: 'candidate_only' };
    case 'no_route': return { solve_state: 'paused', outcome: 'unsolved' };
    case 'resource_exhausted': return { solve_state: deadlineExceeded ? 'deadline_exceeded' : 'paused', outcome: 'inconclusive' };
    case 'blocked': return { solve_state: failureCode === 'blocked_data' ? 'blocked_data' : failureCode === 'scope_denied' ? 'blocked_capability' : 'blocked_runtime', outcome: 'inconclusive' };
  }
}
type Activity = Extract<EventDelta, { kind: 'solver.activity' }>['activity'];
type ToolAction = z.infer<typeof ToolActionSchema>;
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Event-driven long-job continuation within one Solver session; process/session restart is the Task 8 boundary. */
export class SolverLoop {
  readonly hypotheses: HypothesisManager;
  private readonly binding: ResponsibilityBinding;
  private readonly started = Date.now();
  private readonly deadline: number;
  private used = { steps: 0, tools: 0, tokens: 0, modelCalls: 0 };
  private phase: SolverRequest['phase'] = 'solver';
  private strategyReason: string | null = null;
  private active: string | null = null;
  private observation: SolverObservation | null = null;
  private repairPending = false;
  private pendingFailure: { receipt_id: string; failure_code: SolverFailureCode; raw_refs: ImmutableArtifactRef[]; input: unknown; step_id: string; repair_admitted: boolean } | null = null;
  private runStarted = false;
  private inputRefs: ImmutableArtifactRef[] = [];
  private preExperimentRepairs = 0;
  private windowStrategyPending = false;
  private runningJob: string | null = null;
  private acceptedPartial = false;

  constructor(private readonly options: SolverLoopOptions) {
    BudgetSchema.parse(options.budget);
    this.binding = structuredClone(options.registry.binding(options.sessionId)) as ResponsibilityBinding;
    if (!this.binding.responsibility_set.includes('domain_solver')) throw new Error('Solver requires domain_solver responsibility');
    if (options.deadline !== undefined && !Number.isFinite(Date.parse(options.deadline))) throw new Error('invalid deadline');
    this.deadline = Math.min(this.started + options.budget.wallClockMs, options.deadline ? Date.parse(options.deadline) : Infinity, Date.parse(this.binding.expires_at));
    if (options.maxModelRetries !== undefined && (!Number.isSafeInteger(options.maxModelRetries) || options.maxModelRetries < 0)) throw new Error('invalid retry limit');
    this.hypotheses = new HypothesisManager({
      verifyArtifact: ref => options.artifacts.verify(ref), validateProgress: options.validateProgress,
      assertCurrent: () => { this.checkBudget(false); this.checkAuthority(); },
      resolveRuntimeEvent: async id => {
        const event = options.state.events().find(event => event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.receipt_id === id);
        if (!event || event.kind !== 'solver.activity' || event.runId !== this.binding.run_id || event.challengeId !== this.binding.challenge_id || event.taskId !== this.binding.task_id || event.sessionId !== this.binding.session_id || event.attemptId !== this.binding.attempt_id) throw new Error('unknown or foreign host runtime receipt');
        return event.data.receipt;
      }
    });
  }

  async run(): Promise<SolverResult> {
    if (this.runStarted) throw new Error('SolverLoop is single-use; restart entry point is deferred to Task 8');
    this.runStarted = true;
    if (!this.options.challenge.ready) return this.finish('blocked', 'challenge is not ready');
    this.checkAuthority();
    for (const ref of this.options.challenge.material_refs) await this.options.artifacts.verify(ref);
    this.inputRefs = structuredClone(this.options.challenge.material_refs);
    this.event('started', { challenge: this.options.challenge, budget: this.options.budget, deadline: new Date(this.deadline).toISOString() });
    while (true) {
      try {
        this.checkBudget(); this.checkAuthority();
        const action = await this.decide();
        this.checkBudget(false); this.checkAuthority();
        if (action.kind === 'stop') return this.finish(this.acceptedPartial ? 'partial' : 'no_route', action.reason);
        if (this.phase === 'strategy' && action.kind !== 'dispatch') throw new SolverFailure('output_parse_error', 'Strategy must select a new runnable route or stop');
        if (action.kind === 'dispatch') { await this.dispatch(action); continue; }
        if (action.kind === 'tool') { await this.tool(action); continue; }
        if (action.kind === 'conclude') { await this.conclude(action); continue; }
        const candidateResult = await this.candidate(action);
        if (candidateResult) return candidateResult;
        continue;
      } catch (error) {
        const failure = error instanceof SolverFailure ? error : new SolverFailure('output_parse_error', error instanceof Error ? error.stack ?? error.message : String(error));
        if (failure.code === 'resource_exhausted') { await this.closeFailedExperiment(); return this.finish('resource_exhausted', failure.message, undefined, failure.code); }
        if (failure.code === 'blocked_data' || failure.code === 'scope_denied') { await this.closeFailedExperiment(); return this.finish('blocked', `${failure.code}: ${failure.message}`, undefined, failure.code); }
        this.observation = await this.errorObservation('driver/action', failure);
        // Parsing/representation repair has a finite local allowance; it never becomes mechanism refutation.
        if (!this.admitRepair('representation', { failure_code: failure.code, raw_refs: this.observation.artifact_refs })) {
          if (this.phase === 'strategy') return this.finish('blocked', `strategy adapter failed: ${failure.message}`);
          await this.retireExperiment('representation repair budget exhausted'); this.requestStrategy('representation repair budget exhausted');
        }
      }
    }
  }

  private request(): SolverRequest {
    const experiment = this.active ? this.hypotheses.experiment(this.active) : null;
    const wall = Math.min(this.deadline, experiment ? this.experimentDeadline(experiment.plan.id) : Infinity) - Date.now();
    return structuredClone({ phase: this.phase, binding: this.binding, challenge: this.options.challenge,
      experiment, observation: this.observation, strategy_reason: this.strategyReason,
      remaining: { wall_ms: Math.max(0, wall), steps: this.options.budget.maxSteps - this.used.steps,
        tools: this.options.budget.maxToolJobs - this.used.tools, tokens: this.options.budget.maxObservableTokens - this.used.tokens } });
  }
  private experimentStarts = new Map<string, { at: number; tokens: number }>();
  private experimentDeadline(id: string): number { return this.experimentStarts.get(id)!.at + this.hypotheses.experiment(id).plan.budget.wall_ms; }

  private async decide(): Promise<SolverAction> {
    for (let retries = 0; ; retries++) {
      this.checkBudget();
      const request = freezeData(this.request()) as SolverRequest;
      const maxTokens = Math.min(request.remaining.tokens, this.active ? this.hypotheses.experiment(this.active).plan.budget.tokens - (this.used.tokens - this.experimentStarts.get(this.active)!.tokens) : Infinity);
      if (maxTokens <= 0) throw new SolverFailure('resource_exhausted', 'observable token budget exhausted');
      // Reserve the complete remaining token allowance before dispatch. On an
      // observed response it is settled to provider-reported usage; unknown usage
      // keeps the reservation consumed and fails closed.
      this.used.tokens += maxTokens;
      const controller = new AbortController();
      const began = Date.now(); this.used.steps++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let usageRecorded = false;
      try {
        const response = await Promise.race([
          this.options.driver.decide(request, { signal: controller.signal, maxTokens }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SolverFailure('resource_exhausted', 'driver exceeded deadline')); }, request.remaining.wall_ms); })
        ]);
        this.used.tokens -= maxTokens;
        usageRecorded = true; this.accountUsage(response.usage, began, maxTokens, null, response.action);
        const action = SolverActionSchema.safeParse(response.action);
        if (!action.success) throw new SolverFailure('output_parse_error', action.error.toString());
        return action.data;
      } catch (error) {
        if (!usageRecorded && error instanceof SolverFailure && error.usage !== undefined && !['model_transient', 'model_rate_limited'].includes(error.code)) {
          this.used.tokens -= maxTokens;
          usageRecorded = true; this.accountUsage(error.usage, began, maxTokens, error.code);
        }
        if (!(error instanceof SolverFailure) || !['model_transient', 'model_rate_limited'].includes(error.code)) {
          if (!usageRecorded) {
            this.event('driver.call', { began_at: new Date(began).toISOString(), ended_at: new Date().toISOString(), usage: null, failure: String(error), provenance: 'unavailable' });
            throw new SolverFailure('resource_exhausted', `driver usage unavailable: ${String(error)}`);
          }
          throw error;
        }
        if (error.usage === undefined) throw new SolverFailure('resource_exhausted', `provider usage unavailable after ${error.code}: ${error.message}`);
        this.used.tokens -= maxTokens;
        this.accountUsage(error.usage, began, maxTokens, error.code);
        this.observation = await this.errorObservation('model', error);
        if (retries >= (this.options.maxModelRetries ?? 2)) throw new SolverFailure('resource_exhausted', `model retry limit exhausted: ${error.message}`);
        if (!Number.isFinite(error.retryAfterMs) || error.retryAfterMs < 0) throw new SolverFailure('resource_exhausted', 'invalid Retry-After');
        if (error.retryAfterMs >= this.request().remaining.wall_ms) throw new SolverFailure('resource_exhausted', 'Retry-After exceeds remaining deadline');
        this.event('retry', { failure_code: error.code, retry: retries + 1, retry_after_ms: error.retryAfterMs });
        if (this.active && this.hypotheses.experiment(this.active).status === 'running') this.hypotheses.recordActivity(this.active, { kind: 'transient_retry', reason: error.message });
        await new Promise(resolve => setTimeout(resolve, error.retryAfterMs));
      } finally { if (timer) clearTimeout(timer); }
    }
  }
  private accountUsage(input: unknown, began: number, maximum: number, failure: string | null, action?: unknown): void {
    // Missing usage on an attempted provider call is fail-closed, never a free hidden retry.
    const parsed = UsageSchema.safeParse(input);
    this.event('driver.call', { phase: this.phase, began_at: new Date(began).toISOString(), ended_at: new Date().toISOString(), usage: parsed.success ? parsed.data : null, failure, admitted_tokens: maximum, ...(action === undefined ? {} : { action }) });
    if (!parsed.success) throw new SolverFailure('resource_exhausted', 'driver usage unavailable');
    const usage = parsed.data;
    this.used.tokens += usage.input_tokens + usage.output_tokens; this.used.modelCalls += usage.model_calls;
    if (usage.provenance === 'deterministic' && usage.model_calls !== 0) throw new SolverFailure('resource_exhausted', 'deterministic driver cannot claim live model calls');
    if (usage.input_tokens + usage.output_tokens > maximum) throw new SolverFailure('resource_exhausted', 'driver exceeded admitted token budget');
  }

  private async dispatch(action: z.infer<typeof DispatchSchema>): Promise<void> {
    if (this.active && this.hypotheses.experiment(this.active).status === 'running') throw new SolverFailure('output_parse_error', 'running experiment cannot be replaced');
    if (this.active && this.phase !== 'strategy' && this.assessmentWindow()) return;
    // This loop currently admits local rebuildable/observation tools only. Remote/protected units belong to later tasks.
    if (action.experiment.budget.remote_units !== 0 || action.experiment.procedure.some(step => !['workspace.read', 'workspace.search', 'workspace.patch', 'reference.search', 'reference.get', 'skill.load', 'http.request', 'job.run', 'job.start', 'job.status', 'job.read', 'job.write', 'job.list', 'job.cancel', 'channel.open', 'channel.status', 'channel.read', 'channel.write', 'channel.close'].includes(step.tool))) throw new SolverFailure('scope_denied', 'only authorized scoped tool procedures with zero remote units are supported');
    for (const ref of action.experiment.input_refs) await this.options.artifacts.verify(ref);
    this.checkBudget(false); this.checkAuthority();
    for (const [key, value] of Object.entries(action.experiment.state_dependencies)) if (!same(this.options.challenge.snapshot[key], value)) throw new SolverFailure('output_parse_error', 'experiment snapshot mismatch');
    if (action.hypothesis) this.hypotheses.addHypothesis(action.hypothesis);
    this.hypotheses.setRoutes({ primary: action.experiment.hypothesis_id, counterprobe: null });
    const experiment = this.hypotheses.startExperiment(action.experiment);
    this.experimentStarts.set(experiment.plan.id, { at: Date.now(), tokens: this.used.tokens });
    this.active = experiment.plan.id; this.repairPending = false; this.pendingFailure = null;
    if (this.phase === 'strategy') {
      if (this.windowStrategyPending) { this.hypotheses.strategyReplanned('Strategy selected the admitted replacement route'); this.windowStrategyPending = false; }
      this.event('strategy.switch', { hypothesis_id: experiment.plan.hypothesis_id, reason: this.strategyReason, evidence_refs: this.observation?.artifact_refs ?? [] });
    }
    this.phase = 'solver'; this.strategyReason = null;
    this.event('experiment.started', { experiment, hypothesis: this.hypotheses.hypothesis(experiment.plan.hypothesis_id) });
  }

  private async tool(action: ToolAction): Promise<void> {
    this.checkBudget(false); this.checkAuthority();
    if (this.used.tools >= this.options.budget.maxToolJobs) throw new SolverFailure('resource_exhausted', 'tool budget exhausted');
    let experiment = this.active ? this.hypotheses.experiment(this.active) : null;
    if (experiment?.status === 'running' && !action.step_id && action.tool === 'workspace.patch' && !this.repairPending) {
      throw new SolverFailure('output_parse_error', 'unplanned patch requires an actual failed step to repair; otherwise admit it in the experiment procedure');
    }
    if (action.step_id) {
      if (!experiment || experiment.status !== 'running') throw new SolverFailure('output_parse_error', 'tool step requires running experiment');
      const successes = experiment.events.filter(event => event.outcome === 'success').length;
      const step = experiment.plan.procedure[successes];
      if (!step || step.id !== action.step_id || step.tool !== action.tool) throw new SolverFailure('output_parse_error', 'tool differs from admitted ordered procedure');
      if (!same(step.input, action.input) && !(this.pendingFailure?.step_id === action.step_id && this.repairPending && action.tool === 'job.run' && (same(this.pendingFailure.input, action.input) || this.isBoundedParameterRepair(this.pendingFailure.input, action.input)))) throw new SolverFailure('output_parse_error', 'tool input differs from admitted ordered procedure; only one bounded positional-argument correction to a failed script invocation is allowed');
      if (this.repairPending) {
        if (!this.admitPendingRepair(action.input)) { await this.retireExperiment('tool repair budget exhausted'); this.requestStrategy('tool repair budget exhausted'); return; }
        this.repairPending = false;
      }
    }
    if (action.tool === 'workspace.patch' && !action.step_id && this.repairPending && !this.admitPendingRepair(this.pendingFailure!.input)) {
      await this.retireExperiment('tool repair budget exhausted'); this.requestStrategy('tool repair budget exhausted'); return;
    }
    this.used.tools++;
    const receiptId = `receipt_${randomUUID()}`;
    this.event('tool.started', { receipt_id: receiptId, tool: action.tool, input: action.input, experiment_id: experiment?.plan.id ?? null });
    let observation: SolverObservation;
    const toolController = new AbortController();
    const toolTimeout = setTimeout(() => toolController.abort(new Error('run deadline exceeded')), Math.max(1, Math.min(this.deadline, this.active ? this.experimentDeadline(this.active) : Infinity) - Date.now()));
    try { observation = await this.execute(action, toolController.signal); }
    catch (error) { observation = await this.errorObservation(action.tool, toolController.signal.aborted
      ? new SolverFailure('resource_exhausted', 'Runtime action cancelled at run deadline')
      : error instanceof SolverFailure ? error : new SolverFailure('tool_invocation_error', error instanceof Error ? error.stack ?? error.message : String(error))); }
    finally { clearTimeout(toolTimeout); }
    this.observation = observation;
    const receipt = action.step_id && experiment ? RuntimeExperimentEventSchema.parse({
      id: receiptId, experiment_id: experiment.plan.id, fingerprint: experiment.fingerprint, step_id: action.step_id,
      outcome: observation.outcome, failure_code: observation.failure_code, artifact_refs: observation.artifact_refs
    }) : null;
    this.event('tool.result', { receipt_id: receiptId, tool: action.tool, observation, receipt });
    if (receipt) await this.hypotheses.recordRuntimeEvent(receiptId);
    if (observation.failure_code === 'resource_exhausted') throw new SolverFailure('resource_exhausted', observation.raw);
    if (observation.failure_code === 'scope_denied' || observation.failure_code === 'blocked_data') throw new SolverFailure(observation.failure_code, observation.raw);
    if (observation.outcome === 'failure') {
      if (!receipt) {
        if (!this.admitRepair('auxiliary', { failure_code: observation.failure_code, raw_refs: observation.artifact_refs, failed_receipt_id: receiptId })) { await this.retireExperiment('auxiliary tool repair budget exhausted'); this.requestStrategy('auxiliary tool repair budget exhausted'); }
        return;
      }
      experiment = this.hypotheses.experiment(experiment!.plan.id);
      this.pendingFailure = { receipt_id: receiptId, failure_code: observation.failure_code!, raw_refs: observation.artifact_refs, input: action.input, step_id: action.step_id!, repair_admitted: false };
      if (experiment.activities.filter(activity => activity.kind === 'repair').length < experiment.plan.repair_budget) this.repairPending = true;
      else { await this.closeFailedExperiment(); this.requestStrategy('tool repair budget exhausted'); }
    } else if (receipt && experiment && this.hypotheses.experiment(experiment.plan.id).events.filter(event => event.outcome === 'success').length === experiment.plan.procedure.length) {
      const completed = this.hypotheses.completeExperiment(experiment.plan.id);
      this.event('experiment.completed', { experiment: completed });
      // A successful runtime result still needs the Solver's semantic assessment. Close its window later.
    }
  }

  private async execute(action: ToolAction, signal: AbortSignal): Promise<SolverObservation> {
    const workspace = this.options.runtime.workspace(this.binding.task_id);
    const owner = { sessionId: this.binding.session_id, leaseId: this.binding.lease_id };
    const expiresAt = this.binding.expires_at;
    const registerOwner = () => this.options.runtime.registerTaskLease({ ...owner, taskId: this.binding.task_id, expiresAt });
    const retained = async (tool: string, value: unknown): Promise<SolverObservation> => {
      const raw = JSON.stringify(value);
      const ref = this.keep(await this.options.artifacts.publish(Buffer.from(raw)));
      return { tool, raw, outcome: 'success', failure_code: null, artifact_refs: [ref], complete: true };
    };
    if (action.tool === 'job.start') {
      const timeoutMs = Math.max(1, Math.min(action.input.timeout_ms ?? Infinity, this.request().remaining.wall_ms));
      registerOwner();
      if (action.input.mode === 'pty') {
        try { await this.options.authorizeCommand(action.input.command, workspace.path); }
        catch (error) { throw new SolverFailure('scope_denied', `PTY command denied: ${error instanceof Error ? error.message : String(error)}`); }
        this.checkBudget(false); this.checkAuthority();
        const job = await this.options.runtime.jobStart({ taskId: this.binding.task_id, command: action.input.command, mode: 'pty', owner,
          timeoutMs, maxRetainedBytes: action.input.max_retained_bytes });
        return retained(action.tool, job);
      }
      if (!this.options.authorizeTcpEndpoint) throw new SolverFailure('scope_denied', 'TCP session has no host endpoint authorization');
      try { await this.options.authorizeTcpEndpoint(action.input.endpoint); }
      catch (error) { throw new SolverFailure('scope_denied', `TCP session endpoint denied: ${error instanceof Error ? error.message : String(error)}`); }
      this.checkBudget(false); this.checkAuthority();
      const job = await this.options.runtime.jobStart({ taskId: this.binding.task_id, mode: 'tcp_session', endpoint: action.input.endpoint, owner,
        timeoutMs, maxRetainedBytes: action.input.max_retained_bytes });
      return retained(action.tool, job);
    }
    if (action.tool === 'channel.open') {
      if (!this.options.authorizeTcpEndpoint) throw new SolverFailure('scope_denied', 'channel has no host endpoint authorization');
      try { await this.options.authorizeTcpEndpoint(action.input); }
      catch (error) { throw new SolverFailure('scope_denied', `channel endpoint denied: ${error instanceof Error ? error.message : String(error)}`); }
      this.checkBudget(false); this.checkAuthority();
      registerOwner();
      const timeoutMs = Math.max(1, Math.min(action.input.timeout_ms ?? Infinity, this.request().remaining.wall_ms));
      const channel = await this.options.runtime.channelOpen({ taskId: this.binding.task_id, owner,
        endpoint: { host: action.input.host, port: action.input.port },
        timeoutMs, maxRetainedBytes: action.input.max_retained_bytes });
      return retained(action.tool, channel);
    }
    if (action.tool === 'job.list') {
      registerOwner();
      return retained(action.tool, this.options.runtime.jobList({ ...owner, taskId: this.binding.task_id }));
    }
    if (action.tool === 'job.status') {
      registerOwner();
      const job = this.options.runtime.jobStatus(action.input.id, owner);
      if (!job) throw new SolverFailure('blocked_data', 'job is unavailable to the current session lease');
      return retained(action.tool, job);
    }
    if (action.tool === 'channel.status') {
      registerOwner();
      const channel = this.options.runtime.channelStatus(action.input.id, owner);
      if (!channel) throw new SolverFailure('blocked_data', 'channel is unavailable to the current session lease');
      return retained(action.tool, channel);
    }
    if (action.tool === 'job.read' || action.tool === 'channel.read') {
      registerOwner();
      const read = action.tool === 'job.read'
        ? await this.options.runtime.jobRead(action.input.id, action.input.cursor, action.input.max_bytes ?? 65536, owner)
        : await this.options.runtime.channelRead(action.input.id, action.input.cursor, action.input.max_bytes ?? 65536, owner);
      return retained(action.tool, { ...read, bytes: read.bytes.toString('base64'), encoding: 'base64' });
    }
    if (action.tool === 'job.write' || action.tool === 'channel.write') {
      registerOwner();
      this.checkBudget(false); this.checkAuthority();
      const data: BinaryData = action.input.data.encoding === 'bytes'
        ? { encoding: 'bytes', data: Uint8Array.from(action.input.data.data) }
        : action.input.data;
      const written = action.tool === 'job.write'
        ? await this.options.runtime.jobWrite(action.input.id, data, owner)
        : await this.options.runtime.channelWrite(action.input.id, data, owner);
      return retained(action.tool, { ...written, effect: 'one-shot; no automatic retry' });
    }
    if (action.tool === 'job.cancel' || action.tool === 'channel.close') {
      registerOwner();
      const record = action.tool === 'job.cancel'
        ? await this.options.runtime.jobCancel(action.input.id, 'cancelled', owner)
        : await this.options.runtime.channelClose(action.input.id, owner);
      return retained(action.tool, record);
    }
    if (action.tool === 'job.run') {
      try { await this.options.authorizeCommand(action.input.command, workspace.path); }
      catch (error) { throw new SolverFailure('scope_denied', `batch job command denied: ${error instanceof Error ? error.message : String(error)}`); }
      this.checkBudget(false); this.checkAuthority();
      registerOwner();
      const timeoutMs = Math.max(1, Math.min(action.input.timeout_ms ?? Infinity, this.request().remaining.wall_ms));
      const job = await this.options.runtime.jobStart({ taskId: this.binding.task_id, command: action.input.command,
        owner, timeoutMs, maxRetainedBytes: action.input.max_retained_bytes });
      this.runningJob = job.id;
      const watches = new DurableJobWatchService(this.options.runtime, this.options.state);
      const deadline = new Date(Date.now() + timeoutMs).toISOString();
      const continuationRef = `continuation:${this.binding.task_id}:${this.active ?? 'auxiliary'}:${action.step_id ?? 'unplanned'}:${job.id}`;
      let current;
      try {
        const watch = await watches.watch({ jobId: job.id, taskId: this.binding.task_id,
          experimentId: this.active ?? 'auxiliary', cursor: 0, continuationRef, deadline, owner });
        this.event('job.watch', { job_id: job.id, cursor: watch.cursor, experiment_id: watch.experimentId,
          continuation_ref: watch.continuationRef, deadline: watch.deadline });
        const terminal = await watches.awaitContinuation(job.id, owner);
        const claimed = watches.claimContinuation(job.id);
        this.options.state.markOutboxDelivered(terminal.terminalEventId!);
        this.event('job.continuation', { job_id: job.id, terminal_event_id: terminal.terminalEventId,
          terminal_state: terminal.terminalState, continuation_ref: claimed.claimedContinuationRef, cursor: terminal.cursor });
        current = this.options.runtime.jobStatus(job.id, owner);
      } catch (error) {
        const active = this.options.runtime.jobStatus(job.id, owner);
        if (active?.status === 'running') {
          try { await this.options.runtime.jobCancel(job.id, 'cancelled', owner); }
          catch (cancelError) { throw new SolverFailure('blocked_data', `continuation failed and managed job could not be cancelled: ${String(cancelError)}`); }
        }
        throw error;
      } finally {
        watches.dispose();
        this.runningJob = null;
      }
      if (!current) throw new SolverFailure('blocked_data', 'watched job disappeared before continuation recovery');
      let cursor = 0; const chunks: Buffer[] = [];
      while (cursor < current.endCursor) {
        const read = await this.options.runtime.jobRead(job.id, cursor, 65536, owner);
        if (read.gap || read.readState === 'cursor_evicted' || read.readState === 'lost' || read.nextCursor <= cursor) {
          throw new SolverFailure('blocked_data', `incomplete raw transcript: ${JSON.stringify(read.gap ?? read.readState)}`);
        }
        chunks.push(read.bytes); this.event('tool.chunk', { job_id: job.id, start_cursor: read.readStart, end_cursor: read.nextCursor });
        cursor = read.nextCursor;
      }
      // Publish the fully consumed stream; reject evidence if the retained runtime range has a gap.
      const range = await this.options.runtime.publishJobEvidence(job.id, 0, cursor, owner);
      const ref = this.keep({ hash: range.hash, size: range.size, path: range.path });
      this.options.state.addEvidence({ id: `evidence_${job.id}`, runId: this.binding.run_id, source: 'observation', artifact: ref, startCursor: 0, endCursor: cursor });
      return { tool: action.tool, raw: Buffer.concat(chunks).toString('utf8'), outcome: current.status === 'completed' ? 'success' : 'failure',
        failure_code: current.status === 'completed' ? null : current.status === 'timeout' ? 'resource_exhausted' : 'tool_invocation_error', artifact_refs: [ref], job_id: job.id, complete: true };
    }
    if (action.tool === 'reference.search' || action.tool === 'reference.get') {
      if (!this.options.reference) throw new SolverFailure('scope_denied', 'this run has no approved Reference snapshot');
      const result = action.tool === 'reference.search' ? this.options.reference.search(action.input) : this.options.reference.get(action.input);
      const raw = JSON.stringify(result);
      const ref = this.keep(await this.options.artifacts.publish(Buffer.from(raw)));
      return { tool: action.tool, raw, outcome: 'success', failure_code: null, artifact_refs: [ref], complete: true };
    }
    if (action.tool === 'skill.load') {
      const skill = await loadDomainSkill(action.input.domain as Domain);
      const raw = JSON.stringify(skill);
      const ref = this.keep(await this.options.artifacts.publish(Buffer.from(raw)));
      return { tool: action.tool, raw, outcome: 'success', failure_code: null, artifact_refs: [ref], complete: true };
    }
    if (action.tool === 'http.request') {
      const session = await this.options.runtime.openHttpSession();
      try {
        const response = await this.options.runtime.httpRequest(session, action.input.url, { method: 'GET', signal }, 524288);
        const bodyText = response.body.toString('utf8');
        const responseRef = this.keep(response.artifact);
        const raw = JSON.stringify({ status: response.status, url: action.input.url, body: bodyText,
          response_ref: responseRef, truncated: response.body.length >= 524288 });
        const ref = this.keep(await this.options.artifacts.publish(Buffer.from(raw)));
        return { tool: action.tool, raw, outcome: 'success', failure_code: null, artifact_refs: [ref, responseRef], complete: true };
      } finally { this.options.runtime.closeHttpSession(session); }
    }
    const base = await realpath(workspace.path);
    const path = await realpath(resolve(workspace.path, action.input.path));
    if (!(path.startsWith(base + sep)) || path.includes(`${sep}.opencode${sep}`)) throw new SolverFailure('scope_denied', 'workspace path outside authorized material scope');
    let raw: string;
    if (action.tool === 'workspace.read') raw = (await workspace.read(action.input.path)).toString('utf8');
    else if (action.tool === 'workspace.search') raw = (await workspace.search(action.input.path, action.input.needle)).join('\n');
    else {
      const previous = (await workspace.read(action.input.path)).toString('utf8');
      const { find, replace } = action.input;
      if (find === previous || previous.split(find).length !== 2 || find === replace || Buffer.byteLength(find) + Buffer.byteLength(replace) > (this.options.maxPatchBytes ?? 512)) throw new SolverFailure('tool_invocation_error', 'patch requires exactly one bounded proper substring and a changed replacement');
      const before = this.keep(await this.options.artifacts.publish(Buffer.from(previous)));
      this.checkBudget(false); this.checkAuthority();
      await workspace.patch(action.input.path, previous.replace(find, () => replace));
      const after = this.keep(await this.options.artifacts.publish(await workspace.read(action.input.path)));
      raw = JSON.stringify({ path: action.input.path, before, after, changed_bytes: Buffer.byteLength(find) + Buffer.byteLength(replace) });
    }
    const ref = this.keep(await this.options.artifacts.publish(Buffer.from(raw)));
    return { tool: action.tool, raw, outcome: 'success', failure_code: null, artifact_refs: [ref], complete: true };
  }

  private async conclude(action: z.infer<typeof ConcludeSchema>): Promise<void> {
    if (!this.active) throw new SolverFailure('output_parse_error', 'conclusion requires experiment');
    const { kind: _, ...conclusion } = action;
    const progressBefore = this.hypotheses.progressRecords().length;
    try { await this.hypotheses.conclude(this.active, conclusion as HypothesisConclusion); }
    catch (error) {
      if (action.verdict === 'supported' || action.verdict === 'rejected') this.event('progress.adjudication', {
        accepted: false, rule: 'host_adjudicator', reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    const progressAfter = this.hypotheses.progressRecords();
    if (action.verdict === 'supported' || action.verdict === 'rejected') this.event('progress.adjudication', {
      accepted: progressAfter.length > progressBefore, rule: 'host_adjudicator', sequence: progressAfter.at(-1)?.sequence ?? null });
    this.event('hypothesis.conclusion', { experiment_id: this.active, conclusion, hypothesis: this.hypotheses.hypothesis(this.hypotheses.experiment(this.active).plan.hypothesis_id), progress_records: this.hypotheses.progressRecords() });
    const requested = this.assessmentWindow();
    if (action.verdict === 'rejected' && !requested) this.requestStrategy('hypothesis_falsified');
  }
  private async candidate(action: z.infer<typeof CandidateSchema>): Promise<SolverResult | null> {
    if (!this.active || this.hypotheses.experiment(this.active).status !== 'succeeded') throw new SolverFailure('output_parse_error', 'candidate requires successful actual experiment');
    const available = this.hypotheses.experiment(this.active).events.filter(event => event.outcome === 'success').flatMap(event => event.artifact_refs);
    for (const ref of action.evidence_refs) {
      if (!available.some(value => same(value, ref))) throw new SolverFailure('output_parse_error', 'candidate evidence must come from current successful runtime receipts');
      await this.options.artifacts.verify(ref);
      this.checkBudget(false); this.checkAuthority();
    }
    // This establishes a candidate artifact and evidence lineage, not independent verification.
    this.checkBudget(false); this.checkAuthority();
    const published = await this.options.artifacts.publish(Buffer.from(action.value));
    this.checkBudget(false); this.checkAuthority();
    const value_ref = this.keep(published);
    const candidate = { value: action.value, value_ref, evidence_refs: action.evidence_refs };
    const candidateId = `candidate_${randomUUID()}`;
    const stageEvent: CandidateResolverInput['stageEvent'] = (stage, state) => this.event('candidate.stage', { candidate_id: candidateId, stage, state });
    this.event('candidate.stage', { candidate_id: candidateId, stage: 'candidate', state: 'produced', value_hash: value_ref.hash });
    this.assessmentWindow(false);
    if (!this.options.resolveCandidate) {
      this.event('candidate', { status: 'candidate_only', ...candidate });
      return this.finish('candidate_only', 'candidate retained for later Engineer and independent Verifier integration', candidate);
    }
    const generationValue = this.options.challenge.snapshot.generation;
    if (!Number.isSafeInteger(generationValue) || (generationValue as number) < 0) {
      this.event('candidate', { status: 'inconclusive', authoritative: false, candidate_id: candidateId,
        reason: 'challenge snapshot has no authoritative resource generation', candidate });
      this.observation = { tool: 'candidate.resolve', raw: 'candidate is parked: authoritative challenge generation is unavailable',
        outcome: 'failure', failure_code: null, artifact_refs: [], complete: false };
      return null;
    }
    const generation = generationValue as number;
    let resolution: CandidateResolution;
    const resolverController = new AbortController();
    const resolverDeadline = Math.min(this.deadline, this.active ? this.experimentDeadline(this.active) : Infinity);
    const resolverRemaining = Math.max(0, resolverDeadline - Date.now());
    const resolverTimer = setTimeout(() => resolverController.abort(new Error('run deadline exceeded')), Math.max(1, resolverRemaining));
    const admittedStages = new Set<string>();
    const control: CandidateResolverControl = {
      signal: resolverController.signal,
      deadline: new Date(resolverDeadline).toISOString(),
      remaining: () => this.remainingBudget(),
      admit: stage => {
        if (resolverController.signal.aborted) throw new SolverFailure('resource_exhausted', 'candidate resolver cancelled at run deadline');
        if (admittedStages.has(stage)) throw new SolverFailure('scope_denied', `resolver stage already admitted: ${stage}`);
        this.checkBudget(false); this.checkAuthority();
        if (this.used.steps >= this.options.budget.maxSteps) throw new SolverFailure('resource_exhausted', 'shared step budget exhausted before resolver dispatch');
        if ((stage === 'oracle_submit' || stage === 'verification_replay') && this.used.tools >= this.options.budget.maxToolJobs) throw new SolverFailure('resource_exhausted', `shared tool budget exhausted before ${stage} dispatch`);
        this.used.steps++;
        if (stage === 'oracle_submit' || stage === 'verification_replay') this.used.tools++;
        admittedStages.add(stage);
        this.event('candidate.stage', { candidate_id: candidateId, stage, state: 'admitted', remaining: this.remainingBudget() });
        return this.remainingBudget();
      }
    };
    try {
      this.checkBudget(false); this.checkAuthority();
      resolution = await this.options.resolveCandidate({ candidateId, runId: this.binding.run_id, challengeId: this.binding.challenge_id,
        taskId: this.binding.task_id, sessionId: this.binding.session_id, generation,
        value: candidate.value, valueRef: candidate.value_ref, evidenceRefs: candidate.evidence_refs,
        experimentId: this.active!, experiment: this.hypotheses.experiment(this.active!), control, stageEvent });
    } catch (error) {
      // A verifier/submit adapter failure is unknown, never an implicit rejection or acceptance.
      resolution = { status: 'inconclusive', authoritative: false,
        detail: `candidate resolution unavailable: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(resolverTimer);
    }
    // Verify all resolver evidence before deciding whether a result arrived in time. Artifact
    // reads are asynchronous and may cross the deadline themselves.
    let resolverLate = Date.now() >= resolverDeadline || resolverController.signal.aborted;
    let safe: CandidateResolution = resolution.authoritative && typeof resolution.detail === 'string' && resolution.detail.length > 0
      ? resolution : { status: 'inconclusive', authoritative: false, detail: 'candidate resolver returned no authoritative result' };
    if (safe.authoritative && ['accepted', 'partial', 'rejected'].includes(safe.status) &&
      ['engineering', 'verification', 'oracle_submit'].some(stage => !admittedStages.has(stage))) {
      safe = { status: 'inconclusive', authoritative: false, detail: 'candidate resolver result did not reserve the shared run budget for every required stage' };
    }
    const verifiedBinding = safe.verification?.status === 'verified' && safe.verification.current === true &&
      safe.verification.candidateHash === candidate.value_ref.hash && safe.verification.generation === generation;
    if (['accepted', 'partial', 'rejected'].includes(safe.status) && !verifiedBinding) {
      safe = { status: 'inconclusive', authoritative: false, detail: 'candidate result lacks a current verification bound to these bytes and generation' };
    }
    const validCounts = Number.isSafeInteger(safe.correct_flag_count) && Number.isSafeInteger(safe.total_flag_count) &&
      safe.correct_flag_count! >= 1 && safe.total_flag_count! >= safe.correct_flag_count!;
    if (safe.status === 'accepted' && safe.completed !== true) {
      safe = safe.completed === false && validCounts && safe.correct_flag_count! < safe.total_flag_count!
        ? { ...safe, status: 'partial' }
        : { status: 'inconclusive', authoritative: false, detail: 'accepted candidate lacks authoritative challenge-completion state' };
    }
    if (safe.status === 'partial' && (safe.completed !== false || !validCounts || safe.correct_flag_count! >= safe.total_flag_count!)) {
      safe = { status: 'inconclusive', authoritative: false, detail: 'partial result lacks authoritative slot counts' };
    }
    for (const ref of safe.evidence_refs ?? []) {
      await this.options.artifacts.verify(ref);
      this.keep(ref);
      resolverLate ||= Date.now() >= resolverDeadline || resolverController.signal.aborted;
    }
    if (resolverLate) {
      const dispatch = safe.submit_effect_id ? this.options.state.effect(safe.submit_effect_id) : undefined;
      const payload = dispatch?.payload && typeof dispatch.payload === 'object' ? dispatch.payload as Record<string, unknown> : undefined;
      const dispatchMatches = !!dispatch && dispatch.operation === 'candidate.submit' && dispatch.runId === this.binding.run_id &&
        dispatch.challengeId === this.binding.challenge_id && dispatch.state === 'confirmed' && !!dispatch.dispatchedAt &&
        Date.parse(dispatch.dispatchedAt) <= this.deadline && Date.parse(dispatch.preparedAt) <= this.deadline &&
        payload?.candidate === candidate.value && payload?.challengeId === this.binding.challenge_id;
      const receipt = dispatch?.authoritativeResponse && typeof dispatch.authoritativeResponse === 'object'
        ? dispatch.authoritativeResponse as Record<string, unknown> : undefined;
      const receiptMatches = dispatchMatches && receipt?.authoritative === true &&
        (receipt.status === 'accepted' || receipt.status === 'duplicate' || receipt.status === 'rejected') &&
        dispatch!.businessOutcome === receipt.status;
      this.event('candidate', { candidate_id: candidateId, status: 'late_reconcile', late: true,
        dispatched_before_deadline: dispatchMatches, authoritative_receipt_matched: receiptMatches,
        submit_effect_id: dispatch?.id ?? null, next_action: 'reconcile_only' });
      if (!receiptMatches) {
        this.event('candidate', { candidate_id: candidateId, status: 'inconclusive', authoritative: false,
          reason: 'late resolver result lacks a matching pre-deadline canonical submit dispatch and authoritative oracle receipt' });
        return this.finish('resource_exhausted', 'run deadline exceeded; late resolver result was not accepted');
      }
      // A confirmed effect is the source of truth after dispatch; do not let a resolver callback invent its outcome.
      const oracle = receipt;
      const completed = oracle?.completed === true;
      if (dispatch!.businessOutcome === 'accepted' || dispatch!.businessOutcome === 'duplicate') {
        if (completed) {
          safe = { ...safe, status: 'accepted', authoritative: true, completed: true, detail: 'accepted by the authoritative pre-deadline submit; reconciled after deadline' };
        } else if (oracle?.completed === false && Number.isSafeInteger(oracle.correctFlagCount) && Number.isSafeInteger(oracle.totalFlagCount)) {
          safe = { ...safe, status: 'partial', authoritative: true, completed: false,
            correct_flag_count: Number(oracle.correctFlagCount), total_flag_count: Number(oracle.totalFlagCount),
            detail: 'partial acceptance from the authoritative pre-deadline submit; reconciled after deadline' };
        } else return this.finish('resource_exhausted', 'late submit receipt lacks authoritative completion state');
      } else {
        return this.finish('resource_exhausted', 'late submit receipt was rejected; run stopped for reconciliation only');
      }
    }
    this.event('candidate', { status: safe.status, authoritative: safe.authoritative, candidate_id: candidateId,
      generation, candidate: { ...candidate, experiment_id: this.active }, resolution: safe });
    if (resolverLate) {
      if (safe.status === 'accepted' && safe.authoritative && safe.completed === true) return this.finish('solved', safe.detail, candidate);
      if (safe.status === 'partial' && safe.authoritative) return this.finish('partial', safe.detail, candidate);
      return this.finish('resource_exhausted', 'run deadline exceeded; resolver outcome retained for reconciliation only');
    }
    if (safe.status === 'accepted' && safe.authoritative && safe.completed === true) {
      return this.finish('solved', safe.detail, candidate);
    }
    if (safe.status === 'partial' && safe.authoritative) this.acceptedPartial = true;
    if (safe.status === 'accepted' && safe.authoritative) this.acceptedPartial = true;
    this.observation = { tool: 'candidate.resolve', raw: safe.detail, outcome: safe.status === 'rejected' ? 'failure' : 'success',
      failure_code: null, artifact_refs: safe.evidence_refs ?? [], complete: safe.authoritative };
    this.phase = 'solver'; this.strategyReason = null;
    // Oracle feedback belongs to this Solver route. It is evidence for diagnosis and does not retire the challenge.
    this.event('candidate', { status: 'continuation', candidate_hash: candidate.value_ref.hash,
      observation: this.observation, next_action: 'diagnose candidate evidence and continue the current Solver route' });
    return null;
  }
  private async closeFailedExperiment(): Promise<void> {
    if (!this.active) return;
    const experiment = this.hypotheses.experiment(this.active);
    if (experiment.status !== 'running' || !experiment.events.length || experiment.events.at(-1)?.outcome !== 'failure') return;
    const completed = this.hypotheses.completeExperiment(this.active);
    try { await this.hypotheses.conclude(this.active, { verdict: 'inconclusive', rationale: 'local tool execution failed; no mechanism refutation', evidence_refs: completed.events.at(-1)!.artifact_refs }); }
    catch (error) { if (!(error instanceof SolverFailure) || !['scope_denied', 'resource_exhausted'].includes(error.code)) throw error; }
    this.event('experiment.completed', { experiment: this.hypotheses.experiment(this.active) });
    this.assessmentWindow(false);
  }
  private async retireExperiment(reason: string): Promise<void> {
    await this.closeFailedExperiment();
    if (!this.active || this.hypotheses.experiment(this.active).status !== 'running') return;
    // Calls are awaited sequentially. No model decision can abandon a currently executing local job.
    if (this.runningJob) throw new SolverFailure('blocked_data', 'cannot abandon experiment with an in-flight job');
    const abandoned = this.hypotheses.abandonExperiment(this.active, reason);
    this.event('experiment.abandoned', { experiment: abandoned, no_in_flight_job: true });
  }
  private assessmentWindow(requestStrategy = true): boolean {
    const window = this.hypotheses.finishWindow();
    this.event('progress.window', { window });
    if (window.request === 'strategy') {
      this.windowStrategyPending = true;
      if (requestStrategy) { this.requestStrategy('two completed windows without semantic progress'); return true; }
    }
    return false;
  }
  private requestStrategy(reason: string): void {
    if (!this.binding.responsibility_set.includes('strategy')) throw new SolverFailure('blocked_data', 'task has no Strategy capability; requires host Strategy handoff');
    this.phase = 'strategy'; this.strategyReason = reason;
    this.event('strategy.request', { reason, experiment_id: this.active, evidence_refs: this.observation?.artifact_refs ?? [] });
  }
  private admitRepair(kind: 'tool' | 'representation' | 'auxiliary', details: Record<string, unknown>): boolean {
    if (this.active) {
      const experiment = this.hypotheses.experiment(this.active);
      if (experiment.activities.filter(activity => activity.kind === 'repair').length >= experiment.plan.repair_budget) return false;
      this.hypotheses.recordActivity(this.active, { kind: 'repair', repair_kind: kind, reason: `${kind} correction using retained raw failure` });
    } else if (this.preExperimentRepairs++ >= 1) return false;
    this.event('repair', { experiment_id: this.active, kind, ...details }); return true;
  }
  private admitPendingRepair(correctedInput: unknown): boolean {
    const failed = this.pendingFailure;
    if (!failed) throw new SolverFailure('output_parse_error', 'missing original failed-step receipt');
    if (failed.repair_admitted) return true;
    const accepted = this.admitRepair('tool', { failure_code: failed.failure_code, failed_receipt_id: failed.receipt_id,
      raw_refs: failed.raw_refs, original_input: failed.input, corrected_input: correctedInput });
    if (accepted) failed.repair_admitted = true;
    return accepted;
  }
  private isBoundedParameterRepair(original: unknown, corrected: z.infer<typeof commandInput>): boolean {
    const parsed = commandInput.safeParse(original); if (!parsed.success) return false;
    const before = parsed.data, a = before.command, b = corrected.command;
    if (a.length < 2 || b.length < 2 || a[0] !== b[0] || a[1] !== b[1] || a[1]!.startsWith('-') || !same({ ...before, command: [] }, { ...corrected, command: [] })) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    let offset = 2; while (offset < Math.min(a.length, b.length) && a[offset] === b[offset]) offset++;
    const oldPart = a[offset], newPart = b[offset];
    if (oldPart === undefined && newPart === undefined) return false;
    if ((oldPart?.startsWith('-') ?? false) || (newPart?.startsWith('-') ?? false) || Buffer.byteLength(oldPart ?? '') + Buffer.byteLength(newPart ?? '') > (this.options.maxPatchBytes ?? 512)) return false;
    return a.length === b.length ? same(a.slice(offset + 1), b.slice(offset + 1))
      : a.length < b.length ? same(a.slice(offset), b.slice(offset + 1)) : same(a.slice(offset + 1), b.slice(offset));
  }
  private async errorObservation(tool: string, failure: SolverFailure): Promise<SolverObservation> {
    const ref = this.keep(await this.options.artifacts.publish(Buffer.from(failure.message)));
    return { tool, raw: failure.message, outcome: 'failure', failure_code: failure.code, artifact_refs: [ref], complete: true };
  }
  private keep(ref: { hash: string; size: number; path: string }): ImmutableArtifactRef {
    const parsed = ImmutableArtifactRefSchema.parse(ref); this.options.state.addCanonicalArtifact(parsed);
    this.inputRefs.push(parsed); return parsed;
  }
  private checkAuthority(): void {
    try {
      const { expires_at: _, ...current } = this.options.registry.binding(this.options.sessionId);
      const { expires_at: __, ...original } = this.binding;
      if (!same(current, original)) throw new Error('bound authority changed');
    }
    catch (error) { throw new SolverFailure('scope_denied', String(error)); }
  }
  private checkBudget(checkSteps = true): void {
    if (Date.now() >= this.deadline || (this.active && Date.now() >= this.experimentDeadline(this.active))) throw new SolverFailure('resource_exhausted', 'wall deadline exceeded');
    if (checkSteps && this.used.steps >= this.options.budget.maxSteps) throw new SolverFailure('resource_exhausted', 'step budget exhausted');
    if (this.used.tokens > this.options.budget.maxObservableTokens) throw new SolverFailure('resource_exhausted', 'observable token budget exhausted');
  }
  private remainingBudget(): { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number } {
    return { wallClockMs: Math.max(0, Math.min(this.deadline, this.active ? this.experimentDeadline(this.active) : Infinity) - Date.now()),
      maxSteps: Math.max(0, this.options.budget.maxSteps - this.used.steps),
      maxToolJobs: Math.max(0, this.options.budget.maxToolJobs - this.used.tools),
      maxObservableTokens: Math.max(0, this.options.budget.maxObservableTokens - this.used.tokens) };
  }
  private event(activity: Activity, data: Record<string, unknown>): void {
    this.options.state.appendEvent(EventDeltaSchema.parse({ kind: 'solver.activity', runId: this.binding.run_id,
      challengeId: this.binding.challenge_id, taskId: this.binding.task_id, sessionId: this.binding.session_id,
      attemptId: this.binding.attempt_id, activity, data, at: new Date().toISOString() }));
  }
  private finish(status: SolverResult['status'], reason: string, candidate?: SolverResult['candidate'], failureCode?: SolverFailureCode): SolverResult {
    const disposition = solverDisposition(status, failureCode, Date.now() >= this.deadline || !!(this.active && Date.now() >= this.experimentDeadline(this.active)));
    const nextAction = status === 'candidate_only' ? 'Engineer and independent Verifier' : status === 'resource_exhausted' ? 'release low-value resources and reprioritize' : reason;
    this.options.state.saveCheckpoint({ runId: this.binding.run_id, challengeId: this.binding.challenge_id, target: this.options.challenge.description,
      nextAction, stage: 'solving', publishedRefs: this.inputRefs, rejectedFingerprints: this.active && this.hypotheses.hypothesis(this.hypotheses.experiment(this.active).plan.hypothesis_id).state === 'rejected' ? [this.hypotheses.experiment(this.active).fingerprint] : [], activeJobCursors: {},
      usedBudget: { wallClockMs: Date.now() - this.started, maxSteps: this.used.steps, maxToolJobs: this.used.tools, maxObservableTokens: this.used.tokens } });
    this.event('checkpoint', { status, ...disposition, reason, next_action: nextAction, usage: this.used });
    return { status, ...disposition, reason, ...(candidate ? { candidate } : {}) };
  }
}
