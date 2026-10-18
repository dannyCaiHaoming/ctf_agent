import { EventDeltaSchema, type EventDelta } from '@ctf/contracts';

export type Metric<T> =
  | { state: 'observed'; value: T }
  | { state: 'not_observed'; reason: string }
  | { state: 'unavailable'; reason: string };

export interface PhaseUsage {
  calls: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  provenance: 'provider_reported' | 'deterministic' | 'mixed';
}

export interface CandidateLifecycleMetrics {
  candidateToEngineeringStartMs: Metric<number[]>;
  engineeringMs: Metric<number[]>;
  verificationMs: Metric<number[]>;
  verificationToOracleStartMs: Metric<number[]>;
  oracleSubmitMs: Metric<number[]>;
  candidateToAcceptanceMs: Metric<number[]>;
}

export interface M1RunMetrics {
  runId: string;
  complete: boolean;
  timeToFirstExperimentMs: Metric<number>;
  toolActions: Metric<{ count: number; maximumConsecutive: number }>;
  toolErrors: Metric<number>;
  repairAttempts: Metric<number>;
  repairSuccesses: Metric<number>;
  strategyFallbacks: Metric<number>;
  modelUsageByPhase: Record<string, Metric<PhaseUsage>>;
  toolWaitMs: Metric<{ total: number; byTool: Record<string, number> }>;
  responsibilitySwitchMs: Metric<number[]>;
  resultToNextDriverMs: Metric<number[]>;
  blockerCounts: Metric<Record<string, number>>;
  blockerDurationMs: Metric<Record<string, number>>;
  candidateLifecycleMs: Metric<CandidateLifecycleMetrics>;
  artifactPublishAndHashIo: Metric<never>;
  compactionRecovery: Metric<never>;
}

/** Deterministic projection over the canonical event ledger. It never fills missing sources with zero. */
export function aggregateM1RunMetrics(source: readonly EventDelta[]): M1RunMetrics {
  const events = source.map(event => EventDeltaSchema.parse(event));
  const runIds = [...new Set(events.map(event => event.runId))];
  if (runIds.length !== 1) throw new Error('metrics require exactly one canonical run');
  const runId = runIds[0]!;
  const activity = events.filter((event): event is Extract<EventDelta, { kind: 'solver.activity' }> => event.kind === 'solver.activity');
  const started = activity.find(event => event.activity === 'started');
  if (!started) throw new Error('canonical run has no solver start event');
  const complete = activity.some(event => event.activity === 'checkpoint');
  const terminalReason = complete ? 'completed run contains no such event' : 'run is incomplete; absence cannot be distinguished from not-yet-recorded';
  const experiment = activity.find(event => event.activity === 'experiment.started');
  const timeToFirstExperimentMs: Metric<number> = experiment
    ? observed(elapsed(started.at, experiment.at))
    : complete ? notObserved('run completed without a valid experiment') : unavailable(terminalReason);

  const toolStarts = activity.filter(event => event.activity === 'tool.started');
  const toolResults = activity.filter(event => event.activity === 'tool.result');
  let run = 0; let maximumConsecutive = 0;
  for (const event of activity) {
    if (event.activity === 'tool.started') { run++; maximumConsecutive = Math.max(maximumConsecutive, run); }
    else if (event.activity === 'hypothesis.conclusion' || event.activity === 'strategy.switch' || event.activity === 'candidate') run = 0;
  }
  const toolActions: Metric<{ count: number; maximumConsecutive: number }> = toolStarts.length || complete ? observed({ count: toolStarts.length, maximumConsecutive }) : unavailable(terminalReason);
  const failedTools = toolResults.filter(event => record(event.data.observation).outcome === 'failure').length;
  const toolErrors: Metric<number> = toolResults.length || complete ? observed(failedTools) : unavailable(terminalReason);
  const repairAttempts = activity.filter(event => event.activity === 'repair').length;
  const repairMetric: Metric<number> = repairAttempts || complete ? observed(repairAttempts) : unavailable(terminalReason);

  const strategyFallbacks = activity.filter(event => event.activity === 'strategy.switch').length;
  const strategyMetric: Metric<number> = strategyFallbacks || complete ? observed(strategyFallbacks) : unavailable(terminalReason);
  const modelUsageByPhase = aggregateUsage(activity, complete);
  const toolWaitMs = aggregateToolWait(toolStarts, toolResults, complete);
  const responsibilitySwitchMs = aggregateSwitchWait(activity, complete);
  const resultToNextDriverMs = aggregateObservationDelay(activity, complete);
  const candidateLifecycleMs = aggregateCandidateLifecycle(activity, complete);
  const blockerCounts: Record<string, number> = {};
  const blockerDurationMs: Record<string, number> = {};
  const toolStartById = new Map(toolStarts.map(event => [String(event.data.receipt_id), event]));
  for (const event of toolResults) {
    const observation = record(event.data.observation);
    if (observation.outcome === 'failure') {
      const code = typeof observation.failure_code === 'string' ? observation.failure_code : 'unknown';
      blockerCounts[code] = (blockerCounts[code] ?? 0) + 1;
      const start = toolStartById.get(String(event.data.receipt_id));
      if (start) blockerDurationMs[code] = (blockerDurationMs[code] ?? 0) + elapsed(start.at, event.at);
    }
  }
  for (const event of activity) if (event.activity === 'driver.call' && typeof event.data.failure === 'string') {
    blockerCounts.driver_failure = (blockerCounts.driver_failure ?? 0) + 1;
    const began = event.data.began_at; const ended = event.data.ended_at;
    if (typeof began === 'string' && typeof ended === 'string') blockerDurationMs.driver_failure = (blockerDurationMs.driver_failure ?? 0) + elapsed(began, ended);
  }
  const blockerMetric: Metric<Record<string, number>> = Object.keys(blockerCounts).length || complete ? observed(blockerCounts) : unavailable(terminalReason);
  const blockerDurationMetric: Metric<Record<string, number>> = Object.keys(blockerDurationMs).length || complete
    ? observed(blockerDurationMs) : unavailable(terminalReason);

  return { runId, complete, timeToFirstExperimentMs, toolActions, toolErrors, repairAttempts: repairMetric,
    repairSuccesses: unavailable('repair events do not yet bind an attempted repair to its repaired tool receipt'),
    strategyFallbacks: strategyMetric, modelUsageByPhase, toolWaitMs, responsibilitySwitchMs, resultToNextDriverMs,
    blockerCounts: blockerMetric, blockerDurationMs: blockerDurationMetric,
    candidateLifecycleMs,
    artifactPublishAndHashIo: unavailable('artifact publication events do not record elapsed publish/hash time or IO bytes'),
    compactionRecovery: unavailable('canonical compaction recovery events are not emitted') };
}

function aggregateSwitchWait(activity: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], complete: boolean): Metric<number[]> {
  const pending: string[] = []; const durations: number[] = [];
  for (const event of activity) {
    if (event.activity === 'strategy.request') pending.push(event.at);
    if (event.activity === 'strategy.switch') {
      const began = pending.shift();
      if (!began) return unavailable('strategy switch has no canonical request event');
      durations.push(elapsed(began, event.at));
    }
  }
  if (pending.length) return unavailable('strategy request has not yet reached a route switch');
  if (!durations.length && !complete) return unavailable('no completed responsibility switch is available yet');
  return durations.length ? observed(durations) : notObserved('run completed without a Strategy route switch');
}

function aggregateCandidateLifecycle(activity: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], complete: boolean): Metric<CandidateLifecycleMetrics> {
  const produced = new Map<string, string>();
  const starts = new Map<string, string>();
  const verificationEnds = new Map<string, string>();
  const candidateToEngineering: number[] = []; const engineering: number[] = []; const verification: number[] = [];
  const verificationToOracle: number[] = []; const oracleSubmit: number[] = []; const candidateToAcceptance: number[] = [];
  const incomplete = new Set<string>();
  for (const event of activity) {
    if (event.activity === 'candidate.stage') {
      const id = String(event.data.candidate_id); const stage = String(event.data.stage); const state = String(event.data.state);
      if (stage === 'candidate' && state === 'produced') { produced.set(id, event.at); continue; }
      if (!['engineering', 'verification', 'oracle_submit'].includes(stage)) continue;
      const key = `${id}/${stage}`;
      if (state === 'started') {
        starts.set(key, event.at);
        if (stage === 'engineering') {
          const at = produced.get(id); if (at) candidateToEngineering.push(elapsed(at, event.at));
        }
        if (stage === 'oracle_submit') {
          const at = verificationEnds.get(id); if (at) verificationToOracle.push(elapsed(at, event.at));
        }
      } else if (state === 'completed') {
        const at = starts.get(key);
        if (!at) { incomplete.add(stage); continue; }
        const duration = elapsed(at, event.at);
        if (stage === 'engineering') engineering.push(duration);
        if (stage === 'verification') { verification.push(duration); verificationEnds.set(id, event.at); }
        if (stage === 'oracle_submit') oracleSubmit.push(duration);
        starts.delete(key);
      } else if (state === 'failed') { starts.delete(key); incomplete.add(stage); }
    }
    if (event.activity === 'candidate' && (event.data.status === 'accepted' || event.data.status === 'partial') && event.data.authoritative === true) {
      const id = String(event.data.candidate_id); const at = produced.get(id); if (at) candidateToAcceptance.push(elapsed(at, event.at));
    }
  }
  for (const key of starts.keys()) incomplete.add(key.slice(key.lastIndexOf('/') + 1));
  if (!produced.size && !complete) return unavailable('no complete candidate lifecycle is available in the incomplete run');
  const metric = (values: number[], stage: string): Metric<number[]> => incomplete.has(stage) ? unavailable(`${stage} lifecycle has no successful terminal event`)
    : values.length ? observed(values) : complete ? notObserved(`no ${stage} lifecycle event occurred`) : unavailable(`no ${stage} lifecycle result is available yet`);
  return observed({ candidateToEngineeringStartMs: metric(candidateToEngineering, 'engineering'), engineeringMs: metric(engineering, 'engineering'),
    verificationMs: metric(verification, 'verification'), verificationToOracleStartMs: metric(verificationToOracle, 'oracle_submit'),
    oracleSubmitMs: metric(oracleSubmit, 'oracle_submit'), candidateToAcceptanceMs: metric(candidateToAcceptance, 'oracle_submit') });
}

function aggregateUsage(activity: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], complete: boolean): Record<string, Metric<PhaseUsage>> {
  const calls = activity.filter(event => event.activity === 'driver.call');
  const phases = new Set(calls.map(event => typeof event.data.phase === 'string' ? event.data.phase : 'unknown'));
  const result: Record<string, Metric<PhaseUsage>> = {};
  for (const phase of phases) {
    const group = calls.filter(event => (typeof event.data.phase === 'string' ? event.data.phase : 'unknown') === phase);
    const usage = group.map(event => record(event.data.usage));
    if (usage.some(value => value.provenance !== 'deterministic' && value.provenance !== 'provider_reported' ||
      !Number.isSafeInteger(value.input_tokens) || !Number.isSafeInteger(value.output_tokens) || !Number.isSafeInteger(value.model_calls))) {
      result[phase] = unavailable('one or more canonical provider usage records are missing or malformed'); continue;
    }
    const provenances = new Set(usage.map(value => value.provenance as PhaseUsage['provenance']));
    result[phase] = observed({ calls: group.length, modelCalls: usage.reduce((sum, value) => sum + Number(value.model_calls), 0),
      inputTokens: usage.reduce((sum, value) => sum + Number(value.input_tokens), 0),
      outputTokens: usage.reduce((sum, value) => sum + Number(value.output_tokens), 0),
      provenance: provenances.size > 1 ? 'mixed' : [...provenances][0]! });
  }
  if (!calls.length) result.all = complete ? notObserved('run completed without a model driver call') : unavailable('run has no recorded model driver call yet');
  return result;
}

function aggregateToolWait(starts: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], results: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], complete: boolean): Metric<{ total: number; byTool: Record<string, number> }> {
  const startsById = new Map(starts.map(event => [String(event.data.receipt_id), event]));
  const waits: Record<string, number> = {};
  let total = 0;
  for (const result of results) {
    const start = startsById.get(String(result.data.receipt_id));
    if (!start) return unavailable('tool result has no canonical start event');
    const ms = elapsed(start.at, result.at); const tool = typeof result.data.tool === 'string' ? result.data.tool : 'unknown';
    total += ms; waits[tool] = (waits[tool] ?? 0) + ms;
  }
  if (results.length !== starts.length) return complete ? unavailable('completed run contains a tool action without a result') : unavailable('tool actions are still in flight');
  return observed({ total, byTool: waits });
}

function aggregateObservationDelay(activity: readonly Extract<EventDelta, { kind: 'solver.activity' }>[], complete: boolean): Metric<number[]> {
  const delays: number[] = [];
  for (let i = 0; i < activity.length; i++) {
    if (activity[i]!.activity !== 'tool.result') continue;
    const next = activity.slice(i + 1).find(event => event.activity === 'driver.call');
    if (!next) {
      if (!complete) return unavailable('observation has not yet been followed by a driver call');
      continue;
    }
    delays.push(elapsed(activity[i]!.at, next.at));
  }
  return delays.length ? observed(delays) : complete ? notObserved('no tool observation was followed by a driver call') : unavailable('no observation latency is available yet');
}

function elapsed(start: string, end: string): number {
  const value = Date.parse(end) - Date.parse(start);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('canonical event timestamps are invalid or out of order');
  return value;
}
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function observed<T>(value: T): Metric<T> { return { state: 'observed', value }; }
function notObserved<T>(reason: string): Metric<T> { return { state: 'not_observed', reason }; }
function unavailable<T>(reason: string): Metric<T> { return { state: 'unavailable', reason }; }
