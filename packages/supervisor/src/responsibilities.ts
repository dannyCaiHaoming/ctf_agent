import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  HandoffEnvelopeSchema, HandoffSubmissionSchema, ResponsibilityTaskSchema, SessionIdSchema, TaskIdSchema,
  type HandoffEnvelope, type HandoffSubmission, type ImmutableArtifactRef, type ResponsibilityTask
} from '@ctf/contracts';

export type DeepReadonly<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** Freeze only parsed/copied data, never a caller's mutable input. */
export function freezeData<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** A trusted ArtifactStore.verify adapter; never sourced from model arguments. */
export type VerifyArtifact = (ref: DeepReadonly<ImmutableArtifactRef>) => Promise<true>;
export interface ReasoningContext { readonly id: string }

export interface ResponsibilityBinding {
  session_id: string;
  run_id: string;
  challenge_id: string;
  task_id: string;
  attempt_id: string;
  responsibility_set: ResponsibilityTask['responsibility_set'];
  lease_id: string;
  expires_at: string;
}

type TaskRecord = { identity: DeepReadonly<ResponsibilityTask>; expiresAt: string; revoked: boolean };
type SessionRecord = { taskId: string; context: ReasoningContext };
const SessionRegistrationSchema = z.object({
  session_id: SessionIdSchema, task_id: TaskIdSchema,
  context: z.custom<ReasoningContext>(value => typeof value === 'object' && value !== null)
}).strict();
const HostSubmissionContextSchema = z.object({ session_id: SessionIdSchema, lease_id: z.string().min(1) }).strict();

/**
 * Host-owned foundation for M1 dispatch. Registration, context allocation and lease
 * mutation are Supervisor APIs, never exposed as worker tools. Existing M0 dispatch
 * is deliberately not routed through this registry yet.
 */
export class ResponsibilityRegistry {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly contexts = new WeakMap<ReasoningContext, { taskId?: string }>();
  private readonly now: () => number;

  constructor(private readonly options: { verifyArtifact: VerifyArtifact; now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  createTask(input: unknown): DeepReadonly<ResponsibilityTask> {
    const parsed = ResponsibilityTaskSchema.parse(input);
    if (this.tasks.has(parsed.task_id)) throw new Error('task already exists; identity and responsibility_set are immutable');
    if (Date.parse(parsed.lease.expires_at) <= this.now()) throw new Error('lease expired');
    const identity = freezeData(parsed);
    this.tasks.set(parsed.task_id, { identity, expiresAt: parsed.lease.expires_at, revoked: false });
    return identity;
  }

  /** Opaque host provenance: copying its visible id does not copy this authority. */
  createReasoningContext(): ReasoningContext {
    const context = Object.freeze({ id: `context_${randomUUID()}` });
    this.contexts.set(context, {});
    return context;
  }

  bindSession(input: { session_id: string; task_id: string; context: ReasoningContext }): DeepReadonly<ResponsibilityBinding> {
    const parsed = SessionRegistrationSchema.parse(input);
    const sessionId = parsed.session_id;
    const taskId = parsed.task_id;
    if (this.sessions.has(sessionId)) throw new Error('session already exists; create a new session for a different task/challenge');
    const task = this.task(taskId);
    this.activeLease(task);
    const context = this.contexts.get(parsed.context);
    if (!context) throw new Error('reasoning context was not issued by this Supervisor');
    // Even a replacement session of an existing task must not import another
    // task's reasoning context. Symmetric regardless of Solver/Verifier order.
    if (context.taskId && context.taskId !== taskId) throw new Error('reasoning context belongs to a different task');
    context.taskId = taskId;
    this.sessions.set(sessionId, { taskId, context: parsed.context });
    return this.binding(sessionId);
  }

  contextForSession(sessionId: string): ReasoningContext {
    const session = this.session(sessionId);
    this.activeLease(this.task(session.taskId));
    return session.context;
  }

  binding(sessionId: string): DeepReadonly<ResponsibilityBinding> {
    const task = this.task(this.session(sessionId).taskId);
    this.activeLease(task);
    const identity = task.identity;
    return freezeData({
      session_id: sessionId, run_id: identity.run_id, challenge_id: identity.challenge_id,
      task_id: identity.task_id, attempt_id: identity.attempt_id,
      responsibility_set: [...identity.responsibility_set], lease_id: identity.lease.lease_id,
      expires_at: task.expiresAt
    });
  }

  renewLease(taskId: string, leaseId: string, expiresAt: string): void {
    const task = this.task(taskId);
    this.activeLease(task, leaseId);
    const parsed = z.string().datetime().parse(expiresAt);
    if (Date.parse(parsed) <= Date.parse(task.expiresAt)) throw new Error('lease renewal must extend expiry');
    task.expiresAt = parsed;
  }

  revokeLease(taskId: string, leaseId: string): void {
    const task = this.task(taskId);
    if (task.identity.lease.lease_id !== leaseId) throw new Error('lease mismatch');
    task.revoked = true;
  }

  async submit(hostContext: { session_id: string; lease_id: string }, input: unknown): Promise<DeepReadonly<HandoffEnvelope>> {
    const host = HostSubmissionContextSchema.parse(hostContext);
    const task = this.task(this.session(host.session_id).taskId);
    this.activeLease(task, host.lease_id);
    const payload = freezeData(HandoffSubmissionSchema.parse(input));
    if (!task.identity.responsibility_set.includes(payload.responsibility)) throw new Error('responsibility is outside the task responsibility_set');
    for (const ref of handoffRefs(payload)) {
      if (await this.options.verifyArtifact(ref) !== true) throw new Error('immutable artifact verification failed');
    }
    // Verification may await I/O: expiry/revocation still wins before acceptance.
    this.activeLease(task, host.lease_id);
    return freezeData(HandoffEnvelopeSchema.parse({ ...payload, task_id: task.identity.task_id, attempt_id: task.identity.attempt_id }));
  }

  private task(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('unknown task');
    return task;
  }

  private session(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('unbound session');
    return session;
  }

  private activeLease(task: TaskRecord, leaseId?: string): void {
    if (leaseId !== undefined && task.identity.lease.lease_id !== leaseId) throw new Error('lease mismatch');
    if (task.revoked) throw new Error('lease revoked');
    if (Date.parse(task.expiresAt) <= this.now()) throw new Error('lease expired');
  }
}

function handoffRefs(payload: DeepReadonly<HandoffSubmission>): Array<DeepReadonly<ImmutableArtifactRef>> {
  const refs = [...payload.input_refs, ...payload.observation_refs, ...payload.evidence_refs,
    ...payload.assumptions.flatMap(value => value.basis_refs), ...payload.rejected_assumptions.flatMap(value => value.basis_refs),
    ...payload.outputs.flatMap(value => value.kind === 'artifact' ? [value.ref] : value.basis_refs)];
  // Deduplicate exact refs, not just hashes: a different path/size must be verified too.
  return [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()];
}
