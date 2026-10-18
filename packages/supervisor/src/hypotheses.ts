import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HypothesisManagerSnapshotSchema, type HypothesisManagerSnapshot } from '@ctf/state';
import {
  ExperimentSchema, ExperimentActivitySchema, HypothesisSchema, HypothesisConclusionSchema, RedispatchReasonSchema,
  RouteAssignmentSchema, RuntimeExperimentEventSchema, SemanticProgressSchema,
  type Experiment, type ExperimentActivity, type Hypothesis, type RedispatchReason,
  type RouteAssignment, type RuntimeExperimentEvent, type SemanticProgress, type ImmutableArtifactRef, type HypothesisConclusion
} from '@ctf/contracts';
import { freezeData, type DeepReadonly, type VerifyArtifact } from './responsibilities.js';

const Text = z.string().trim().min(1);
const SubstantiationSchema = z.object({ substantiation: Text }).strict();

/** Stable JSON: object key order is irrelevant; array/step order remains meaningful. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('non-JSON canonical value');
  return serialized;
}
export function experimentFingerprint(input: unknown): string {
  const plan = ExperimentSchema.parse(input);
  // Evidence references are an unordered content set; storage paths and step labels are bookkeeping.
  // Any executable path or ordering dependency remains explicit in tool input/parameters.
  const inputIdentities = new Map(plan.input_refs.map(({ hash, size }) => {
    const identity = { hash, size }; return [canonical(identity), identity] as const;
  }));
  return createHash('sha256').update(canonical({
    input_refs: [...inputIdentities.keys()].sort().map(key => inputIdentities.get(key)!),
    state_dependencies: plan.state_dependencies,
    procedure: plan.procedure.map(({ tool, input }) => ({ tool, input })),
    parameters: plan.parameters
  })).digest('hex');
}

export interface ExperimentRecord {
  plan: Experiment;
  fingerprint: string;
  status: 'running' | 'succeeded' | 'failed' | 'abandoned';
  events: RuntimeExperimentEvent[];
  activities: ExperimentActivity[];
  redispatch_reason: RedispatchReason | null;
  conclusion: HypothesisConclusion | null;
}
export interface ProgressRecord { sequence: number; claim: SemanticProgress; substantiation: string }
export interface ProgressAcceptance { accepted: boolean; record: DeepReadonly<ProgressRecord> | null }
export interface ProgressWindow {
  sequence: number;
  completed_experiments: string[];
  progress_sequences: number[];
  consecutive_no_progress: number;
  request: 'strategy' | null;
}
export interface HypothesisManagerOptions {
  verifyArtifact: VerifyArtifact;
  /** Trusted host adapter over actual Tool Runtime receipts. Never delegate this resolver to a model. */
  resolveRuntimeEvent: (eventId: string) => Promise<unknown>;
  /** Trusted host semantic check against immutable artifacts; throw on an unsubstantiated claim. */
  validateProgress: (claim: DeepReadonly<SemanticProgress>, experiment: DeepReadonly<ExperimentRecord>, hypothesis: DeepReadonly<Hypothesis>) => Promise<{ substantiation: string }>;
  /** Optional host authority/deadline guard, called synchronously immediately before semantic state commits. */
  assertCurrent?: () => void;
}

/** Per-challenge M1 foundation. Methods are host APIs; model payloads have no runtime-event authority. */
export class HypothesisManager {
  private readonly hypotheses = new Map<string, DeepReadonly<Hypothesis>>();
  private readonly experiments = new Map<string, DeepReadonly<ExperimentRecord>>();
  private readonly fingerprints = new Map<string, Set<string>>();
  private readonly usedEvents = new Set<string>();
  private readonly progress: Array<DeepReadonly<ProgressRecord>> = [];
  private readonly seenEvidence = new Set<string>();
  private readonly reductions = new Map<string, number>();
  private readonly closedExperiments = new Set<string>();
  private readonly closedProgress = new Set<number>();
  private routes: DeepReadonly<RouteAssignment> = freezeData({ primary: null, counterprobe: null });
  private windows = 0;
  private noProgress = 0;
  private strategyPending = false;
  private strategyHandled = false;
  private criticUsed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private pendingOperations = 0;

  constructor(private readonly options: HypothesisManagerOptions) {}

  /** Host-only full state export; compaction is forbidden during an awaited transition. */
  exportSnapshot(): HypothesisManagerSnapshot {
    if (this.pendingOperations) throw new Error('cannot snapshot an in-flight hypothesis transition');
    return HypothesisManagerSnapshotSchema.parse({ version: 1,
      hypotheses: [...this.hypotheses.values()], experiments: [...this.experiments.values()],
      fingerprints: [...this.fingerprints].map(([fingerprint, reasons]) => ({ fingerprint, reasons: [...reasons] })),
      used_events: [...this.usedEvents], progress: this.progress, seen_evidence: [...this.seenEvidence],
      reductions: [...this.reductions].map(([key, value]) => ({ key, value })),
      closed_experiments: [...this.closedExperiments], closed_progress: [...this.closedProgress], routes: this.routes,
      windows: this.windows, no_progress: this.noProgress, strategy_pending: this.strategyPending,
      strategy_handled: this.strategyHandled, critic_used: this.criticUsed });
  }

  /** Restore only canonical host snapshots, rechecking original receipts and immutable evidence. */
  static async restoreSnapshot(input: unknown, options: HypothesisManagerOptions): Promise<HypothesisManager> {
    const data = HypothesisManagerSnapshotSchema.parse(input);
    const manager = new HypothesisManager(options);
    const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(`invalid hypothesis snapshot: ${message}`); };
    const unique = (values: unknown[], label: string) => assert(new Set(values.map(canonical)).size === values.length, `duplicate ${label}`);
    unique(data.hypotheses.map(value => value.id), 'hypothesis'); unique(data.experiments.map(value => value.plan.id), 'experiment');
    for (const values of [data.used_events, data.seen_evidence, data.closed_experiments, data.closed_progress, data.fingerprints.map(value => value.fingerprint), data.reductions.map(value => value.key)]) unique(values, 'ledger entry');
    for (const hypothesis of data.hypotheses) {
      await manager.verifyRefs([...hypothesis.supporting_refs, ...hypothesis.contradicting_refs]);
      const expected = hypothesis.id === data.routes.primary ? 'primary' : hypothesis.id === data.routes.counterprobe?.hypothesis_id ? 'probe' : null;
      assert(expected ? hypothesis.route_status === expected : !['primary', 'probe'].includes(hypothesis.route_status), 'route mismatch');
      manager.hypotheses.set(hypothesis.id, freezeData(hypothesis));
    }
    for (const id of [data.routes.primary, data.routes.counterprobe?.hypothesis_id]) if (id) assert(manager.hypotheses.has(id), 'unknown route');
    const expectedEvents: string[] = []; const fingerprints = new Map<string, Set<string>>();
    for (const experiment of data.experiments) {
      assert(manager.hypotheses.has(experiment.plan.hypothesis_id), 'experiment hypothesis missing');
      assert(experimentFingerprint(experiment.plan) === experiment.fingerprint, 'fingerprint mismatch');
      const hypothesis = manager.hypothesis(experiment.plan.hypothesis_id);
      for (const [key, value] of Object.entries(hypothesis.state_dependencies)) assert(canonical(value) === canonical(experiment.plan.state_dependencies[key]), 'state dependency mismatch');
      for (const key of ['wall_ms', 'tokens', 'remote_units'] as const) assert(experiment.plan.budget[key] <= hypothesis.cost[key], 'route cost budget mismatch');
      await manager.verifyRefs(experiment.plan.input_refs);
      if (experiment.redispatch_reason) await manager.verifyRefs(experiment.redispatch_reason.basis_refs);
      let successes = 0;
      for (const event of experiment.events) {
        assert(event.experiment_id === experiment.plan.id && event.fingerprint === experiment.fingerprint, 'event binding mismatch');
        assert(experiment.plan.procedure[successes]?.id === event.step_id, 'event ordering mismatch');
        const actual = RuntimeExperimentEventSchema.parse(await options.resolveRuntimeEvent(event.id));
        assert(canonical(actual) === canonical(event), 'canonical runtime event mismatch');
        await manager.verifyRefs(event.artifact_refs); expectedEvents.push(event.id);
        if (event.outcome === 'success') successes++;
      }
      assert(experiment.status !== 'succeeded' || successes === experiment.plan.procedure.length, 'incomplete successful experiment');
      assert(experiment.status !== 'failed' || experiment.events.at(-1)?.outcome === 'failure', 'failed experiment lacks failed receipt');
      if (experiment.conclusion) {
        await manager.verifyRefs(experiment.conclusion.evidence_refs);
        const available = new Set(experiment.events.flatMap(value => value.artifact_refs.map(canonical)));
        for (const ref of experiment.conclusion.evidence_refs) assert(available.has(canonical(ref)), 'conclusion evidence is not from original runtime receipts');
        if (['supported', 'rejected'].includes(experiment.conclusion.verdict)) assert(experiment.status === 'succeeded', 'mechanism conclusion lacks successful experiment');
      }
      assert(experiment.activities.filter(value => value.kind === 'repair').length <= experiment.plan.repair_budget, 'repair allowance exceeded');
      const reasons = fingerprints.get(experiment.fingerprint) ?? new Set<string>();
      if (experiment.redispatch_reason) reasons.add(experiment.redispatch_reason.reason);
      fingerprints.set(experiment.fingerprint, reasons);
      manager.experiments.set(experiment.plan.id, freezeData(experiment));
    }
    unique(expectedEvents, 'runtime receipt');
    assert(canonical([...expectedEvents].sort()) === canonical([...data.used_events].sort()), 'used receipt ledger mismatch');
    assert(canonical([...fingerprints].map(([fingerprint, reasons]) => ({ fingerprint, reasons: [...reasons].sort() })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))) === canonical(data.fingerprints.map(value => ({ ...value, reasons: [...value.reasons].sort() })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))), 'fingerprint history mismatch');
    const seen = new Set<string>(); const reductions = new Map<string, number>();
    for (const [index, record] of data.progress.entries()) {
      assert(record.sequence === index + 1, 'progress sequence gap');
      const experiment = manager.completed(record.claim.experiment_id); const hypothesis = manager.hypothesis(experiment.plan.hypothesis_id);
      await manager.verifyExperimentRefs(experiment, record.claim.evidence_refs);
      // Existing host-substantiated semantics are retained from the canonical snapshot.
      // Restore grants no semantic validator authority for any new claim.
      assert(hypothesis.id === experiment.plan.hypothesis_id, 'progress hypothesis mismatch');
      for (const ref of record.claim.evidence_refs) seen.add(ref.hash);
      if (record.claim.kind === 'search_space_reduction') reductions.set(canonical([record.claim.scope, record.claim.measure]), record.claim.after);
    }
    assert(canonical([...seen].sort()) === canonical([...data.seen_evidence].sort()), 'seen evidence mismatch');
    assert(canonical([...reductions].sort()) === canonical(data.reductions.map(value => [value.key, value.value]).sort()), 'reduction ledger mismatch');
    for (const id of data.closed_experiments) assert(['succeeded', 'failed'].includes(manager.experiment(id).status), 'closed experiment mismatch');
    for (const sequence of data.closed_progress) assert(data.progress.some(value => value.sequence === sequence), 'closed progress missing');
    for (const [key, values] of fingerprints) manager.fingerprints.set(key, values);
    for (const id of data.used_events) manager.usedEvents.add(id);
    manager.progress.push(...data.progress.map(value => freezeData(value)));
    for (const hash of data.seen_evidence) manager.seenEvidence.add(hash);
    for (const [key, value] of reductions) manager.reductions.set(key, value);
    for (const id of data.closed_experiments) manager.closedExperiments.add(id);
    for (const value of data.closed_progress) manager.closedProgress.add(value);
    manager.routes = freezeData(data.routes); manager.windows = data.windows; manager.noProgress = data.no_progress;
    manager.strategyPending = data.strategy_pending; manager.strategyHandled = data.strategy_handled; manager.criticUsed = data.critic_used;
    options.assertCurrent?.();
    return manager;
  }

  addHypothesis(input: unknown): DeepReadonly<Hypothesis> {
    const parsed = HypothesisSchema.parse(input);
    if (this.hypotheses.has(parsed.id)) throw new Error('hypothesis already exists');
    if (parsed.state !== 'proposed' || parsed.route_status !== 'queued') throw new Error('initial hypothesis must be proposed and queued');
    const record = freezeData(parsed); this.hypotheses.set(parsed.id, record); return record;
  }
  hypothesis(id: string): DeepReadonly<Hypothesis> {
    const value = this.hypotheses.get(id); if (!value) throw new Error('unknown hypothesis'); return value;
  }
  experiment(id: string): DeepReadonly<ExperimentRecord> {
    const value = this.experiments.get(id); if (!value) throw new Error('unknown experiment'); return value;
  }
  setRoutes(input: unknown): DeepReadonly<RouteAssignment> {
    const routes = RouteAssignmentSchema.parse(input);
    const primary = routes.primary ? this.hypothesis(routes.primary) : null;
    const probe = routes.counterprobe ? this.hypothesis(routes.counterprobe.hypothesis_id) : null;
    for (const route of [primary, probe]) if (route && ['rejected', 'stale'].includes(route.state)) throw new Error('route hypothesis is rejected or stale');
    if (probe && primary && !(probe.cost.wall_ms < primary.cost.wall_ms && probe.cost.tokens <= primary.cost.tokens && probe.cost.remote_units <= primary.cost.remote_units)) {
      throw new Error('counterprobe must be cheaper in wall time and no more expensive in token or remote budgets');
    }
    // Running work retains the authority under which it was admitted until host-observed completion.
    // Adding an idle cheap probe is allowed; parking, promoting or demoting running work is not.
    for (const experiment of this.experiments.values()) {
      if (experiment.status !== 'running') continue;
      const id = experiment.plan.hypothesis_id;
      const nextRole = id === routes.primary ? 'primary' : id === routes.counterprobe?.hypothesis_id ? 'probe' : null;
      if (nextRole !== this.hypothesis(id).route_status) throw new Error('running experiment must complete before its route is reassigned');
    }
    for (const [id, hypothesis] of this.hypotheses) {
      const route_status = id === routes.primary ? 'primary' : id === routes.counterprobe?.hypothesis_id ? 'probe'
        : ['primary', 'probe'].includes(hypothesis.route_status) ? 'parked' : hypothesis.route_status;
      this.hypotheses.set(id, freezeData<Hypothesis>(HypothesisSchema.parse({ ...hypothesis, route_status })));
    }
    this.routes = freezeData(routes); return this.routes;
  }
  startExperiment(input: unknown, newReason?: unknown): DeepReadonly<ExperimentRecord> {
    const plan = ExperimentSchema.parse(input);
    if (this.experiments.has(plan.id)) throw new Error('experiment id already exists');
    const hypothesis = this.hypothesis(plan.hypothesis_id);
    if (!['primary', 'probe'].includes(hypothesis.route_status)) throw new Error('experiment requires an active route');
    if (!['proposed', 'testing'].includes(hypothesis.state)) throw new Error('invalid hypothesis transition to testing; create a new hypothesis for changed premises');
    for (const key of ['wall_ms', 'tokens', 'remote_units'] as const) if (plan.budget[key] > hypothesis.cost[key]) throw new Error('experiment exceeds route cost budget');
    for (const [key, value] of Object.entries(hypothesis.state_dependencies)) {
      if (!(key in plan.state_dependencies) || canonical(value) !== canonical(plan.state_dependencies[key])) throw new Error('experiment state dependency mismatch');
    }
    const fingerprint = experimentFingerprint(plan);
    const reasons = this.fingerprints.get(fingerprint);
    const reason = newReason === undefined ? null : RedispatchReasonSchema.parse(newReason);
    if (reasons && !reason) throw new Error('duplicate experiment fingerprint requires a recorded new reason');
    if (reason && reasons?.has(reason.reason)) throw new Error('duplicate fingerprint requires a genuinely new reason');
    const record = freezeData({ plan, fingerprint, status: 'running' as const, events: [], activities: [], redispatch_reason: reason, conclusion: null });
    this.experiments.set(plan.id, record);
    this.fingerprints.set(fingerprint, new Set([...(reasons ?? []), ...(reason ? [reason.reason] : [])]));
    this.hypotheses.set(hypothesis.id, freezeData<Hypothesis>(HypothesisSchema.parse({ ...hypothesis, state: 'testing' })));
    return record;
  }

  recordRuntimeEvent(eventId: string): Promise<DeepReadonly<ExperimentRecord>> {
    return this.serial(async () => {
      const id = Text.parse(eventId);
      if (this.usedEvents.has(id)) throw new Error('runtime event already consumed');
      const event = freezeData(RuntimeExperimentEventSchema.parse(await this.options.resolveRuntimeEvent(id)));
      if (event.id !== id) throw new Error('runtime event identity mismatch');
      await this.verifyRefs(event.artifact_refs);
      const record = this.running(event.experiment_id);
      if (event.fingerprint !== record.fingerprint) throw new Error('runtime fingerprint mismatch');
      const last = record.events.at(-1);
      if (last?.outcome === 'failure' && this.toolRepairCount(record) <= record.events.filter(value => value.outcome === 'failure').length - 1) throw new Error('failed step requires repair within original experiment');
      const completed = record.events.filter(value => value.outcome === 'success').length;
      if (record.plan.procedure[completed]?.id !== event.step_id) throw new Error('runtime event violates ordered procedure');
      const next = this.snapshot<ExperimentRecord>({ ...record, events: [...record.events, event] });
      this.experiments.set(record.plan.id, next); this.usedEvents.add(id); return next;
    });
  }
  recordActivity(id: string, input: unknown): DeepReadonly<ExperimentRecord> {
    const activity = ExperimentActivitySchema.parse(input);
    const localRepresentation = activity.kind === 'repair' && activity.repair_kind !== undefined && activity.repair_kind !== 'tool';
    const record = localRepresentation ? this.experiment(id) : this.running(id);
    if (record.status === 'abandoned') throw new Error('experiment already completed');
    if (activity.kind === 'repair') {
      if (this.repairCount(record) >= record.plan.repair_budget) throw new Error('experiment repair budget exhausted');
      if (!localRepresentation) {
        if (record.events.at(-1)?.outcome !== 'failure') throw new Error('repair requires a tool or representation failure');
        if (this.toolRepairCount(record) >= record.events.filter(event => event.outcome === 'failure').length) throw new Error('failure already repaired');
      }
    }
    const next = this.snapshot<ExperimentRecord>({ ...record, activities: [...record.activities, activity] });
    this.experiments.set(id, next); return next;
  }
  completeExperiment(id: string): DeepReadonly<ExperimentRecord> {
    const record = this.running(id);
    if (!record.events.length) throw new Error('completion requires real host runtime events');
    const successes = record.events.filter(event => event.outcome === 'success').length;
    const failed = record.events.at(-1)?.outcome === 'failure';
    if (!failed && successes !== record.plan.procedure.length) throw new Error('ordered procedure still incomplete');
    const next = this.snapshot<ExperimentRecord>({ ...record, status: failed ? 'failed' as const : 'succeeded' as const });
    this.experiments.set(id, next); return next;
  }
  /** Host-only cancellation boundary: caller must first prove no tool dispatch remains in flight.
   * Abandonment is not an executed experiment window and creates no synthetic runtime receipt.
   */
  abandonExperiment(id: string, reason: string): DeepReadonly<ExperimentRecord> {
    const record = this.running(id); const rationale = Text.parse(reason);
    const hypothesis = this.hypothesis(record.plan.hypothesis_id);
    const next = this.snapshot<ExperimentRecord>({ ...record, status: 'abandoned',
      conclusion: { verdict: 'inconclusive', rationale, evidence_refs: this.uniqueRefs(record.events.flatMap(event => event.artifact_refs)) } });
    this.experiments.set(id, next);
    this.hypotheses.set(hypothesis.id, this.snapshot<Hypothesis>({ ...hypothesis, state: 'inconclusive' }));
    return next;
  }
  conclude(id: string, input: unknown): Promise<DeepReadonly<Hypothesis>> {
    return this.serial(async () => {
      const conclusion = HypothesisConclusionSchema.parse(input);
      const experiment = this.completed(id); const hypothesis = this.hypothesis(experiment.plan.hypothesis_id);
      if (hypothesis.state !== 'testing') throw new Error('invalid hypothesis transition; conclusion requires testing');
      if (conclusion.verdict === 'supported' || conclusion.verdict === 'rejected') {
        if (experiment.status !== 'succeeded') throw new Error('tool failure is not mechanism evidence');
        await this.acceptProgress({ kind: 'evidence', experiment_id: id, hypothesis_id: hypothesis.id, ...conclusion });
      } else { await this.verifyExperimentRefs(experiment, conclusion.evidence_refs); }
      this.options.assertCurrent?.();
      // A host route decision may occur while evidence verification awaits I/O. Preserve its current assignment.
      const current = this.hypothesis(hypothesis.id);
      const next = this.snapshot<Hypothesis>({ ...current, state: conclusion.verdict,
        supporting_refs: conclusion.verdict === 'supported' ? this.uniqueRefs([...hypothesis.supporting_refs, ...conclusion.evidence_refs]) : [...hypothesis.supporting_refs],
        contradicting_refs: conclusion.verdict === 'rejected' ? this.uniqueRefs([...hypothesis.contradicting_refs, ...conclusion.evidence_refs]) : [...hypothesis.contradicting_refs]
      });
      this.experiments.set(id, this.snapshot<ExperimentRecord>({ ...experiment, conclusion }));
      this.hypotheses.set(hypothesis.id, next); return next;
    });
  }
  recordProgress(input: unknown): Promise<ProgressAcceptance> { return this.serial(() => this.acceptProgress(input)); }

  finishWindow(): DeepReadonly<ProgressWindow> {
    const completed = [...this.experiments.values()].filter(value => ['succeeded', 'failed'].includes(value.status) && !this.closedExperiments.has(value.plan.id));
    const progress = this.progress.filter(value => !this.closedProgress.has(value.sequence));
    let request: ProgressWindow['request'] = null;
    if (completed.length) {
      this.noProgress = progress.length ? 0 : this.noProgress + 1;
      if (this.noProgress >= 2 && !this.strategyPending && !this.strategyHandled) { this.strategyPending = true; request = 'strategy'; }
      for (const value of completed) this.closedExperiments.add(value.plan.id);
      for (const value of progress) this.closedProgress.add(value.sequence);
    }
    return freezeData({ sequence: ++this.windows, completed_experiments: completed.map(value => value.plan.id),
      progress_sequences: completed.length ? progress.map(value => value.sequence) : [], consecutive_no_progress: this.noProgress, request });
  }
  strategyReplanned(rationale: string): void {
    Text.parse(rationale); if (!this.strategyPending) throw new Error('Strategy replan was not requested');
    this.strategyPending = false; this.strategyHandled = true;
  }
  requestRecoveryCritic(reason: string): DeepReadonly<{ request: 'recovery_critic'; reason: string }> {
    const parsed = Text.parse(reason);
    if (!this.strategyHandled || this.strategyPending) throw new Error('Strategy must replan before Recovery Critic');
    if (this.criticUsed) throw new Error('Recovery Critic can be requested at most once');
    this.criticUsed = true; return freezeData({ request: 'recovery_critic', reason: parsed });
  }
  progressRecords(): ReadonlyArray<DeepReadonly<ProgressRecord>> { return Object.freeze([...this.progress]); }

  private async acceptProgress(input: unknown): Promise<ProgressAcceptance> {
    const claim = freezeData(SemanticProgressSchema.parse(input));
    const experiment = this.completed(claim.experiment_id); const hypothesis = this.hypothesis(experiment.plan.hypothesis_id);
    if (claim.kind === 'evidence' && (claim.hypothesis_id !== hypothesis.id || experiment.status !== 'succeeded')) throw new Error('evidence requires a matching hypothesis and successful mechanism experiment');
    await this.verifyExperimentRefs(experiment, claim.evidence_refs);
    // Even duplicate evidence must substantiate the proposed meaning (especially a new verdict).
    const proof = SubstantiationSchema.parse(await this.options.validateProgress(claim, experiment, hypothesis));
    this.options.assertCurrent?.();
    if (claim.evidence_refs.every(ref => this.seenEvidence.has(ref.hash))) return Object.freeze({ accepted: false, record: null });
    const reductionKey = claim.kind === 'search_space_reduction' ? canonical([claim.scope, claim.measure]) : null;
    if (claim.kind === 'search_space_reduction') {
      const baseline = this.reductions.get(reductionKey!);
      if (baseline !== undefined && claim.before !== baseline) throw new Error('quantitative reduction must continue the last substantiated baseline');
    }
    const record = freezeData({ sequence: this.progress.length + 1, claim, substantiation: proof.substantiation });
    this.progress.push(record); for (const ref of claim.evidence_refs) this.seenEvidence.add(ref.hash);
    if (claim.kind === 'search_space_reduction') this.reductions.set(reductionKey!, claim.after);
    this.noProgress = 0; this.strategyPending = false; this.strategyHandled = false;
    return Object.freeze({ accepted: true, record });
  }
  private running(id: string): DeepReadonly<ExperimentRecord> {
    const record = this.experiment(id); if (record.status !== 'running') throw new Error('experiment already completed'); return record;
  }
  private completed(id: string): DeepReadonly<ExperimentRecord> {
    const record = this.experiment(id); if (record.status === 'running') throw new Error('progress requires a completed experiment'); return record;
  }
  private repairCount(record: DeepReadonly<ExperimentRecord>): number { return record.activities.filter(value => value.kind === 'repair').length; }
  private toolRepairCount(record: DeepReadonly<ExperimentRecord>): number { return record.activities.filter(value => value.kind === 'repair' && (value.repair_kind === undefined || value.repair_kind === 'tool')).length; }
  private async verifyRefs(refs: ReadonlyArray<DeepReadonly<ImmutableArtifactRef>>): Promise<void> {
    for (const ref of refs) if (await this.options.verifyArtifact(ref) !== true) throw new Error('immutable artifact verification failed');
  }
  private async verifyExperimentRefs(experiment: DeepReadonly<ExperimentRecord>, refs: ReadonlyArray<DeepReadonly<ImmutableArtifactRef>>): Promise<void> {
    const available = new Set(experiment.events.flatMap(event => event.artifact_refs.map(ref => canonical(ref))));
    for (const ref of refs) if (!available.has(canonical(ref))) throw new Error('evidence ref was not produced by this runtime experiment');
    await this.verifyRefs(refs);
    this.options.assertCurrent?.();
  }
  private uniqueRefs(refs: ReadonlyArray<DeepReadonly<ImmutableArtifactRef>>): ImmutableArtifactRef[] {
    return [...new Map(refs.map(ref => [canonical(ref), { ...ref }])).values()];
  }
  private snapshot<T>(value: unknown): DeepReadonly<T> { return freezeData<T>(structuredClone(value) as T); }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingOperations++;
    const next = this.pending.then(operation).finally(() => { this.pendingOperations--; }); this.pending = next.catch(() => {}); return next;
  }
}
