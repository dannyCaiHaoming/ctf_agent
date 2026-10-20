import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { z } from 'zod';
import { EventDeltaSchema, ExperimentSchema, HypothesisSchema, ImmutableArtifactRefSchema, RuntimeExperimentEventSchema,
  type Budget, type EventDelta, type ImmutableArtifactRef } from '@ctf/contracts';
import type { ArtifactStore } from '@ctf/artifacts';
import type { ToolRuntime } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { ModelDataGateway } from '@ctf/policy';
import { HypothesisManager, experimentFingerprint, type CandidateResolverInput, type ExperimentRecord, type ResponsibilityRegistry } from '@ctf/supervisor';

type Activity = Extract<EventDelta, { kind: 'solver.activity' }>['activity'];
const pathInput = z.object({ path: z.string().min(1) }).strict();
const commandInput = z.object({ command: z.array(z.string().min(1)).min(2), timeout_ms: z.number().int().positive().max(15000).optional() }).strict();
const proposalInput = z.object({ claim: z.string().trim().min(1), falsifier: z.string().trim().min(1),
  prediction: z.enum(['expression_evaluates', 'other']), command: commandInput.shape.command,
  route_reason: z.string().trim().min(1).optional() }).strict();
const conclusionInput = z.object({ verdict: z.enum(['rejected', 'inconclusive']), rationale: z.string().trim().min(1) }).strict();

function isArithmeticExpression(value: string): boolean {
  if (!/^[0-9\s.+*/%()\-]+$/.test(value) || !/[0-9]/.test(value)) return false;
  // Compile only: let Node validate grouping/operators without evaluating input
  // or growing a second expression parser in the product control layer.
  try { new Script(`(${value}\n)`); return true; } catch { return false; }
}

/** Thin local-task control: OpenCode, rather than this class, owns the model/tool loop. */
export class OpenCodeTask {
  private started = Date.now();
  private used = { steps: 0, tools: 0, tokens: 0, modelCalls: 0 };
  private refs = new Map<string, ImmutableArtifactRef>();
  private usage = new Map<string, { input: number; output: number }>();
  private failures = new Map<string, { stderr: string; ref: ImmutableArtifactRef; delivered: boolean }>();
  private success?: { experiment: ExperimentRecord; refs: ImmutableArtifactRef[] };
  private gateway = new ModelDataGateway();
  private accepted = false;
  private identity: ReturnType<ResponsibilityRegistry['binding']>;
  private candidate?: { value_ref: ImmutableArtifactRef; evidence_refs: ImmutableArtifactRef[] };
  private hypotheses?: HypothesisManager;
  private proposal?: z.infer<typeof proposalInput> & { id: string; receipt_id: string };
  private semanticExperiment?: string;
  private hypothesisSnapshotRef?: ImmutableArtifactRef;
  private outputs = new Map<string, { result: Record<string, unknown>; ref: ImmutableArtifactRef; delivered: boolean }>();

  constructor(private readonly input: {
    state: StateStore; artifacts: ArtifactStore; runtime: ToolRuntime; registry: ResponsibilityRegistry;
    sessionID: string; budget: Budget; deadline: string; controller: AbortController; secrets: string[]; trajectory?: 't1' | 't2';
    resolveCandidate: (request: CandidateResolverInput) => Promise<import('@ctf/supervisor').CandidateResolution>;
  }) {
    this.identity = input.registry.binding(input.sessionID);
    if (input.trajectory === 't2') this.hypotheses = new HypothesisManager({
      verifyArtifact: async ref => { await input.artifacts.verify(ref); return true; },
      assertCurrent: () => this.assertCurrent(),
      resolveRuntimeEvent: async id => {
        const matches = input.state.events().filter(event => event.kind === 'solver.activity' &&
          event.runId === this.binding.run_id && event.challengeId === this.binding.challenge_id &&
          event.taskId === this.binding.task_id && event.sessionId === this.binding.session_id &&
          event.activity === 'tool.result' && event.data.receipt_id === id && event.data.tool === 'job.run');
        if (matches.length !== 1 || matches[0]!.kind !== 'solver.activity') throw new Error('canonical runtime receipt missing or ambiguous');
        return matches[0]!.data.receipt;
      },
      validateProgress: async (claim, experiment) => {
        const receipt = experiment.events.at(-1)!;
        const observed = this.outputs.get(receipt.id);
        if (!observed?.delivered) throw new Error('complete raw output must be delivered in actual model input');
        const raw = (await input.artifacts.read(observed.ref)).toString('utf8');
        let parsed: { mode?: string; value?: string }; try { parsed = JSON.parse(raw); } catch { throw new Error('not a literal discriminator'); }
        const command = (experiment.plan.procedure[0]!.input as { command: string[] }).command;
        if (claim.kind !== 'evidence' || claim.verdict !== 'rejected' || this.proposal?.prediction !== 'expression_evaluates' ||
          parsed.mode !== 'literal' || typeof parsed.value !== 'string' || command.length !== 3 || command[2] !== parsed.value ||
          !isArithmeticExpression(parsed.value)) {
          throw new Error('declared prediction is not refuted by this literal discriminator');
        }
        return { substantiation: 'The actual successful receipt preserves the tested arithmetic expression as literal data, contradicting the model-declared evaluation prediction.' };
      }
    });
  }

  private get binding() { return this.identity; }
  event(activity: Activity, data: Record<string, unknown>) {
    const b = this.binding;
    this.input.state.appendEvent(EventDeltaSchema.parse({ kind: 'solver.activity', runId: b.run_id, challengeId: b.challenge_id,
      taskId: b.task_id, sessionId: b.session_id, attemptId: b.attempt_id, activity, data, at: new Date().toISOString() }));
  }
  private assertCurrent() {
    this.input.controller.signal.throwIfAborted();
    this.input.registry.binding(this.input.sessionID);
    if (Date.now() >= Date.parse(this.input.deadline)) throw new Error('resource_exhausted: wall clock deadline');
    if (Date.parse(this.binding.expires_at) <= Date.now()) throw new Error('resource_exhausted: session lease expired');
  }
  private admit(toolJob = false) {
    this.assertCurrent();
    if (this.used.steps >= this.input.budget.maxSteps || this.used.tokens >= this.input.budget.maxObservableTokens ||
      (toolJob && this.used.tools >= this.input.budget.maxToolJobs)) {
      const reason = new Error('resource_exhausted: shared run budget'); this.input.controller.abort(reason); throw reason;
    }
    this.used.steps++; if (toolJob) this.used.tools++;
  }
  private remaining(): Budget {
    return { wallClockMs: Math.max(0, Date.parse(this.input.deadline) - Date.now()),
      maxSteps: Math.max(0, this.input.budget.maxSteps - this.used.steps),
      maxToolJobs: Math.max(0, this.input.budget.maxToolJobs - this.used.tools),
      maxObservableTokens: Math.max(0, this.input.budget.maxObservableTokens - this.used.tokens) };
  }
  private async publish(bytes: Buffer) {
    const ref = ImmutableArtifactRefSchema.parse(await this.input.artifacts.publish(bytes));
    this.input.state.addCanonicalArtifact(ref); this.refs.set(ref.hash, ref); return ref;
  }
  private checkModelData(value: unknown) {
    const serialized = JSON.stringify(value);
    if (this.input.secrets.some(secret => secret && serialized.includes(secret))) throw new Error('control secret blocked from provider input');
    this.gateway.request({ dataClass: 'allowed_excerpt', value, operation: 'opencode.provider.input' });
  }
  async control(sessionID: string, operation: string, value: unknown): Promise<unknown> {
    if (sessionID !== this.input.sessionID) throw new Error('unbound OpenCode session');
    this.assertCurrent();
    if (operation === 'authorize') return { authorized: true };
    if (operation === 'model.system') { this.checkModelData(value); return { checked: true }; }
    if (operation === 'model.input') {
      this.checkModelData(value);
      const messages = value as Array<{ info: Record<string, any>; parts: Array<Record<string, any>> }>;
      if (this.hypotheses && messages.some(message => message.info.sessionID !== sessionID)) throw new Error('foreign model-input session');
      for (const message of messages) {
        this.observeUsage(message.info);
        for (const part of message.parts) {
          const raw = part.type === 'tool' && part.state?.status === 'completed' ? part.state.output
            : part.type === 'text' ? part.text : undefined;
          if (typeof raw !== 'string') continue;
          let output: Record<string, any>; try { output = JSON.parse(raw); } catch { continue; }
          const observed = this.outputs.get(output.receipt_id);
          if (this.hypotheses && observed && !observed.delivered && part.type === 'tool' &&
            observed.result.complete === true && Object.entries(observed.result).every(([key, expected]) => output[key] === expected)) {
            observed.delivered = true;
            this.event('tool.chunk', { receipt_id: output.receipt_id, stream: 'stdout', delivered_to_model: true, artifact_ref: observed.ref });
          }
          const failure = this.failures.get(output.receipt_id);
          if (failure && !failure.delivered && output.stderr === failure.stderr) {
            failure.delivered = true;
            this.event('tool.chunk', { receipt_id: output.receipt_id, stream: 'stderr', delivered_to_model: true, artifact_ref: failure.ref });
          }
        }
      }
      return { checked: true };
    }
    if (operation === 'model.call') {
      this.admit(); this.used.modelCalls++;
      this.event('driver.call', { engine: 'opencode', ...value as object, call: this.used.modelCalls, usage: null });
      return { maxOutputTokens: Math.max(1, Math.min(4000, this.remaining().maxObservableTokens)) };
    }
    throw new Error('unsupported host control operation');
  }
  observeUsage(info: Record<string, any>) {
    if (info.role !== 'assistant' || !info.time?.completed || info.error || !info.tokens) return;
    const tokens = info.tokens;
    if (![tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write].every(Number.isFinite)) return;
    if (tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write <= 0) return;
    this.usage.set(String(info.id), { input: tokens.input + tokens.cache.read + tokens.cache.write, output: tokens.output + tokens.reasoning });
    this.used.tokens = [...this.usage.values()].reduce((sum, item) => sum + item.input + item.output, 0);
  }
  private async workspacePath(path: string) {
    if (isAbsolute(path) || path.split(/[\\/]/).some(part => ['..', '.opencode', '.m1-verification-replay'].includes(part))) throw new Error('scope_denied: workspace-relative material path required');
    const root = await realpath(this.input.runtime.workspace(this.binding.task_id).path);
    const actual = await realpath(resolve(root, path));
    if (actual !== root && !actual.startsWith(root + sep)) throw new Error('scope_denied: workspace path escaped through symlink');
    return actual;
  }
  async tool(name: string, args: unknown, preset = false): Promise<unknown> {
    this.admit(name === 'job.run');
    const receiptId = `receipt_${randomUUID()}`;
    try {
      this.checkModelData(args);
      this.event('tool.started', { tool: name, input: args, receipt_id: receiptId, preset });
      if (name === 'job.run') return await this.runJob(commandInput.parse(args), receiptId, preset);
      if (name === 'candidate.register') return await this.registerCandidate(z.object({ value: z.string().min(1) }).strict().parse(args).value);
      const workspace = this.input.runtime.workspace(this.binding.task_id);
      let raw: string;
      if (name === 'hypothesis.propose' && this.hypotheses) {
        const input = proposalInput.parse(args);
        input.command = await this.normalizedCommand(input.command);
        if (this.proposal && (!this.semanticExperiment || !this.hypotheses.experiment(this.semanticExperiment).conclusion)) {
          throw new Error('conclude the prior experiment before replacing its proposal');
        }
        const previous = this.proposal ? this.hypotheses.hypothesis(this.proposal.id) : undefined;
        if (previous?.state === 'rejected' && !input.route_reason) throw new Error('a route change requires the model reason');
        const cost = { wall_ms: Math.max(1, this.remaining().wallClockMs), tokens: this.remaining().maxObservableTokens, remote_units: 0 };
        const hypothesis = this.hypotheses.addHypothesis({ id: `hypothesis_${randomUUID()}`, claim: input.claim, falsifier: input.falsifier,
          preconditions: ['Bound local workspace'], missing_preconditions: [], supporting_refs: [], contradicting_refs: [], alternative_explanations: [],
          minimal_experiment: JSON.stringify(input.command), expected_observation: input.prediction === 'expression_evaluates' ? 'The expression is evaluated rather than returned literally.' : input.claim,
          state_dependencies: { generation: 1 }, required_capabilities: ['job.run'], route_status: 'queued', next_action: 'Execute the declared experiment.', cost, state: 'proposed' });
        this.assertCurrent(); this.hypotheses.setRoutes({ primary: hypothesis.id, counterprobe: null });
        this.proposal = { ...input, id: hypothesis.id, receipt_id: receiptId }; this.semanticExperiment = undefined;
        if (previous?.state === 'rejected') this.event('strategy.switch', { from: previous.id, to: hypothesis.id,
          rationale: input.route_reason, evidence_refs: previous.contradicting_refs, proposal_receipt_id: receiptId });
        raw = JSON.stringify({ hypothesis, prediction: input.prediction, command: input.command, route_reason: input.route_reason });
        await this.saveHypotheses();
      } else if (name === 'hypothesis.conclude' && this.hypotheses) {
        const input = conclusionInput.parse(args);
        if (!this.semanticExperiment) throw new Error('conclusion requires a prior declared experiment');
        const experiment = this.hypotheses.experiment(this.semanticExperiment);
        if (input.verdict === 'rejected' && experiment.status !== 'succeeded') throw new Error('mechanism rejection requires a successful execution');
        const hypothesis = await this.hypotheses.conclude(experiment.plan.id, { ...input, evidence_refs: experiment.events.flatMap(event => event.artifact_refs) });
        await this.saveHypotheses();
        this.event('hypothesis.conclusion', { hypothesis_id: hypothesis.id, experiment_id: experiment.plan.id,
          conclusion: this.hypotheses.experiment(experiment.plan.id).conclusion, hypothesis_snapshot_ref: this.hypothesisSnapshotRef });
        raw = JSON.stringify({ hypothesis });
      } else if (name === 'workspace.list') {
        const input = z.object({ path: z.string().optional() }).strict().parse(args);
        await this.workspacePath(input.path ?? '.'); raw = JSON.stringify(await workspace.list(input.path));
      } else if (name === 'workspace.read' || name === 'workspace.search') {
        const input = (name === 'workspace.search' ? pathInput.extend({ needle: z.string() }) : pathInput).parse(args);
        await this.workspacePath(input.path);
        raw = name === 'workspace.read' ? (await workspace.read(input.path)).toString('utf8')
          : (await workspace.search(input.path, (input as unknown as { needle: string }).needle)).join('\n');
      } else if (name === 'workspace.patch') {
        const input = pathInput.extend({ find: z.string().min(1), replace: z.string() }).parse(args);
        await this.workspacePath(input.path);
        if (![...this.failures.values()].some(failure => failure.delivered)) throw new Error('read the actual failed stderr before attempting a repair');
        const previous = await workspace.read(input.path); const text = previous.toString('utf8');
        if (text.split(input.find).length !== 2 || input.find.trim() === text.trim() || input.find === input.replace ||
          Buffer.byteLength(input.find) + Buffer.byteLength(input.replace) > 4096) throw new Error('patch requires one local changed substring; whole-file replacement is denied');
        const before = await this.publish(previous); this.assertCurrent();
        await workspace.patch(input.path, text.replace(input.find, () => input.replace));
        const after = await this.publish(await workspace.read(input.path));
        raw = JSON.stringify({ path: input.path, before, after });
      } else throw new Error('scope_denied: tool is not exposed');
      this.checkModelData(raw);
      const ref = await this.publish(Buffer.from(raw)); this.assertCurrent();
      const observation = { tool: name, raw, outcome: 'success', failure_code: null, artifact_refs: [ref], complete: true };
      this.event('tool.result', { tool: name, receipt_id: receiptId, observation });
      return { receipt_id: receiptId, ...observation };
    } catch (error) {
      if (this.input.controller.signal.aborted || /resource_exhausted/.test(String(error))) throw error;
      let raw = error instanceof Error ? error.message : String(error);
      for (const secret of this.input.secrets) if (secret) raw = raw.replaceAll(secret, '[redacted]');
      this.event('tool.result', { tool: name, receipt_id: receiptId,
        observation: { tool: name, raw, outcome: 'failure', failure_code: 'tool_invocation_error', artifact_refs: [], complete: true } });
      return { receipt_id: receiptId, error: raw, outcome: 'failure' };
    }
  }
  private async normalizedCommand(command: string[]) {
    if (!['node', process.execPath].includes(command[0]!) || command[1]!.startsWith('-')) throw new Error('scope_denied: only supplied local Node scripts are admitted');
    const root = await realpath(this.input.runtime.workspace(this.binding.task_id).path);
    return ['node', relative(root, await this.workspacePath(command[1]!)).split(sep).join('/'), ...command.slice(2)];
  }
  private async saveHypotheses() {
    if (this.hypotheses) this.hypothesisSnapshotRef = await this.publish(Buffer.from(JSON.stringify(this.hypotheses.exportSnapshot())));
    this.assertCurrent();
  }
  private async runJob(input: z.infer<typeof commandInput>, receiptId: string, preset: boolean) {
    const command = input.command[0] === 'node' ? [process.execPath, ...input.command.slice(1)] : input.command;
    if (command[0] !== process.execPath || command[1]!.startsWith('-')) throw new Error('scope_denied: only supplied local Node scripts are admitted');
    await this.workspacePath(command[1]!); this.assertCurrent();
    const cost = { wall_ms: Math.max(1, this.remaining().wallClockMs), tokens: this.remaining().maxObservableTokens, remote_units: 0 };
    let hypothesis = HypothesisSchema.parse({ id: `hypothesis_${randomUUID()}`, claim: 'The requested local script can execute and produce observable output.',
      preconditions: ['The script exists in the bound workspace'], missing_preconditions: [], supporting_refs: [], contradicting_refs: [],
      alternative_explanations: [], falsifier: 'The actual script execution fails.', minimal_experiment: 'Execute the requested Node script once.',
      expected_observation: 'Actual exit status and raw stdout/stderr.', state_dependencies: { generation: 1 }, required_capabilities: ['job.run'],
      route_status: 'primary', next_action: 'Run the requested script.', cost, state: 'testing' });
    if (this.proposal) {
      const normalized = await this.normalizedCommand(input.command);
      if (JSON.stringify(normalized) !== JSON.stringify(this.proposal.command)) throw new Error('actual command differs from declared proposal');
      hypothesis = HypothesisSchema.parse(this.hypotheses!.hypothesis(this.proposal.id));
    }
    const plan = ExperimentSchema.parse({ id: `experiment_${randomUUID()}`, hypothesis_id: hypothesis.id,
      objective: 'Observe one actual local script execution.', input_refs: [], state_dependencies: { generation: 1 }, parameters: {},
      procedure: [{ id: 'run', tool: 'job.run', input: { command: this.proposal?.command ?? input.command } }], expected_support: this.proposal ? hypothesis.expected_observation : 'Exit code 0.',
      expected_refutation: this.proposal?.falsifier ?? 'A non-zero exit or incomplete execution.', budget: cost, repair_budget: 0,
      stop_condition: 'One terminal execution.', expected_artifacts: ['stdout', 'stderr'] });
    const fingerprint = experimentFingerprint(plan);
    if (this.proposal) { this.hypotheses!.startExperiment(plan); this.semanticExperiment = plan.id; }
    this.event('experiment.started', { hypothesis, experiment: plan, fingerprint, derived_from: receiptId, preset,
      ...(this.proposal ? { proposal_receipt_id: this.proposal.receipt_id, prediction: this.proposal.prediction } : {}) });
    const owner = { sessionId: this.binding.session_id, leaseId: this.binding.lease_id };
    const job = await this.input.runtime.jobStart({ taskId: this.binding.task_id, owner, command,
      timeoutMs: Math.max(1, Math.min(input.timeout_ms ?? 15000, this.remaining().wallClockMs)), maxRetainedBytes: 128 * 1024 });
    const cancel = () => { void this.input.runtime.jobCancel(job.id, 'cancelled', owner).catch(() => undefined); };
    this.input.controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (this.input.runtime.jobStatus(job.id, owner)?.status === 'running') await new Promise<void>((done, reject) => {
        const off = this.input.runtime.onTerminal(event => { if (event.resourceId === job.id) { off(); done(); } });
        if (this.input.runtime.jobStatus(job.id, owner)?.status !== 'running') { off(); done(); }
        if (this.input.controller.signal.aborted) { off(); reject(this.input.controller.signal.reason); }
      });
    } finally { this.input.controller.signal.removeEventListener('abort', cancel); }
    this.assertCurrent();
    const status = this.input.runtime.jobStatus(job.id, owner)!;
    const output = this.input.runtime.jobOutput(job.id, owner);
    this.checkModelData({ stdout: output.stdout.toString('utf8'), stderr: output.stderr.toString('utf8') });
    const stdoutRef = await this.publish(output.stdout); const stderrRef = await this.publish(output.stderr);
    const succeeded = status.status === 'completed' && status.exitCode === 0 && output.complete;
    const raw = (succeeded ? output.stdout : output.stderr).toString('utf8');
    const refs = [succeeded ? stdoutRef : stderrRef];
    const receipt = RuntimeExperimentEventSchema.parse({ id: receiptId, experiment_id: plan.id, fingerprint, step_id: 'run',
      outcome: succeeded ? 'success' : 'failure', failure_code: succeeded ? null : 'tool_invocation_error', artifact_refs: refs });
    let experiment: ExperimentRecord = { plan, fingerprint, status: succeeded ? 'succeeded' : 'failed', events: [receipt],
      activities: [], redispatch_reason: null, conclusion: null };
    const observation = { tool: 'job.run', raw, outcome: receipt.outcome, failure_code: receipt.failure_code, artifact_refs: refs, complete: output.complete };
    this.event('tool.result', { tool: 'job.run', receipt_id: receiptId, receipt, observation, job_id: job.id,
      exit_code: status.exitCode, stdout_ref: stdoutRef, stderr_ref: stderrRef, preset });
    if (this.proposal) {
      await this.hypotheses!.recordRuntimeEvent(receiptId);
      experiment = structuredClone(this.hypotheses!.completeExperiment(plan.id)) as ExperimentRecord;
      await this.saveHypotheses();
    }
    this.event('experiment.completed', { experiment });
    this.success = succeeded ? { experiment, refs } : undefined;
    if (!succeeded && output.complete && output.stderr.length) this.failures.set(receiptId, { stderr: raw, ref: stderrRef, delivered: false });
    const result = { receipt_id: receiptId, exit_code: status.exitCode, stdout: output.stdout.toString('utf8'),
      stderr: output.stderr.toString('utf8'), complete: output.complete };
    if (succeeded) this.outputs.set(receiptId, { result: { ...result }, ref: stdoutRef, delivered: false });
    this.checkModelData(result); return result;
  }
  private async registerCandidate(value: string) {
    if (!this.success) throw new Error('candidate requires a successful complete local job output');
    const output = await this.input.artifacts.read(this.success.refs[0]!);
    const normalized = output.at(-1) === 0x0a ? output.subarray(0, -1) : output;
    if (!normalized.equals(Buffer.from(value))) throw new Error('candidate does not equal actual successful stdout');
    const valueRef = await this.publish(Buffer.from(value)); this.assertCurrent();
    const candidateId = `candidate_${randomUUID()}`;
    this.candidate = { value_ref: valueRef, evidence_refs: this.success.refs };
    const resolved = await this.input.resolveCandidate({ candidateId, runId: this.binding.run_id, challengeId: this.binding.challenge_id,
      taskId: this.binding.task_id, sessionId: this.binding.session_id, generation: 1, value, valueRef, evidenceRefs: this.success.refs,
      experimentId: this.success.experiment.plan.id, experiment: this.success.experiment,
      control: { signal: this.input.controller.signal, deadline: this.input.deadline, remaining: () => this.remaining(),
        admit: stage => { this.admit(stage === 'verification_replay'); return this.remaining(); } },
      stageEvent: (stage, state) => this.event('candidate.stage', { candidate_id: candidateId, stage, state }) });
    this.assertCurrent();
    this.accepted = resolved.authoritative && resolved.status === 'accepted' && resolved.completed === true;
    this.event('candidate', { status: resolved.status, authoritative: resolved.authoritative, generation: 1,
      candidate_id: candidateId, candidate: this.candidate, resolution: resolved });
    return { status: resolved.status, authoritative: resolved.authoritative, completed: resolved.completed, detail: resolved.detail };
  }
  finish(error?: unknown) {
    const exhausted = this.input.controller.signal.aborted || /resource_exhausted/.test(String(error));
    const status = this.accepted ? 'solved' : exhausted ? 'resource_exhausted' : error ? 'blocked' : this.candidate ? 'candidate_only' : 'no_route';
    const outcome = this.accepted ? 'solved' : exhausted || error ? 'inconclusive' : this.candidate ? 'candidate_only' : 'unsolved';
    const solve_state = this.accepted ? 'finished' : exhausted && Date.now() >= Date.parse(this.input.deadline) ? 'deadline_exceeded'
      : exhausted ? 'paused' : error ? 'blocked_runtime' : 'paused';
    let reason = this.accepted ? 'independent replay verified and authoritative local oracle accepted' : error ? String(error) : 'OpenCode session finished without an accepted candidate';
    for (const secret of this.input.secrets) if (secret) reason = reason.replaceAll(secret, '[redacted]');
    const budget = { wallClockMs: Date.now() - this.started, maxSteps: this.used.steps,
      maxToolJobs: this.used.tools, maxObservableTokens: this.used.tokens };
    this.input.state.saveCheckpoint({ runId: this.binding.run_id, challengeId: this.binding.challenge_id, target: 'local-materials',
      nextAction: reason, stage: 'finalizing', publishedRefs: [...this.refs.values()],
      rejectedFingerprints: this.hypotheses?.exportSnapshot().experiments.filter(experiment => experiment.conclusion?.verdict === 'rejected').map(experiment => experiment.fingerprint) ?? [],
      activeJobCursors: {}, usedBudget: budget });
    const available = this.usage.size === this.used.modelCalls && this.used.modelCalls > 0;
    const result = { status, outcome, solve_state, reason, budget, candidate: this.candidate ?? null,
      ...(this.hypothesisSnapshotRef ? { hypothesis_snapshot_ref: this.hypothesisSnapshotRef } : {}),
      provider_usage: { availability: available ? 'observed' : 'unavailable', model_calls: available ? this.usage.size : null,
        admitted_model_calls: this.used.modelCalls,
        input_tokens: available ? [...this.usage.values()].reduce((sum, value) => sum + value.input, 0) : null,
        output_tokens: available ? [...this.usage.values()].reduce((sum, value) => sum + value.output, 0) : null } };
    this.event('checkpoint', result); return result;
  }
}
