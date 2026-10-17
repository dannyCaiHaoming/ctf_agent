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
  z.object({ kind: z.literal('budget.snapshot'), runId: RunIdSchema, used: BudgetSchema, at: z.string().datetime() })
]);
export type EventDelta = z.infer<typeof EventDeltaSchema>;
