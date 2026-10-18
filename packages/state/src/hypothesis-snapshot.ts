import { z } from 'zod';
import { HypothesisSchema, ExperimentSchema, ExperimentActivitySchema, RuntimeExperimentEventSchema, RedispatchReasonSchema, HypothesisConclusionSchema, SemanticProgressSchema, RouteAssignmentSchema } from '@ctf/contracts';
const Text = z.string().trim().min(1);
const Count = z.number().int().nonnegative().safe();
export const HypothesisManagerSnapshotSchema = z.object({
  version: z.literal(1), hypotheses: z.array(HypothesisSchema),
  experiments: z.array(z.object({ plan: ExperimentSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['running', 'succeeded', 'failed', 'abandoned']), events: z.array(RuntimeExperimentEventSchema), activities: z.array(ExperimentActivitySchema), redispatch_reason: RedispatchReasonSchema.nullable(), conclusion: HypothesisConclusionSchema.nullable() }).strict()),
  fingerprints: z.array(z.object({ fingerprint: Text, reasons: z.array(Text) }).strict()),
  used_events: z.array(Text), progress: z.array(z.object({ sequence: Count, claim: SemanticProgressSchema, substantiation: Text }).strict()),
  seen_evidence: z.array(Text), reductions: z.array(z.object({ key: Text, value: z.number().finite().nonnegative() }).strict()),
  closed_experiments: z.array(Text), closed_progress: z.array(Count), routes: RouteAssignmentSchema,
  windows: Count, no_progress: Count, strategy_pending: z.boolean(), strategy_handled: z.boolean(), critic_used: z.boolean()
}).strict();
export type HypothesisManagerSnapshot = z.infer<typeof HypothesisManagerSnapshotSchema>;
