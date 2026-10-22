// Control service (design v1 C): lives in the launcher process, owns the session binding table, the run budget
// ledger, the role capability table and the stop sequence. The product plugin inside OpenCode only forwards hook
// events here and obeys the reply. Every failure path is a denial; denial messages are fixed short codes and never
// contain words OpenCode could classify as retryable.
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';

export const ROLES = ['coordinator', 'intake', 'recon', 'reference', 'strategy', 'domain-solver', 'engineer', 'verifier', 'recovery-critic'] as const;
export type Role = typeof ROLES[number];
const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** C design section 5: only the coordinator dispatches, and it may dispatch every other role. */
const DISPATCH: Partial<Record<Role, readonly Role[]>> = { coordinator: ROLES.filter(role => role !== 'coordinator') };
/** First-version native capability table (managed tools are not part of this step, so every other tool is denied). */
const NATIVE_TOOL_ROLES: Record<string, readonly Role[]> = { skill: ROLES, read: ROLES, task: ['coordinator'] };

export class ControlDenied extends Error {
  constructor(code: string, readonly detail?: string) { super(code === 'budget' ? 'budget denied' : `denied: ${code}`); }
}

export interface RunBudget {
  /** Upper bound on admitted model calls (release profile `maxSteps`, transitional mapping). */
  maxModelCalls: number;
  /** Upper bound on observed input+output+reasoning tokens (release profile `maxObservableTokens`). */
  maxObservableTokens: number;
}

export interface Binding {
  sessionID: string;
  role: Role;
  parentID: string | null;
  via: 'root' | 'dispatch';
  dispatchCallID?: string;
  scope: 'run';
  expiresAt: number;
  state: 'active' | 'stopped' | 'revoked';
  boundAt: number;
}

export interface AuditRecord {
  seq: number;
  t: number;
  /** Epoch ms, comparable with other processes' clocks (stub provider request times). */
  at: number;
  sessionID: string;
  op: string;
  allow: boolean;
  reason?: string;
  detail?: unknown;
}

export interface SessionUsage {
  assistantMessages: number;
  availability: 'reported' | 'unavailable';
  input: number;
  output: number;
  reasoning: number;
  /** An assistant message was aborted or never completed, so its usage may have been replaced by zero. */
  incomplete: boolean;
}

interface Message { info: { role: string; tokens?: { input: number; output: number; reasoning: number }; error?: { name?: string }; time?: { completed?: number } } }

export function summarizeUsage(messages: Message[]): SessionUsage {
  const usage: SessionUsage = { assistantMessages: 0, availability: 'unavailable', input: 0, output: 0, reasoning: 0, incomplete: false };
  for (const { info } of messages) {
    if (info.role !== 'assistant') continue;
    usage.assistantMessages++;
    if (info.tokens) { usage.availability = 'reported'; usage.input += info.tokens.input; usage.output += info.tokens.output; usage.reasoning += info.tokens.reasoning; }
    if (info.error?.name === 'MessageAbortedError' || info.time?.completed === undefined) usage.incomplete = true;
  }
  return usage;
}

export interface ControlOptions {
  client: OpencodeClient;
  budget: RunBudget;
  /** Absolute time (epoch ms) after which every binding lapses. */
  expiresAt: number;
  /** OpenCode working directory; relative `read` paths resolve against it. */
  workdir: string;
  /** Skill copy directory of this run; the only tree `read` may reach in this version. */
  skillRoot: string;
}

export class ControlService {
  readonly bindings = new Map<string, Binding>();
  readonly audit: AuditRecord[] = [];
  stopReason?: string;
  rootId?: string;
  admitted = 0;
  private seq = 0;
  /** Epoch ms of construction; audit `t` is relative to it. */
  readonly startedAt = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private stopping?: Promise<void>;
  private readonly pending = new Map<string, Map<Role, { callID: string }>>();
  private readonly dispatched = new Map<string, { parent: string; role: Role }>();
  private observedTokens = 0;

  constructor(private readonly options: ControlOptions) {}

  /** Root session is bound by the launcher itself before the start message is sent. */
  bindRoot(sessionID: string): void {
    if (this.rootId) throw new Error('root session already bound');
    this.rootId = sessionID;
    this.bindings.set(sessionID, { sessionID, role: 'coordinator', parentID: null, via: 'root', scope: 'run',
      expiresAt: this.options.expiresAt, state: 'active', boundAt: Date.now() });
    this.record(sessionID, 'bind', true, undefined, { role: 'coordinator', via: 'root' });
  }

  /** Entry point of the RPC. Requests are handled one at a time so concurrent sessions cannot spend the same quota twice. */
  handle(sessionID: string, operation: string, input: unknown): Promise<unknown> {
    const run = this.tail.then(async () => {
      try {
        const result = await this.decide(sessionID, operation, input);
        const tool = (input as { tool?: unknown } | null)?.tool;
        this.record(sessionID, operation, true, undefined, operation === 'model.call' ? result : operation === 'tool.before' || operation === 'tool.after' ? { tool } : undefined);
        return result;
      } catch (error) {
        const denied = error instanceof ControlDenied ? error : new ControlDenied('control error', String(error));
        this.record(sessionID, operation, false, denied.message, denied.detail);
        throw denied;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Mark first, then abort, so an in-flight tool call is refused at its next hook (C design section 6). */
  stopAll(reason: string): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopReason = reason;
    for (const binding of this.bindings.values()) if (binding.state === 'active') binding.state = 'stopped';
    this.record(this.rootId ?? '', 'stop_marked', true, undefined, { reason, sessions: [...this.bindings.keys()] });
    this.stopping = (async () => {
      const all = new Set(this.bindings.keys());
      try { if (this.rootId) for (const id of await this.descendants(this.rootId)) all.add(id); } catch { /* abort what is known */ }
      this.record(this.rootId ?? '', 'stop_enumerated', true, undefined, { sessions: [...all] });
      await Promise.all([...all].map(id => this.options.client.session.abort({ sessionID: id }).catch(() => undefined)));
      this.record(this.rootId ?? '', 'aborted', true, undefined, { sessions: [...all] });
    })();
    return this.stopping;
  }

  /** Withdraw one child; its later hooks are refused. */
  async revoke(sessionID: string): Promise<void> {
    const binding = this.bindings.get(sessionID);
    if (!binding || binding.via === 'root') throw new Error('only a bound child can be revoked');
    binding.state = 'revoked';
    this.record(sessionID, 'revoke', true);
    await this.options.client.session.abort({ sessionID }).catch(() => undefined);
  }

  /** Refreshes the observed token count and stops the run once the limit is reached. */
  async checkBudget(): Promise<void> {
    if (this.stopReason) return;
    await this.refreshObserved();
    if (this.observedTokens >= this.options.budget.maxObservableTokens) {
      this.record(this.rootId ?? '', 'budget_reached', true, undefined, { observedTokens: this.observedTokens });
      void this.stopAll('budget');
    }
  }

  get observed(): number { return this.observedTokens; }

  private record(sessionID: string, op: string, allow: boolean, reason?: string, detail?: unknown): void {
    this.audit.push({ seq: ++this.seq, t: Date.now() - this.startedAt, at: Date.now(), sessionID, op, allow,
      ...(reason ? { reason } : {}), ...(detail === undefined ? {} : { detail }) });
  }

  private async descendants(id: string): Promise<string[]> {
    const children = (await this.options.client.session.children({ sessionID: id }, { throwOnError: true })).data ?? [];
    return [...children.map(c => c.id), ...(await Promise.all(children.map(c => this.descendants(c.id)))).flat()];
  }

  private async refreshObserved(): Promise<void> {
    let total = 0;
    for (const id of this.bindings.keys()) {
      const messages = (await this.options.client.session.messages({ sessionID: id }, { throwOnError: true })).data ?? [];
      const usage = summarizeUsage(messages as Message[]);
      total += usage.input + usage.output + usage.reasoning;
    }
    this.observedTokens = total;
  }

  private live(binding: Binding): void {
    if (binding.state !== 'active') throw new ControlDenied(binding.state === 'stopped' ? 'run stopped' : 'session revoked');
    if (Date.now() >= binding.expiresAt) throw new ControlDenied('binding lapsed');
  }

  private async decide(sessionID: string, operation: string, input: unknown): Promise<unknown> {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (!sessionID) throw new ControlDenied('unbound session');
    if (operation === 'tool.after') return this.toolAfter(sessionID, body);
    if (!['chat.message', 'model.call', 'tool.before', 'tool.execute'].includes(operation)) throw new ControlDenied('unknown operation');
    const hookAgent = typeof body.agent === 'string' ? body.agent : undefined;
    const binding = this.bindings.get(sessionID) ?? await this.bindFromSdk(sessionID, hookAgent);
    this.live(binding);
    if (hookAgent !== undefined && hookAgent !== binding.role) throw new ControlDenied('agent mismatch');
    switch (operation) {
      case 'chat.message': return { bound: true };
      case 'model.call': return this.admit(binding);
      case 'tool.before': return this.toolBefore(binding, body);
      default: throw new ControlDenied('no managed tools'); // tool.execute: managed tools are not provided in this version
    }
  }

  /** C design section 3.2: first hook of an unknown session; facts come only from the launcher's own SDK queries. */
  private async bindFromSdk(sessionID: string, hookAgent: string | undefined): Promise<Binding> {
    if (this.stopReason) throw new ControlDenied('run stopped');
    const started = Date.now();
    let info: { parentID?: string; agent?: string } | undefined;
    try { info = (await this.options.client.session.get({ sessionID }, { throwOnError: true })).data; } catch { throw new ControlDenied('unbound session', 'session lookup failed'); }
    const sdkMs = Date.now() - started;
    const fail = (detail: string) => new ControlDenied('unbound session', JSON.stringify({ detail, sdkParentID: info?.parentID ?? null, sdkAgent: info?.agent ?? null }));
    if (!info?.parentID) throw fail('no parent');
    const parent = this.bindings.get(info.parentID);
    if (!parent) throw fail('parent not bound');
    this.live(parent);
    if (!isRole(info.agent)) throw fail('agent is not a product role');
    if (hookAgent !== undefined && hookAgent !== info.agent) throw fail('hook agent differs from SDK agent');
    const waiting = this.pending.get(info.parentID)?.get(info.agent);
    if (!waiting) throw fail('no pending dispatch');
    this.pending.get(info.parentID)!.delete(info.agent);
    const binding: Binding = { sessionID, role: info.agent, parentID: info.parentID, via: 'dispatch', dispatchCallID: waiting.callID, scope: 'run',
      expiresAt: this.options.expiresAt, state: 'active', boundAt: Date.now() };
    this.bindings.set(sessionID, binding);
    this.dispatched.set(sessionID, { parent: info.parentID, role: info.agent });
    this.record(sessionID, 'bind', true, undefined, { role: binding.role, via: 'dispatch', sdkParentID: info.parentID, sdkAgent: info.agent, callID: waiting.callID, sdkMs });
    return binding;
  }

  private async admit(binding: Binding): Promise<{ maxOutputTokens: number; admitNo: number; role: Role }> {
    this.releasePending(binding.sessionID);
    try { await this.refreshObserved(); } catch { throw new ControlDenied('usage unavailable'); }
    const { maxModelCalls, maxObservableTokens } = this.options.budget;
    if (this.admitted >= maxModelCalls || this.observedTokens >= maxObservableTokens) {
      void this.stopAll('budget');
      throw new ControlDenied('budget', JSON.stringify({ admitted: this.admitted, observedTokens: this.observedTokens }));
    }
    this.admitted++;
    return { maxOutputTokens: maxObservableTokens - this.observedTokens, admitNo: this.admitted, role: binding.role };
  }

  private async toolBefore(binding: Binding, body: Record<string, unknown>): Promise<unknown> {
    const tool = typeof body.tool === 'string' ? body.tool : '';
    const allowed = Object.hasOwn(NATIVE_TOOL_ROLES, tool) && NATIVE_TOOL_ROLES[tool]!.includes(binding.role);
    if (!allowed) throw new ControlDenied('tool not permitted', tool);
    const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;
    if (tool === 'read') await this.checkReadPath(args);
    if (tool === 'task') this.registerDispatch(binding, typeof body.callID === 'string' ? body.callID : '', args);
    return { allowed: true };
  }

  private async checkReadPath(args: Record<string, unknown>): Promise<void> {
    const raw = typeof args.filePath === 'string' ? args.filePath : typeof args.path === 'string' ? args.path : '';
    if (!raw) throw new ControlDenied('read path');
    let target: string;
    let root: string;
    try {
      target = await realpath(isAbsolute(raw) ? raw : resolve(this.options.workdir, raw));
      root = await realpath(this.options.skillRoot);
    } catch { throw new ControlDenied('read path'); }
    if (target !== root && !target.startsWith(root + sep)) throw new ControlDenied('read path');
  }

  /** C design section 3.1: dispatch table, task_id ownership, one pending dispatch per parent and role. */
  private registerDispatch(binding: Binding, callID: string, args: Record<string, unknown>): void {
    const role = args.subagent_type;
    if (!isRole(role) || !DISPATCH[binding.role]?.includes(role)) throw new ControlDenied('dispatch', 'role not dispatchable');
    if (!callID) throw new ControlDenied('dispatch', 'missing call id');
    const taskId = args.task_id;
    if (taskId !== undefined && taskId !== null && taskId !== '') {
      const owned = typeof taskId === 'string' ? this.dispatched.get(taskId) : undefined;
      const child = typeof taskId === 'string' ? this.bindings.get(taskId) : undefined;
      if (!owned || owned.parent !== binding.sessionID || owned.role !== role || child?.state !== 'active') throw new ControlDenied('dispatch', 'task id not owned');
      return;
    }
    const byRole = this.pending.get(binding.sessionID) ?? new Map();
    if (byRole.has(role)) throw new ControlDenied('dispatch', 'pending dispatch exists for role');
    byRole.set(role, { callID });
    this.pending.set(binding.sessionID, byRole);
  }

  /**
   * C design section 3.1 release rule: OpenCode asks for the next model call only after every tool call of the
   * previous round returned, so a parent's unconsumed pending dispatches are over once it asks for admission again.
   * Runs before the budget check, so a refused admission releases them too.
   */
  private releasePending(parent: string): void {
    const waiting = this.pending.get(parent);
    if (!waiting?.size) return;
    this.record(parent, 'dispatch.release', true, undefined, { released: [...waiting].map(([role, w]) => ({ role, callID: w.callID })) });
    waiting.clear();
  }

  /** Audit correlation only: ties the task call to the child session reported by OpenCode, and releases an unconsumed pending slot. */
  private toolAfter(sessionID: string, body: Record<string, unknown>): { ok: true } {
    if (body.tool === 'task') {
      const metadata = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>;
      const child = typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined;
      const callID = typeof body.callID === 'string' ? body.callID : '';
      this.record(sessionID, 'task.correlate', true, undefined, { callID, childSessionID: child ?? null,
        childBoundToCaller: child ? this.bindings.get(child)?.parentID === sessionID : false });
      for (const [role, waiting] of this.pending.get(sessionID) ?? []) if (waiting.callID === callID) this.pending.get(sessionID)!.delete(role);
    }
    return { ok: true };
  }
}
