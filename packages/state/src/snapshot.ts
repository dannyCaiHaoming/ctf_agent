import { z } from 'zod';
import { HypothesisManagerSnapshotSchema } from './hypothesis-snapshot.js';
import { createHash } from 'node:crypto';
import { ImmutableArtifactRefSchema, ResponsibilityTaskSchema, JsonValueSchema } from '@ctf/contracts';

const Text = z.string().trim().min(1);
const Count = z.number().int().nonnegative().safe();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Refs = z.array(ImmutableArtifactRefSchema);
export const RawObservationSchema = z.object({
  id: Text, source: z.literal('raw_observation'), artifact: ImmutableArtifactRefSchema,
  // Ranges address bytes within this immutable artifact, never mutable job buffers.
  start_byte: Count, end_byte: Count, source_job: Text, source_start_cursor: Count, source_end_cursor: Count
}).strict().superRefine((value, context) => {
  if (value.end_byte <= value.start_byte || value.end_byte > value.artifact.size) context.addIssue({ code: 'custom', path: ['end_byte'], message: 'raw observation range is empty or outside artifact' });
  if (value.source_end_cursor - value.source_start_cursor !== value.artifact.size) context.addIssue({ code: 'custom', path: ['source_end_cursor'], message: 'source cursor span must equal complete published artifact size' });
});
export type RawObservation = z.infer<typeof RawObservationSchema>;
export const LocalNextActionSchema = z.object({
  kind: z.literal('local_node_script'), action_id: Text, objective: Text, fingerprint: Hash, experiment_id: Text, step_id: Text,
  deadline: z.string().datetime(), script_ref: ImmutableArtifactRefSchema, input_refs: Refs,
  observation_ids: z.array(Text).min(1),
  // Explicit bounded literals, after script and input paths. No shell or interpreter flags.
  arguments: z.array(z.string().max(4096)).max(64), expected_output: Text
}).strict();
export type LocalNextAction = z.infer<typeof LocalNextActionSchema>;
const BudgetVector = z.object({ time_ms: Count, tokens: Count, instances: Count, hints: Count, remote_units: z.number().finite().nonnegative() }).strict();
const Handle = z.object({
  id: Text, kind: z.enum(['job', 'channel']), state: z.enum(['active', 'completed', 'lost']), owner_task: Text,
  experiment_id: Text.nullable(), cursor: Count, deadline: z.string().datetime(),
  completion_subscription: z.object({ id: Text, waiting_task: Text, continuation_ref: ImmutableArtifactRefSchema, state: z.enum(['waiting', 'ready', 'consumed', 'lost']) }).strict().nullable()
}).strict();
export const RecoverableSnapshotSchema = z.object({
  schema_version: z.literal(1), snapshot_id: Text, sequence: Count, run_id: Text,
  challenge: z.object({ id: Text, description: Text, resource_generation: Count }).strict(),
  current_goal: Text, next_action: LocalNextActionSchema,
  published: z.object({ latest_script_refs: Refs.min(1), latest_input_refs: Refs, workspace_files: z.array(z.object({ relative_path: Text, artifact: ImmutableArtifactRefSchema }).strict()) }).strict(),
  hypothesis_manager: HypothesisManagerSnapshotSchema,
  failed_fingerprints: z.array(z.object({ fingerprint: Hash, hypothesis_id: Text, no_redo_reason: Text, observation_ids: z.array(Text).min(1) }).strict()),
  critical_values: z.array(z.object({ name: Text, value: JsonValueSchema, observation_ids: z.array(Text).min(1) }).strict()),
  raw_observations: z.array(RawObservationSchema).min(1), active_handles: z.array(Handle),
  task: ResponsibilityTaskSchema, previous_session_id: Text,
  deadline: z.string().datetime(), captured_at: z.string().datetime(),
  budget: z.object({ limit: BudgetVector, used: BudgetVector, remaining: BudgetVector }).strict(),
  process: z.object({ owner_pid: z.number().int().positive().safe(), incarnation: Text }).strict()
}).strict().superRefine((snapshot, context) => {
  const error = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  if (snapshot.task.run_id !== snapshot.run_id || snapshot.task.challenge_id !== snapshot.challenge.id) error(['task'], 'snapshot task scope mismatch');
  if (!snapshot.task.responsibility_set.includes('domain_solver') || snapshot.task.responsibility_set.includes('verification')) error(['task'], 'resume requires a Solver task, never a Verifier task');
  if (Date.parse(snapshot.next_action.deadline) > Date.parse(snapshot.deadline) || Date.parse(snapshot.next_action.deadline) <= Date.parse(snapshot.captured_at)) error(['next_action', 'deadline'], 'pending action deadline must remain inside original run deadline');
  if (Date.parse(snapshot.captured_at) >= Date.parse(snapshot.deadline)) error(['deadline'], 'snapshot already expired at capture');
  if (Date.parse(snapshot.task.lease.expires_at) <= Date.parse(snapshot.captured_at)) error(['task', 'lease'], 'snapshot lease expired at capture');
  for (const key of Object.keys(snapshot.budget.limit) as Array<keyof typeof snapshot.budget.limit>) {
    if (Math.abs(snapshot.budget.used[key] + snapshot.budget.remaining[key] - snapshot.budget.limit[key]) > 1e-8) error(['budget', key], 'used plus remaining must equal original limit');
  }
  const ids = new Set(snapshot.raw_observations.map(value => value.id));
  if (ids.size !== snapshot.raw_observations.length) error(['raw_observations'], 'duplicate observation id');
  const demands = [snapshot.next_action, ...snapshot.failed_fingerprints, ...snapshot.critical_values];
  for (const item of demands) for (const id of item.observation_ids) if (!ids.has(id)) error(['raw_observations'], `missing original raw observation ${id}`);
  if (snapshot.failed_fingerprints.some(value => value.fingerprint === snapshot.next_action.fingerprint)) error(['next_action', 'fingerprint'], 'next action would redo a rejected fingerprint');
  const experiment = snapshot.hypothesis_manager.experiments.find(value => value.plan.id === snapshot.next_action.experiment_id);
  if (!experiment || experiment.status !== 'running' || experiment.fingerprint !== snapshot.next_action.fingerprint) error(['next_action'], 'next action must bind a running admitted experiment');
  else {
    const step = experiment.plan.procedure[experiment.events.filter(value => value.outcome === 'success').length];
    if (step?.id !== snapshot.next_action.step_id || step.tool !== 'job.run') error(['next_action'], 'next action is not the pending ordered local command step');
    if (experiment.events.at(-1)?.outcome === 'failure') error(['next_action'], 'failed pending step needs explicit original-experiment repair before checkpoint');
  }
  for (const failure of snapshot.failed_fingerprints) {
    const hypothesis = snapshot.hypothesis_manager.hypotheses.find(value => value.id === failure.hypothesis_id);
    if (hypothesis?.state !== 'rejected' || !snapshot.hypothesis_manager.experiments.some(value => value.plan.hypothesis_id === failure.hypothesis_id && value.fingerprint === failure.fingerprint && value.conclusion?.verdict === 'rejected')) error(['failed_fingerprints'], 'rejected fingerprint lacks original rejected hypothesis/experiment');
  }
  for (const experiment of snapshot.hypothesis_manager.experiments.filter(value => value.conclusion?.verdict === 'rejected')) {
    if (!snapshot.failed_fingerprints.some(value => value.fingerprint === experiment.fingerprint && value.hypothesis_id === experiment.plan.hypothesis_id)) error(['failed_fingerprints'], 'snapshot omitted a rejected experiment fingerprint and no-redo reason');
    for (const ref of experiment.conclusion!.evidence_refs) {
      if (!snapshot.raw_observations.some(value => value.artifact.hash === ref.hash && value.artifact.size === ref.size && value.artifact.path === ref.path)) error(['raw_observations'], 'rejection requires original raw observations, never summary-only evidence');
    }
  }
  const same = (a: { hash: string; size: number; path: string }, b: typeof a) => a.hash === b.hash && a.size === b.size && a.path === b.path;
  if (!snapshot.published.latest_script_refs.some(ref => same(ref, snapshot.next_action.script_ref))) error(['next_action', 'script_ref'], 'next script is not the latest published script');
  for (const ref of snapshot.next_action.input_refs) if (!snapshot.published.latest_input_refs.some(value => same(ref, value))) error(['next_action', 'input_refs'], 'next input is not published');
  for (const [index, handle] of snapshot.active_handles.entries()) {
    if (handle.owner_task !== snapshot.task.task_id || (handle.completion_subscription && handle.completion_subscription.waiting_task !== handle.owner_task)) error(['active_handles', index], 'handle/subscription owner mismatch');
  }
});
export type RecoverableSnapshot = z.infer<typeof RecoverableSnapshotSchema>;

// Sorted object keys ensure the host authorization pins the exact action independent of JSON formatting.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function nextActionDigest(input: unknown): string {
  return createHash('sha256').update(canonical(LocalNextActionSchema.parse(input))).digest('hex');
}
export const ResumeResultSchema = z.object({
  output_ref: ImmutableArtifactRefSchema, exit_code: z.number().int().nullable(),
  wall_ms: Count, state: z.enum(['completed', 'failed']), reason: Text.nullable(),
  hypothesis_manager: HypothesisManagerSnapshotSchema,
  budget_used: BudgetVector, budget_remaining: BudgetVector,
  session_id: Text, context_id: Text, lost_handle_ids: z.array(Text), model_calls: z.literal(0)
}).strict();
export type ResumeResult = z.infer<typeof ResumeResultSchema>;
export interface RecoverableCheckpoint {
  snapshot: RecoverableSnapshot;
  action_state: 'ready' | 'dispatched' | 'completed' | 'failed';
  dispatch_pid: number | null;
  result: ResumeResult | null;
}

export function snapshotArtifactRefs(snapshot: RecoverableSnapshot): Array<{ hash: string; size: number; path: string }> {
  const refs: Array<{ hash: string; size: number; path: string }> = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('hash' in value && 'size' in value && 'path' in value) { refs.push(ImmutableArtifactRefSchema.parse(value)); return; }
    for (const child of Object.values(value)) walk(child);
  };
  walk(snapshot);
  return [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()];
}
