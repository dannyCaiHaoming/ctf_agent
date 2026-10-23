// Control service (design v1 C): lives in the launcher process, owns the session binding table, the run budget
// ledger, the role capability table and the stop sequence. The product plugin inside OpenCode only forwards hook
// events here and obeys the reply. Every failure path is a denial; denial messages are fixed short codes and never
// contain words OpenCode could classify as retryable.
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { INTAKE_TOOLS, IntakeRefused, checkMaterialPath, findChallenge, listChallenges, readMaterial } from './intake-tools.js';
import type { PreparedChallenge } from './run-prep.js';

export const ROLES = ['coordinator', 'intake', 'recon', 'reference', 'strategy', 'domain-solver', 'engineer', 'verifier', 'recovery-critic'] as const;
export type Role = typeof ROLES[number];
const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** C design section 5: only the coordinator dispatches, and it may dispatch every other role. */
const DISPATCH: Partial<Record<Role, readonly Role[]>> = { coordinator: ROLES.filter(role => role !== 'coordinator') };
/** First-version native capability table (managed tools are not part of this step, so every other tool is denied). */
const NATIVE_TOOL_ROLES: Record<string, readonly Role[]> = { skill: ROLES, read: ROLES, task: ['coordinator'] };

/** Managed intake tools (E design section 4): OpenCode reports them under their plugin ids, the plugin executes them under their names. */
const INTAKE_BY_ID = new Map(INTAKE_TOOLS.map(name => [`ctf_${name.replaceAll('.', '_')}`, name]));

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

export interface Message { info: { id?: string; sessionID?: string; role: string; tokens?: { input: number; output: number; reasoning: number }; error?: { name?: string }; time?: { completed?: number } } }

const validTokens = (tokens: Message['info']['tokens']): tokens is NonNullable<Message['info']['tokens']> =>
  !!tokens && [tokens.input, tokens.output, tokens.reasoning].every(n => Number.isFinite(n) && n >= 0);

export function summarizeUsage(messages: Message[]): SessionUsage {
  const usage: SessionUsage = { assistantMessages: 0, availability: 'unavailable', input: 0, output: 0, reasoning: 0, incomplete: false };
  for (const { info } of messages) {
    if (info.role !== 'assistant') continue;
    usage.assistantMessages++;
    if (validTokens(info.tokens)) { usage.availability = 'reported'; usage.input += info.tokens.input; usage.output += info.tokens.output; usage.reasoning += info.tokens.reasoning; }
    if (!validTokens(info.tokens) || info.error?.name === 'MessageAbortedError' || info.time?.completed === undefined) usage.incomplete = true;
  }
  if (!usage.assistantMessages) usage.incomplete = true;
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
  /** Challenges pinned by run preparation; the scope of the intake tools. Absent means none. */
  challenges?: PreparedChallenge[];
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
  private readonly usageMessages = new Map<string, Map<string, Message>>();
  private readonly usageGaps = new Set<string>();

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
      // Visit incrementally: one failing subtree must not discard already discovered siblings.
      const visited = new Set<string>();
      const visit = async (id: string): Promise<void> => {
        if (visited.has(id)) return;
        visited.add(id);
        try {
          const children = (await this.options.client.session.children({ sessionID: id }, { throwOnError: true })).data;
          if (!children) throw new Error('children unavailable');
          for (const child of children) {
            all.add(child.id);
            await visit(child.id);
          }
        } catch (error) { this.record(id, 'stop_enumerated', false, 'session enumeration failed', String(error)); }
      };
      if (this.rootId) await visit(this.rootId);
      this.record(this.rootId ?? '', 'stop_enumerated', true, undefined, { sessions: [...all] });
      await Promise.all([...all].map(id => this.abortSession(id)));
    })();
    return this.stopping;
  }

  /** Withdraw one child; its later hooks are refused. */
  async revoke(sessionID: string): Promise<void> {
    const binding = this.bindings.get(sessionID);
    if (!binding || binding.via === 'root') throw new Error('only a bound child can be revoked');
    binding.state = 'revoked';
    this.record(sessionID, 'revoke', true);
    await this.abortSession(sessionID);
  }

  private async abortSession(sessionID: string): Promise<void> {
    try {
      const result = await this.options.client.session.abort({ sessionID }, { throwOnError: true });
      if (result.data !== true) throw new Error('abort result unavailable or refused');
      this.record(sessionID, 'aborted', true);
    } catch (error) { this.record(sessionID, 'aborted', false, 'abort failed', String(error)); }
  }

  /** Refreshes the observed token count and stops the run once the limit is reached. */
  async checkBudget(): Promise<void> {
    if (this.stopReason) return;
    await this.refreshObserved();
    if (this.observed >= this.options.budget.maxObservableTokens) {
      this.record(this.rootId ?? '', 'budget_reached', true, undefined, { observedTokens: this.observed });
      void this.stopAll('budget');
    }
  }

  get observed(): number {
    const total = this.usageSnapshot().total;
    return total.input + total.output + total.reasoning;
  }

  /** SDK identities only; a later aborted/empty reading cannot erase previously reported consumption. */
  observeUsage(sessionID: string, messages: Message[]): void {
    if (!this.bindings.has(sessionID)) throw new Error('usage session not bound');
    const known = this.usageMessages.get(sessionID) ?? new Map<string, Message>();
    this.usageMessages.set(sessionID, known);
    const seen = new Set<string>();
    for (const message of messages) {
      const { info } = message;
      if (info.role !== 'assistant') continue;
      if (!info.id || info.sessionID !== sessionID) { this.usageGaps.add(sessionID); continue; }
      seen.add(info.id);
      const previous = known.get(info.id)?.info;
      const tokens = validTokens(info.tokens) ? {
        input: Math.max(previous?.tokens?.input ?? 0, info.tokens.input),
        output: Math.max(previous?.tokens?.output ?? 0, info.tokens.output),
        reasoning: Math.max(previous?.tokens?.reasoning ?? 0, info.tokens.reasoning)
      } : undefined;
      if ((!validTokens(info.tokens) && info.tokens !== undefined) || (!info.tokens && previous?.tokens) || info.error) this.usageGaps.add(sessionID);
      known.set(info.id, { info: { ...info, tokens: tokens ?? previous?.tokens } });
    }
    if ([...known.keys()].some(id => !seen.has(id))) this.usageGaps.add(sessionID);
  }

  /** A failed SDK read leaves known usage intact and makes the snapshot a lower bound. */
  markUsageIncomplete(sessionID: string): void {
    if (!this.bindings.has(sessionID)) throw new Error('usage session not bound');
    this.usageGaps.add(sessionID);
  }

  usageSnapshot(): { sessions: Record<string, SessionUsage>; total: SessionUsage } {
    const sessions: Record<string, SessionUsage> = {};
    const total: SessionUsage = { assistantMessages: 0, availability: 'unavailable', input: 0, output: 0, reasoning: 0, incomplete: false };
    for (const id of this.bindings.keys()) {
      const usage = summarizeUsage([...(this.usageMessages.get(id)?.values() ?? [])]);
      usage.incomplete ||= this.usageGaps.has(id);
      sessions[id] = usage;
      total.assistantMessages += usage.assistantMessages;
      total.input += usage.input; total.output += usage.output; total.reasoning += usage.reasoning;
      total.incomplete ||= usage.incomplete;
      if (usage.availability === 'reported') total.availability = 'reported';
    }
    if (!this.bindings.size) total.incomplete = true;
    return { sessions, total };
  }

  private record(sessionID: string, op: string, allow: boolean, reason?: string, detail?: unknown): void {
    this.audit.push({ seq: ++this.seq, t: Date.now() - this.startedAt, at: Date.now(), sessionID, op, allow,
      ...(reason ? { reason } : {}), ...(detail === undefined ? {} : { detail }) });
  }

  private async refreshObserved(): Promise<void> {
    for (const id of this.bindings.keys()) {
      try {
        const messages = (await this.options.client.session.messages({ sessionID: id }, { throwOnError: true })).data;
        if (!messages) this.markUsageIncomplete(id);
        else this.observeUsage(id, messages as Message[]);
      } catch (error) {
        this.markUsageIncomplete(id);
        this.record(id, 'usage.read', false, 'usage unavailable', String(error));
        throw error;
      }
    }
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
      default: return this.executeManaged(binding, body); // tool.execute
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
    // Stop, revocation or expiry may have occurred while the SDK usage query was pending.
    if (this.stopReason) throw new ControlDenied('run stopped');
    this.live(binding);
    const { maxModelCalls, maxObservableTokens } = this.options.budget;
    if (this.admitted >= maxModelCalls || this.observed >= maxObservableTokens) {
      void this.stopAll('budget');
      throw new ControlDenied('budget', JSON.stringify({ admitted: this.admitted, observedTokens: this.observed }));
    }
    this.admitted++;
    return { maxOutputTokens: maxObservableTokens - this.observed, admitNo: this.admitted, role: binding.role };
  }

  private async toolBefore(binding: Binding, body: Record<string, unknown>): Promise<unknown> {
    const tool = typeof body.tool === 'string' ? body.tool : '';
    const intake = INTAKE_BY_ID.get(tool);
    if (intake) { this.checkIntake(binding, intake, body.args); return { allowed: true }; }
    const allowed = Object.hasOwn(NATIVE_TOOL_ROLES, tool) && NATIVE_TOOL_ROLES[tool]!.includes(binding.role);
    if (!allowed) throw new ControlDenied('tool not permitted', tool);
    const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;
    if (tool === 'read') await this.checkReadPath(args);
    if (tool === 'task') this.registerDispatch(binding, typeof body.callID === 'string' ? body.callID : '', args);
    return { allowed: true };
  }

  /** Both layers (tool.before and tool.execute) run this: role must be intake, the challenge must belong to this run. */
  private checkIntake(binding: Binding, name: string, rawArgs: unknown): Record<string, unknown> {
    if (binding.role !== 'intake') throw new ControlDenied('tool not permitted', name);
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
    if (name === 'challenge.read') {
      try { findChallenge(this.options.challenges ?? [], args.id); checkMaterialPath(args.path); } catch (error) { throw this.refusal(error); }
    }
    return args;
  }

  private refusal(error: unknown): ControlDenied { return new ControlDenied(error instanceof IntakeRefused ? error.code : 'control error'); }

  private async executeManaged(binding: Binding, body: Record<string, unknown>): Promise<unknown> {
    const name = typeof body.tool === 'string' ? body.tool : '';
    if (!INTAKE_TOOLS.includes(name)) throw new ControlDenied('no managed tools');
    const args = this.checkIntake(binding, name, body.args);
    const challenges = this.options.challenges ?? [];
    try { return name === 'challenge.list' ? listChallenges(challenges) : await readMaterial(challenges, args); } catch (error) { throw this.refusal(error); }
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
