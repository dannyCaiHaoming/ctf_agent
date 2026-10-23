// Control service (design v1 C): lives in the launcher process, owns the session binding table, the run budget
// ledger, the role capability table and the stop sequence. The product plugin inside OpenCode only forwards hook
// events here and obeys the reply. Every failure path is a denial; denial messages are fixed short codes and never
// contain words OpenCode could classify as retryable.
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { INTAKE_TOOLS, IntakeRefused, checkMaterialPath, findChallenge, listChallenges, readMaterial } from './intake-tools.js';
import { createHttpTools, CookieJar, HttpRefused } from './http-tools.js';
import { JobManager, JobRefused, type JobBinding } from './job-tools.js';
import { listWorkspace, readWorkspace, searchWorkspace, writeWorkspace, WorkspaceRefused, type WorkspaceRoots } from './workspace-tools.js';
import type { PreparedChallenge } from './run-prep.js';

export const ROLES = ['coordinator', 'intake', 'recon', 'reference', 'strategy', 'domain-solver', 'engineer', 'verifier', 'recovery-critic'] as const;
export type Role = typeof ROLES[number];
const CHALLENGE_ROLES: readonly Role[] = ['recon', 'domain-solver', 'engineer', 'verifier'];
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
  challengeId?: string;
  workDir?: string;
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

export const SOLVER_TOOLS = ['workspace.list', 'workspace.read', 'workspace.search', 'workspace.write', 'http.request', 'job.run', 'job.read', 'job.cancel'];
export const MANAGED_TOOLS = [...INTAKE_TOOLS, 'challenge.assign', 'challenge.unassign', 'task.stop', ...SOLVER_TOOLS];
interface Resource { run: string; sessionID: string; challengeId: string; callID: string; tool: string; state: 'active' | 'settled' | 'unknown'; result?: string; job?: string; controller: AbortController; deadline: number; timer?: ReturnType<typeof setTimeout>; done?: Promise<unknown>; detachRpc?: () => void }
interface TaskStopResult { state: 'stopped' | 'unknown'; resources: 'settled' | 'unknown'; sessionAbort: 'confirmed' | 'unknown' }
interface Outside { execute: () => Promise<unknown> }

export interface ControlOptions {
  runId?: string;
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
  private readonly pending = new Map<string, Map<Role, { callID: string; challengeId?: string }>>();
  private readonly declarations = new Map<string, Map<Role, string>>();
  private readonly childStops = new Map<string, Promise<TaskStopResult>>();
  private readonly dispatched = new Map<string, { parent: string; role: Role }>();
  private readonly usageMessages = new Map<string, Map<string, Message>>();
  private readonly usageGaps = new Set<string>();

  private readonly resources = new Map<string, Resource>();
  private readonly http = new Map<string, ReturnType<typeof createHttpTools>>();
  private readonly jars = new Map<string, CookieJar>();
  private readonly jobs: JobManager;
  private readonly rootsReady = new Map<string, Promise<void>>();
  constructor(private readonly options: ControlOptions) { this.jobs = new JobManager({ jobsRoot: join(options.workdir, '..', 'state', 'jobs') }); }

  resourceSnapshot() { return [...this.resources.values()].map(({ controller: _c, timer: _t, done: _d, detachRpc: _detach, ...record }) => record); }
  private serial<T>(fn: () => T): Promise<T> {
    const result = this.tail.then(fn); this.tail = result.catch(() => undefined); return result;
  }


  /** Root session is bound by the launcher itself before the start message is sent. */
  bindRoot(sessionID: string): void {
    if (this.rootId) throw new Error('root session already bound');
    this.rootId = sessionID;
    this.bindings.set(sessionID, { sessionID, role: 'coordinator', parentID: null, via: 'root', scope: 'run',
      expiresAt: this.options.expiresAt, state: 'active', boundAt: Date.now() });
    this.record(sessionID, 'bind', true, undefined, { role: 'coordinator', via: 'root' });
  }

  /** Only trusted state transitions use the queue. SDK, filesystem and resource waits happen outside it. */
  async handle(sessionID: string, operation: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    try {
      if (!sessionID || !/^[\w.-]{1,128}$/.test(sessionID)) throw new ControlDenied('unbound session');
      if (!['chat.message', 'model.call', 'tool.before', 'tool.execute', 'tool.after'].includes(operation)) throw new ControlDenied('unknown operation');
      let binding: Binding | undefined;
      if (operation !== 'tool.after') {
        const hookAgent = typeof body.agent === 'string' ? body.agent : undefined;
        binding = this.bindings.get(sessionID) ?? await this.bindFromSdk(sessionID, hookAgent);
        this.live(binding);
        if (binding.challengeId) await this.initializeRoots(binding);
        if (hookAgent !== undefined && hookAgent !== binding.role) throw new ControlDenied('agent mismatch');
        if (operation === 'model.call') {
          try { await this.refreshObserved(); } catch { throw new ControlDenied('usage unavailable'); }
        }
        if (operation === 'tool.before' && body.tool === 'read') await this.checkReadPath((body.args ?? {}) as Record<string, unknown>);
      }
      const prepared = await this.serial(() => {
        if (signal?.aborted) throw new ControlDenied('rpc abandoned');
        if (operation === 'tool.after') return this.toolAfter(sessionID, body);
        if (this.stopReason) throw new ControlDenied('run stopped');
        this.live(binding!);
        switch (operation) {
          case 'chat.message': return { bound: true };
          case 'model.call': return this.admit(binding!);
          case 'tool.before': return this.toolBefore(binding!, body);
          default: return this.executeManaged(binding!, body, signal);
        }
      });
      const result = prepared && typeof prepared === 'object' && 'execute' in prepared ? await (prepared as Outside).execute() : prepared;
      this.record(sessionID, operation, true, undefined, operation === 'model.call' ? result : { tool: body.tool, callID: body.callID, result: 'returned' });
      return result;
    } catch (error) {
      const denied = error instanceof ControlDenied ? error : new ControlDenied(error instanceof HttpRefused || error instanceof JobRefused || error instanceof WorkspaceRefused ? error.code : 'control error', String(error));
      this.record(sessionID, operation, false, denied.message, { tool: body.tool, callID: body.callID, error: denied.detail }); throw denied;
    }
  }

  /** Mark first, then abort, so an in-flight tool call is refused at its next hook (C design section 6). */
  stopAll(reason: string): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopReason = reason;
    this.declarations.clear();
    this.pending.clear();
    for (const binding of this.bindings.values()) if (binding.state === 'active') binding.state = 'stopped';
    this.record(this.rootId ?? '', 'stop_marked', true, undefined, { reason, sessions: [...this.bindings.keys()] });
    const resources = this.cancelResources();
    this.stopping = (async () => {
      await resources;
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
    await this.stopChild(binding);
  }

  private checkTaskStop(parent: Binding, raw: unknown): Binding {
    if (parent.role !== 'coordinator') throw new ControlDenied('tool not permitted');
    const id = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const child = typeof id.task_id === 'string' ? this.bindings.get(id.task_id) : undefined;
    const dispatch = child && this.dispatched.get(child.sessionID);
    if (!child || child.via !== 'dispatch' || child.parentID !== parent.sessionID ||
      !dispatch || dispatch.parent !== parent.sessionID || dispatch.role !== child.role) throw new ControlDenied('task handle');
    if (Date.now() >= child.expiresAt) throw new ControlDenied('task expired');
    if (child.state !== 'active' && !this.childStops.has(child.sessionID)) throw new ControlDenied('task handle');
    return child;
  }

  private stopChild(child: Binding): Promise<TaskStopResult> {
    const existing = this.childStops.get(child.sessionID); if (existing) return existing;
    child.state = 'revoked';
    this.clearDispatchState(child.sessionID);
    this.record(child.sessionID, 'revoke', true);
    const stopped = (async (): Promise<TaskStopResult> => {
      await this.cancelResources(child.sessionID);
      const confirmed = await this.abortSession(child.sessionID, 4000);
      const resources = this.resourceSnapshot().some(r => r.sessionID === child.sessionID && r.state !== 'settled') ? 'unknown' : 'settled';
      const result: TaskStopResult = { state: resources === 'settled' && confirmed ? 'stopped' : 'unknown', resources, sessionAbort: confirmed ? 'confirmed' : 'unknown' };
      this.record(child.sessionID, 'task.stop.result', result.state === 'stopped', undefined, result);
      return result;
    })();
    this.childStops.set(child.sessionID, stopped); return stopped;
  }

  private async abortSession(sessionID: string, timeoutMs?: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const abort = this.options.client.session.abort({ sessionID }, { throwOnError: true, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
      const result = timeoutMs ? await Promise.race([abort, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('abort result unknown')), timeoutMs); })]) : await abort;
      if (result.data !== true) throw new Error('abort result unavailable or refused');
      this.record(sessionID, 'aborted', true); return true;
    } catch (error) { this.record(sessionID, 'aborted', false, 'abort failed', String(error)); return false; } finally { clearTimeout(timeout); }
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

  private clearDispatchState(sessionID: string): void {
    this.declarations.delete(sessionID);
    this.pending.delete(sessionID);
  }

  private live(binding: Binding): void {
    if (binding.state !== 'active' || Date.now() >= binding.expiresAt) this.clearDispatchState(binding.sessionID);
    if (binding.state !== 'active') throw new ControlDenied(binding.state === 'stopped' ? 'run stopped' : 'session revoked');
    if (Date.now() >= binding.expiresAt) throw new ControlDenied('binding lapsed');
  }

  /** C design section 3.2: first hook of an unknown session; facts come only from the launcher's own SDK queries. */
  private async bindFromSdk(sessionID: string, hookAgent: string | undefined): Promise<Binding> {
    if (this.stopReason) throw new ControlDenied('run stopped');
    const started = Date.now();
    let info: { parentID?: string; agent?: string } | undefined;
    try { info = (await this.options.client.session.get({ sessionID }, { throwOnError: true })).data; } catch { throw new ControlDenied('unbound session', 'session lookup failed'); }
    return this.serial(() => {
    if (this.stopReason) throw new ControlDenied('run stopped');
    const already = this.bindings.get(sessionID); if (already) { this.live(already); return already; }
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
    const binding: Binding = { sessionID, role: info.agent, parentID: info.parentID, via: 'dispatch', dispatchCallID: waiting.callID, challengeId: waiting.challengeId, scope: 'run',
      expiresAt: this.options.expiresAt, state: 'active', boundAt: Date.now() };
    if (binding.challengeId) binding.workDir = this.roots(binding).workDir;
    this.bindings.set(sessionID, binding);
    this.dispatched.set(sessionID, { parent: info.parentID, role: info.agent });
    this.record(sessionID, 'bind', true, undefined, { role: binding.role, via: 'dispatch', sdkParentID: info.parentID, sdkAgent: info.agent, callID: waiting.callID, challengeId: waiting.challengeId, sdkMs });
    return binding;
    });
  }

  private admit(binding: Binding): { maxOutputTokens: number; admitNo: number; role: Role } {
    this.releasePending(binding.sessionID);
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

  private toolBefore(binding: Binding, body: Record<string, unknown>): unknown {
    const tool = typeof body.tool === 'string' ? body.tool : '';
    if (tool === 'ctf_challenge_assign' || tool === 'ctf_challenge_unassign') {
      this.checkDeclaration(binding, body.args, tool === 'ctf_challenge_assign');
      return { allowed: true }; // Precheck only: execution is the declaration's linearization point.
    }
    if (tool === 'ctf_task_stop') { this.checkTaskStop(binding, body.args); return { allowed: true, rpcTimeoutMs: 10000 }; }
    const managed = SOLVER_TOOLS.find(name => `ctf_${name.replaceAll('.', '_')}` === tool);
    if (managed) { this.checkSolver(binding, managed); return { allowed: true, rpcTimeoutMs: this.waitLimit(binding, managed, (body.args ?? {}) as Record<string, unknown>) + 5000 }; }
    const intake = INTAKE_BY_ID.get(tool);
    if (intake) { this.checkIntake(binding, intake, body.args); return { allowed: true }; }
    const allowed = Object.hasOwn(NATIVE_TOOL_ROLES, tool) && NATIVE_TOOL_ROLES[tool]!.includes(binding.role);
    if (!allowed) throw new ControlDenied('tool not permitted', tool);
    const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;

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

  private executeManaged(binding: Binding, body: Record<string, unknown>, signal?: AbortSignal): unknown {
    const name = typeof body.tool === 'string' ? body.tool : '';
    if (name === 'task.stop') {
      const child = this.checkTaskStop(binding, body.args);
      const alreadyStopped = this.childStops.has(child.sessionID);
      const stopped = this.stopChild(child);
      return { execute: async () => ({ ...await stopped, alreadyStopped }) };
    }
    if (name === 'challenge.assign' || name === 'challenge.unassign') {
      const { role, challenge } = this.checkDeclaration(binding, body.args, name === 'challenge.assign');
      this.live(binding);
      if (name === 'challenge.unassign') {
        const cleared = this.declarations.get(binding.sessionID)?.delete(role) ?? false;
        this.record(binding.sessionID, 'assign.clear', true, undefined, { role, cleared });
        return { cleared };
      }
      const declared = this.declarations.get(binding.sessionID) ?? new Map<Role, string>();
      declared.set(role, challenge!);
      this.declarations.set(binding.sessionID, declared);
      this.record(binding.sessionID, 'assign', true, undefined, { role, challenge });
      return { challenge };
    }
    if (SOLVER_TOOLS.includes(name)) return this.prepareSolver(binding, name, (body.args ?? {}) as Record<string, unknown>, body.callID, signal);
    if (!INTAKE_TOOLS.includes(name)) throw new ControlDenied('no managed tools');
    const args = this.checkIntake(binding, name, body.args);
    const challenges = this.options.challenges ?? [];
    if (name === 'challenge.list') return listChallenges(challenges);
    return { execute: async () => { try { return await readMaterial(challenges, args); } catch (error) { throw this.refusal(error); } } };
  }

  private checkSolver(binding: Binding, name: string): void {
    if (!binding.challengeId || !CHALLENGE_ROLES.includes(binding.role) ||
      (name === 'http.request' && !['recon', 'domain-solver'].includes(binding.role))) throw new ControlDenied('tool not permitted');
    if (!this.options.challenges?.some(c => c.id === binding.challengeId)) throw new ControlDenied('challenge outside run');
  }

  private waitLimit(binding: Binding, name: string, args: Record<string, unknown>): number {
    const bounded = (value: unknown, fallback: number, max: number, min = 1) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ControlDenied('tool timeout');
      return value;
    };
    const wait = name === 'http.request' ? bounded(args.timeout_ms, 15000, 60000) :
      name === 'job.run' ? bounded(args.wait_ms, 5000, 30000, 0) : name === 'job.cancel' ? 4000 : 15000;
    return Math.max(0, Math.min(wait, binding.expiresAt - Date.now()));
  }

  private prepareSolver(binding: Binding, name: string, args: Record<string, unknown>, call: unknown, rpcSignal?: AbortSignal): Outside {
    this.checkSolver(binding, name);
    if (typeof call !== 'string' || !/^[\w.-]{1,128}$/.test(call)) throw new ControlDenied('call id');
    const key = `${binding.sessionID}/${call}`;
    if (this.resources.has(key)) throw new ControlDenied('duplicate tool call');
    const active = [...this.resources.values()].filter(r => r.state !== 'settled');
    if (name === 'http.request' && active.filter(r => r.tool === name && r.challengeId === binding.challengeId).length >= 8) throw new ControlDenied('http limit');
    this.waitLimit(binding, name, args);
    const duration = name === 'http.request' ? Math.min(typeof args.timeout_ms === 'number' ? args.timeout_ms : 15000, 60000) :
      name === 'job.run' ? Math.min(typeof args.timeout_ms === 'number' ? args.timeout_ms : 60000, 600000) : 15000;
    const operation: Resource = { run: this.options.runId ?? 'run', sessionID: binding.sessionID, challengeId: binding.challengeId!, callID: call, tool: name,
      state: 'active', controller: new AbortController(), deadline: Math.min(binding.expiresAt, Date.now() + duration) };
    this.resources.set(key, operation);
    this.record(binding.sessionID, 'tool.registered', true, undefined, { callID: call, tool: name, challengeId: binding.challengeId, deadline: operation.deadline });
    const abandon = () => { this.record(binding.sessionID, 'rpc.abandoned', true, undefined, { callID: call, tool: name, job: operation.job, delivery: 'not_finished' }); operation.controller.abort('rpc abandoned'); };
    rpcSignal?.addEventListener('abort', abandon, { once: true });
    operation.detachRpc = () => rpcSignal?.removeEventListener('abort', abandon);
    operation.timer = setTimeout(() => operation.controller.abort('deadline'), Math.max(0, operation.deadline - Date.now()));
    if (rpcSignal?.aborted) abandon();
    return { execute: () => {
      const work = (async () => {
        let keep = false;
        try {
          const roots = this.roots(binding);
          await Promise.all([mkdir(roots.workDir, { recursive: true }), mkdir(roots.publishedDir, { recursive: true })]);
          operation.controller.signal.throwIfAborted(); this.live(binding);
          let result: unknown;
          if (name === 'http.request') {
            const challenge = this.options.challenges!.find(c => c.id === binding.challengeId)!;
            if (!challenge.target?.url) throw new ControlDenied('http target');
            let adapter = this.http.get(binding.sessionID);
            if (!adapter) {
              const jar = this.jars.get(binding.challengeId!) ?? new CookieJar(); this.jars.set(binding.challengeId!, jar);
              adapter = createHttpTools({ target: challenge.target.url, jar, workDir: roots.workDir }); this.http.set(binding.sessionID, adapter);
            }
            result = await adapter.request(args, { ...operation, signal: operation.controller.signal });
          } else if (name === 'job.run') {
            const jobBinding = this.jobBinding(binding, roots);
            result = await this.jobs.run(jobBinding, args, { signal: operation.controller.signal, deadline: operation.deadline, onRegistered: job => { operation.job = job; } });
            const done = this.jobs.waitSettled(jobBinding, operation.job!);
            keep = true;
            void done.then(snapshot => this.settleResource(operation, snapshot.reapIncomplete ? 'cleanup_unknown' : snapshot.state));
          } else if (name === 'job.read') result = this.jobs.read(this.jobBinding(binding, roots), args);
          else if (name === 'job.cancel') result = await this.jobs.cancel(this.jobBinding(binding, roots), args.job);
          else if (name === 'workspace.list') result = await listWorkspace(roots, args);
          else if (name === 'workspace.read') result = await readWorkspace(roots, args);
          else if (name === 'workspace.search') result = await searchWorkspace(roots, args);
          else result = await writeWorkspace(roots, args);
          if (!keep) this.settleResource(operation, 'completed');
          return result;
        } catch (error) {
          const reason = error instanceof HttpRefused || error instanceof JobRefused || error instanceof WorkspaceRefused ? error.code :
            operation.controller.signal.aborted ? operation.controller.signal.reason === 'deadline' ? 'timeout' : 'cancelled' : 'failed';
          this.settleResource(operation, reason);
          throw error instanceof ControlDenied ? error : new ControlDenied(reason);
        } finally { if (!keep) operation.detachRpc?.(); }
      })();
      operation.done = work; return work;
    } };
  }

  private initializeRoots(binding: Binding): Promise<void> {
    let ready = this.rootsReady.get(binding.sessionID);
    if (!ready) {
      const roots = this.roots(binding);
      ready = Promise.all([mkdir(roots.workDir, { recursive: true }), mkdir(roots.publishedDir, { recursive: true })]).then(() => {
        if (this.stopReason) throw new ControlDenied('run stopped'); this.live(binding);
      });
      this.rootsReady.set(binding.sessionID, ready);
    }
    return ready;
  }

  private roots(binding: Binding): WorkspaceRoots {
    const challenge = this.options.challenges!.find(c => c.id === binding.challengeId)!;
    const base = dirname(challenge.materialsDir);
    return { materialsDir: challenge.materialsDir, publishedDir: join(base, 'published'), workDir: join(base, 'work', binding.sessionID) };
  }
  private jobBinding(binding: Binding, roots: WorkspaceRoots): JobBinding { return { sessionId: binding.sessionID, challengeId: binding.challengeId!, ...roots }; }
  private settleResource(resource: Resource, result: string): void {
    if (resource.state === 'settled') return;
    clearTimeout(resource.timer); resource.detachRpc?.(); resource.state = result === 'cleanup_unknown' ? 'unknown' : 'settled'; resource.result = result;
    this.record(resource.sessionID, 'tool.settled', result !== 'cleanup_unknown', undefined, { callID: resource.callID, tool: resource.tool, job: resource.job, result });
  }
  private async cancelResources(sessionID?: string): Promise<void> {
    const resources = [...this.resources.values()].filter(r => (!sessionID || r.sessionID === sessionID) && r.state !== 'settled');
    for (const resource of resources) resource.controller.abort('stopped');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        Promise.allSettled([this.jobs.cancelAll(sessionID), ...resources.map(r => r.done)]).then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 4000); })
      ]);
      if (!completed) for (const resource of resources) if (resource.state === 'active') this.settleResource(resource, 'cleanup_unknown');
    } finally { clearTimeout(timer); }
  }

  /** G §2.1: declarations are distinct from in-flight dispatches and survive model admissions. */
  private checkDeclaration(binding: Binding, raw: unknown, assigning: boolean): { role: Role; challenge?: string } {
    if (binding.role !== 'coordinator') throw new ControlDenied('tool not permitted');
    const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const role = args.role;
    if (!isRole(role) || !CHALLENGE_ROLES.includes(role)) throw new ControlDenied('dispatch', 'role cannot accept challenge');
    if (this.pending.get(binding.sessionID)?.has(role)) throw new ControlDenied('dispatch', 'pending dispatch exists for role');
    if (!assigning) return { role };
    if (this.declarations.get(binding.sessionID)?.has(role)) throw new ControlDenied('dispatch', 'challenge already declared');
    const challenge = args.challenge;
    if (typeof challenge !== 'string' || !this.options.challenges?.some(c => c.id === challenge)) throw new ControlDenied('dispatch', 'challenge outside run');
    return { role, challenge };
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
      if (!owned || owned.parent !== binding.sessionID || owned.role !== role || !child) throw new ControlDenied('dispatch', 'task id not owned');
      this.live(child);
      const declared = this.declarations.get(binding.sessionID)?.get(role);
      if (declared !== undefined && declared !== child.challengeId) throw new ControlDenied('dispatch', 'declared challenge differs from resumed session');
      this.declarations.get(binding.sessionID)?.delete(role);
      this.record(binding.sessionID, 'dispatch.resume', true, undefined, { role, taskId, challengeId: child.challengeId, declarationConsumed: declared !== undefined });
      return;
    }
    const byRole = this.pending.get(binding.sessionID) ?? new Map();
    if (byRole.has(role)) throw new ControlDenied('dispatch', 'pending dispatch exists for role');
    const challengeId = this.declarations.get(binding.sessionID)?.get(role);
    if (CHALLENGE_ROLES.includes(role) && challengeId === undefined) throw new ControlDenied('dispatch', 'no challenge declared for role');
    byRole.set(role, { callID, challengeId });
    this.declarations.get(binding.sessionID)?.delete(role);
    this.record(binding.sessionID, 'dispatch.register', true, undefined, { role, callID, challengeId });
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
