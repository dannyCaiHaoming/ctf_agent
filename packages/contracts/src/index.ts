import { z } from 'zod';

const branded = <T extends z.ZodTypeAny, B extends string>(schema: T, brand: B) =>
  schema.brand<B>();

export const RunIdSchema = branded(z.string().min(1), 'RunId');
export const ChallengeIdSchema = branded(z.string().min(1), 'ChallengeId');
export const TaskIdSchema = branded(z.string().min(1), 'TaskId');
export const SessionIdSchema = branded(z.string().min(1), 'SessionId');
export const ResponsibilitySetIdSchema = branded(z.string().min(1), 'ResponsibilitySetId');
export const LeaseIdSchema = branded(z.string().min(1), 'LeaseId');
export const JobIdSchema = branded(z.string().min(1), 'JobId');
export const ArtifactHashSchema = branded(z.string().regex(/^[a-f0-9]{64}$/), 'ArtifactHash');
export const CursorSchema = branded(z.number().int().min(0), 'Cursor');

export type RunId = z.infer<typeof RunIdSchema>;
export type ChallengeId = z.infer<typeof ChallengeIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type ResponsibilitySetId = z.infer<typeof ResponsibilitySetIdSchema>;
export type LeaseId = z.infer<typeof LeaseIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;
export type ArtifactHash = z.infer<typeof ArtifactHashSchema>;
export type Cursor = z.infer<typeof CursorSchema>;

// These lists are mirrored verbatim from design spec §7.1.
export const pipelineStages = ['intake', 'recon', 'strategy', 'solving', 'engineering', 'verifying', 'submitting', 'finalizing'] as const;
export const solveStates = ['queued', 'active', 'paused', 'blocked_auth', 'blocked_capability', 'blocked_data', 'blocked_platform', 'blocked_runtime', 'finished', 'deadline_exceeded'] as const;
export const progressStates = ['no_candidate', 'candidate', 'candidate_only', 'partial', 'completed', 'unknown_total'] as const;
export const resourceStates = ['absent', 'starting', 'ready', 'retained', 'closing', 'closed', 'unknown'] as const;
export const cleanupStates = ['not_needed', 'pending', 'succeeded', 'failed', 'unknown'] as const;
export const runStates = ['draft', 'prepared', 'starting', 'admitting', 'running', 'interrupted', 'finalizing', 'completed', 'failed', 'invalid', 'aborted'] as const;

export const PipelineStageSchema = z.enum(pipelineStages);
export const SolveStateSchema = z.enum(solveStates);
export const ProgressStateSchema = z.enum(progressStates);
export const ResourceStateSchema = z.enum(resourceStates);
export const CleanupStateSchema = z.enum(cleanupStates);
export const RunStateSchema = z.enum(runStates);

export const outcomes = ['solved', 'partial', 'candidate_only', 'unsolved', 'inconclusive', 'infrastructure_invalid'] as const;
export const OutcomeSchema = z.enum(outcomes);

export const effectLevels = ['local_rebuildable', 'retryable_observation', 'protected_effect'] as const;
export const EffectLevelSchema = z.enum(effectLevels);
export type EffectLevel = z.infer<typeof EffectLevelSchema>;

export const dataClasses = ['control_secret', 'challenge_auth_reference', 'challenge_analysis_data', 'artifact_bulk', 'allowed_excerpt', 'unknown'] as const;
export const DataClassSchema = z.enum(dataClasses);

export const BudgetSchema = z.object({
  wallClockMs: z.number().int().positive(),
  maxSteps: z.number().int().positive(),
  maxToolJobs: z.number().int().positive(),
  maxObservableTokens: z.number().int().positive()
});
export type Budget = z.infer<typeof BudgetSchema>;

const MutableRangeBaseSchema = z.object({
  startCursor: CursorSchema,
  endCursor: CursorSchema,
  complete: z.boolean()
});
export const MutableRangeSchema = MutableRangeBaseSchema.refine(v => v.endCursor >= v.startCursor);
export const ImmutableRangeSchema = MutableRangeBaseSchema.extend({
  complete: z.literal(true),
  publishedAt: z.string().datetime()
}).refine(v => v.endCursor >= v.startCursor);
export type MutableRange = z.infer<typeof MutableRangeSchema>;
export type ImmutableRange = z.infer<typeof ImmutableRangeSchema>;

export const ObservationSchema = z.object({
  cursor: CursorSchema,
  bytes: z.number().int().min(0),
  effect: EffectLevelSchema,
  immutableRange: ImmutableRangeSchema.optional(),
  mutableRange: MutableRangeSchema.optional()
}).refine(v => !(v.immutableRange && v.mutableRange));
export type Observation = z.infer<typeof ObservationSchema>;

export const IntentSchema = z.object({
  intent: z.literal('candidate.submit'),
  candidate: z.string().min(1),
  challengeId: ChallengeIdSchema,
  task: TaskIdSchema,
  lease: LeaseIdSchema
});
export type CandidateIntent = z.infer<typeof IntentSchema>;

const modelFacingBase = {
  kind: z.literal('model_facing'),
  challengeId: ChallengeIdSchema,
  data: z.string()
};
// A compile-time marker prevents ControlSecret from being assigned here.
export type ControlSecret = { readonly __brand: 'ControlSecret'; readonly value: string };
export const ModelFacingDTOSchema = z.object(modelFacingBase);
export type ModelFacingDTO = z.infer<typeof ModelFacingDTOSchema>;
export type ModelDTOInput = string | ModelFacingDTO;

export type ControlSecretMismatch = ControlSecret extends ModelDTOInput ? false : true;
export const _controlSecretIsNotSerializable: ControlSecretMismatch = true;

export const EventDeltaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run.state'), runId: RunIdSchema, from: RunStateSchema, to: RunStateSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('solve.state'), runId: RunIdSchema, challengeId: ChallengeIdSchema, from: SolveStateSchema, to: SolveStateSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('progress.state'), runId: RunIdSchema, challengeId: ChallengeIdSchema, from: ProgressStateSchema, to: ProgressStateSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('resource.state'), runId: RunIdSchema, challengeId: ChallengeIdSchema, from: ResourceStateSchema, to: ResourceStateSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('cleanup.state'), runId: RunIdSchema, challengeId: ChallengeIdSchema, from: CleanupStateSchema, to: CleanupStateSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('artifact.published'), runId: RunIdSchema, challengeId: ChallengeIdSchema, hash: ArtifactHashSchema, at: z.string().datetime() }),
  z.object({ kind: z.literal('budget.snapshot'), runId: RunIdSchema, used: BudgetSchema, at: z.string().datetime() }),
  // Host-owned M1 activity ledger; SQLite remains the canonical event store.
  z.object({ kind: z.literal('solver.activity'), runId: RunIdSchema, challengeId: ChallengeIdSchema,
    taskId: TaskIdSchema, sessionId: SessionIdSchema, attemptId: z.string().min(1),
    activity: z.enum(['started', 'driver.call', 'tool.started', 'tool.chunk', 'tool.result', 'job.watch', 'job.continuation', 'experiment.started',
      'experiment.completed', 'experiment.abandoned', 'progress.window', 'hypothesis.conclusion', 'progress.adjudication', 'repair', 'retry', 'strategy.request', 'strategy.switch', 'candidate', 'candidate.stage', 'checkpoint']),
    data: z.record(z.unknown()), at: z.string().datetime() }).strict()
]);
export type EventDelta = z.infer<typeof EventDeltaSchema>;

// Spec §6.1: task authority is fixed at creation; verification is always isolated.
export const responsibilities = ['coordination', 'intake_triage', 'target_recon', 'reference', 'strategy', 'domain_solver', 'solution_engineering', 'verification', 'recovery_critic'] as const;
export const ResponsibilitySchema = z.enum(responsibilities);
export type Responsibility = z.infer<typeof ResponsibilitySchema>;
export const ResponsibilitySetSchema = z.array(ResponsibilitySchema).min(1).max(responsibilities.length)
  .refine(values => new Set(values).size === values.length, 'duplicate responsibility')
  .refine(values => !values.includes('verification') || values.length === 1, 'verification requires an exclusive task');

const NonemptyTextSchema = z.string().trim().min(1);
const RevisionSchema = z.number().int().nonnegative().safe();
export const AttemptIdSchema = branded(NonemptyTextSchema, 'AttemptId');
export type AttemptId = z.infer<typeof AttemptIdSchema>;
export const ImmutableArtifactRefSchema = z.object({
  hash: ArtifactHashSchema,
  size: z.number().int().nonnegative().safe(),
  path: NonemptyTextSchema
}).strict();
export type ImmutableArtifactRef = z.infer<typeof ImmutableArtifactRefSchema>;
export const DependencyVersionSchema = z.object({ output_id: NonemptyTextSchema, revision: RevisionSchema }).strict();
export const DependencyVersionsSchema = z.array(DependencyVersionSchema)
  .refine(values => new Set(values.map(value => value.output_id)).size === values.length, 'duplicate dependency');
export type DependencyVersion = z.infer<typeof DependencyVersionSchema>;

const ArtifactRefsSchema = z.array(ImmutableArtifactRefSchema);
const AssumptionSchema = z.object({ statement: NonemptyTextSchema, basis_refs: ArtifactRefsSchema }).strict();
const RejectedAssumptionSchema = AssumptionSchema.extend({ reason: NonemptyTextSchema }).strict();
export const HandoffOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), name: NonemptyTextSchema, ref: ImmutableArtifactRefSchema }).strict(),
  z.object({ kind: z.literal('decision'), statement: NonemptyTextSchema, basis_refs: ArtifactRefsSchema }).strict()
]);
export const ActualCostSchema = z.object({
  wall_clock_ms: z.number().finite().nonnegative(),
  model_calls: z.number().int().nonnegative().safe(),
  tool_jobs: z.number().int().nonnegative().safe(),
  observable_tokens: z.number().int().nonnegative().safe(),
  monetary_cost: z.number().finite().nonnegative()
}).strict();

// Models submit only this payload. Supervisor injects task/attempt identity.
export const HandoffSubmissionSchema = z.object({
  responsibility: ResponsibilitySchema,
  revision: RevisionSchema,
  consumed_snapshot_sequence: RevisionSchema,
  input_refs: ArtifactRefsSchema,
  dependency_versions: DependencyVersionsSchema,
  status: z.enum(['completed', 'inconclusive', 'blocked', 'error', 'cancelled']),
  outputs: z.array(HandoffOutputSchema),
  observation_refs: ArtifactRefsSchema,
  evidence_refs: ArtifactRefsSchema,
  assumptions: z.array(AssumptionSchema),
  rejected_assumptions: z.array(RejectedAssumptionSchema),
  unresolved_questions: z.array(NonemptyTextSchema),
  next_action: NonemptyTextSchema,
  failure_code: NonemptyTextSchema.nullable(),
  actual_cost: ActualCostSchema
}).strict();
export type HandoffSubmission = z.infer<typeof HandoffSubmissionSchema>;
export const HandoffEnvelopeSchema = HandoffSubmissionSchema.extend({
  task_id: TaskIdSchema,
  attempt_id: AttemptIdSchema
}).strict();
export type HandoffEnvelope = z.infer<typeof HandoffEnvelopeSchema>;

export const ResponsibilityTaskSchema = z.object({
  run_id: RunIdSchema,
  challenge_id: ChallengeIdSchema,
  task_id: TaskIdSchema,
  attempt_id: AttemptIdSchema,
  responsibility_set: ResponsibilitySetSchema,
  lease: z.object({ lease_id: LeaseIdSchema, expires_at: z.string().datetime() }).strict()
}).strict();
export type ResponsibilityTask = z.infer<typeof ResponsibilityTaskSchema>;
export const PublishedOutputInputSchema = z.object({
  output_id: NonemptyTextSchema,
  artifact: ImmutableArtifactRefSchema,
  dependency_versions: DependencyVersionsSchema
}).strict();
export type PublishedOutputInput = z.infer<typeof PublishedOutputInputSchema>;

// M1 Task 2: falsifiable hypotheses, ordered experiments, and host-validated progress.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(JsonValueSchema)
]));
// Keep public JSON containers non-recursive for composable DeepReadonly consumers; runtime validation remains recursive.
const JsonDataSchema: z.ZodType<unknown> = JsonValueSchema;
export const ExperimentCostSchema = z.object({
  wall_ms: z.number().finite().positive(), tokens: z.number().int().nonnegative().safe(),
  remote_units: z.number().finite().nonnegative()
}).strict();
export const hypothesisStates = ['proposed', 'testing', 'supported', 'rejected', 'inconclusive', 'stale'] as const;
export const HypothesisSchema = z.object({
  id: NonemptyTextSchema, claim: NonemptyTextSchema,
  preconditions: z.array(NonemptyTextSchema), missing_preconditions: z.array(NonemptyTextSchema),
  supporting_refs: ArtifactRefsSchema, contradicting_refs: ArtifactRefsSchema,
  alternative_explanations: z.array(NonemptyTextSchema), falsifier: NonemptyTextSchema,
  minimal_experiment: NonemptyTextSchema, expected_observation: NonemptyTextSchema,
  state_dependencies: z.record(JsonDataSchema), required_capabilities: z.array(NonemptyTextSchema),
  route_status: z.enum(['queued', 'primary', 'probe', 'parked']), next_action: NonemptyTextSchema,
  cost: ExperimentCostSchema, state: z.enum(hypothesisStates)
}).strict();
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export const ExperimentSchema = z.object({
  id: NonemptyTextSchema, hypothesis_id: NonemptyTextSchema, objective: NonemptyTextSchema,
  input_refs: ArtifactRefsSchema, state_dependencies: z.record(JsonDataSchema), parameters: z.record(JsonDataSchema),
  procedure: z.array(z.object({ id: NonemptyTextSchema, tool: NonemptyTextSchema, input: JsonDataSchema }).strict()).min(1)
    .refine(steps => new Set(steps.map(step => step.id)).size === steps.length, 'duplicate procedure step'),
  expected_support: NonemptyTextSchema, expected_refutation: NonemptyTextSchema,
  budget: ExperimentCostSchema, repair_budget: z.number().int().nonnegative().safe(),
  stop_condition: NonemptyTextSchema, expected_artifacts: z.array(NonemptyTextSchema)
}).strict();
export type Experiment = z.infer<typeof ExperimentSchema>;
export const failureCodes = [
  'hypothesis_falsified', 'tool_invocation_error', 'output_parse_error', 'model_transient', 'model_rate_limited',
  'platform_rate_limited', 'auth_expired', 'protected_effect_unknown', 'metering_unavailable', 'blocked_data',
  'scope_denied', 'resource_exhausted', 'timeout', 'http_forbidden'
] as const;
export const RuntimeExperimentEventSchema = z.object({
  id: NonemptyTextSchema, experiment_id: NonemptyTextSchema, fingerprint: ArtifactHashSchema, step_id: NonemptyTextSchema,
  outcome: z.enum(['success', 'failure']), failure_code: z.enum(failureCodes).nullable(), artifact_refs: ArtifactRefsSchema
}).strict().refine(event => (event.outcome === 'success') === (event.failure_code === null), 'failure code must match outcome')
  .refine(event => event.failure_code !== 'hypothesis_falsified', 'mechanism falsification requires an evidence assessment, not a tool failure');
export type RuntimeExperimentEvent = z.infer<typeof RuntimeExperimentEventSchema>;
export const ExperimentActivitySchema = z.object({
  kind: z.enum(['repair', 'wait', 'transient_retry']), reason: NonemptyTextSchema,
  repair_kind: z.enum(['tool', 'representation', 'auxiliary']).optional()
}).strict().refine(value => value.kind === 'repair' || value.repair_kind === undefined, 'repair_kind requires repair activity');
export type ExperimentActivity = z.infer<typeof ExperimentActivitySchema>;
export const RedispatchReasonSchema = z.object({ reason: NonemptyTextSchema, basis_refs: ArtifactRefsSchema.min(1) }).strict();
export type RedispatchReason = z.infer<typeof RedispatchReasonSchema>;
export const RouteAssignmentSchema = z.object({
  primary: NonemptyTextSchema.nullable(),
  counterprobe: z.object({
    hypothesis_id: NonemptyTextSchema,
    result_to_decision: z.array(z.object({ result: NonemptyTextSchema, decision: NonemptyTextSchema }).strict()).min(2)
      .refine(values => new Set(values.map(value => value.result)).size === values.length, 'duplicate probe result')
      .refine(values => new Set(values.map(value => value.decision)).size > 1, 'probe results must change the decision')
  }).strict().nullable()
}).strict().refine(routes => !routes.counterprobe || (routes.primary && routes.primary !== routes.counterprobe.hypothesis_id), 'counterprobe requires a distinct primary');
export type RouteAssignment = z.infer<typeof RouteAssignmentSchema>;
const semanticProgressBase = {
  experiment_id: NonemptyTextSchema, rationale: NonemptyTextSchema, evidence_refs: ArtifactRefsSchema.min(1)
};
export const SemanticProgressSchema = z.discriminatedUnion('kind', [
  z.object({ ...semanticProgressBase, kind: z.literal('evidence'), hypothesis_id: NonemptyTextSchema, verdict: z.enum(['supported', 'rejected']) }).strict(),
  z.object({ ...semanticProgressBase, kind: z.literal('search_space_reduction'), scope: NonemptyTextSchema,
    measure: NonemptyTextSchema, before: z.number().finite().nonnegative(), after: z.number().finite().nonnegative() }).strict(),
  z.object({ ...semanticProgressBase, kind: z.literal('verified_result'),
    result_type: z.enum(['intermediate_value', 'partial_flag', 'replayable_poc', 'capability']), result: NonemptyTextSchema }).strict(),
  z.object({ ...semanticProgressBase, kind: z.literal('prerequisite_correction'),
    error_type: z.enum(['classification', 'instance_generation', 'session', 'tool_precondition']),
    scope: NonemptyTextSchema, before: NonemptyTextSchema, after: NonemptyTextSchema }).strict()
]).superRefine((claim, context) => {
  if (claim.kind === 'search_space_reduction' && claim.after >= claim.before) context.addIssue({ code: z.ZodIssueCode.custom, message: 'search space must quantitatively shrink' });
  if (claim.kind === 'prerequisite_correction' && claim.before === claim.after) context.addIssue({ code: z.ZodIssueCode.custom, message: 'prerequisite must change' });
});
export type SemanticProgress = z.infer<typeof SemanticProgressSchema>;
export const HypothesisConclusionSchema = z.object({
  verdict: z.enum(['supported', 'rejected', 'inconclusive', 'stale']), rationale: NonemptyTextSchema, evidence_refs: ArtifactRefsSchema
}).strict();
export type HypothesisConclusion = z.infer<typeof HypothesisConclusionSchema>;
