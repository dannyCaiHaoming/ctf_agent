import { classifyChildResult, unknownChildResult, type ChildSource, type ChildResult } from './child-result.js';
import {CompletionRequests,type CompletionJudge} from './completion-tools.js';
// Control service (design v1 C): lives in the launcher process, owns the session binding table, the run budget
// ledger, the role capability table and the stop sequence. The product plugin inside OpenCode only forwards hook
// events here and obeys the reply. Every failure path is a denial; denial messages are fixed short codes and never
// contain words OpenCode could classify as retryable.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { INTAKE_TOOLS, IntakeRefused, checkMaterialPath, findChallenge, listChallenges, readMaterial } from './intake-tools.js';
import { createHttpTools, CookieJar, HttpRefused } from './http-tools.js';
import { JobManager, JobRefused, type JobBinding } from './job-tools.js';
import { ArtifactPublisher, snapshotWork, type HttpResponseFacts, type ArtifactSource } from './artifact-tools.js';
import { VerificationResults,fixEvidence } from './verification-results.js';
import { CandidatePackages } from './candidate-package-tools.js';
import { filePage } from './file-page.js';
import { diffWorkspace, listWorkspace, readWorkspace, searchWorkspace, splitWorkspacePath, writeWorkspace, WorkspaceRefused, type WorkspaceRoots } from './workspace-tools.js';
import type { PreparedChallenge } from './run-prep.js';
import { fingerprintJson, progressDigest, summarizeToolArgs, validateProgressNote } from './progress-ledger.js';

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
  role?: Role;
  challengeId?: string;
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

export const SOLVER_TOOLS = ['workspace.list', 'workspace.read', 'workspace.search', 'workspace.diff', 'workspace.write', 'http.request', 'job.run', 'job.read', 'job.cancel', 'artifact.publish', 'artifact.read', 'package.publish', 'package.read', 'package.prepare', 'verification.report'];
export const PROGRESS_TOOLS = ['progress.read', 'progress.note'] as const;
export const MANAGED_TOOLS = [...INTAKE_TOOLS, 'challenge.assign', 'challenge.unassign', 'task.stop', 'verification.read', 'completion.request', ...PROGRESS_TOOLS, ...SOLVER_TOOLS];
interface Resource { run: string; sessionID: string; challengeId: string; callID: string; tool: string; state: 'active' | 'settled' | 'unknown'; result?: string; job?: string; controller: AbortController; deadline: number; execution?: string; timer?: ReturnType<typeof setTimeout>; done?: Promise<unknown>; detachRpc?: () => void }
interface TaskStopResult { state: 'stopped' | 'unknown' | 'completed' | 'failed'; resources: 'settled' | 'unknown'; sessionAbort: 'confirmed' | 'unknown' | 'not_required'; executionRef?: string }
interface Execution { mode: 'sync' | 'background'; source: ChildSource; resultFacts: ChildResult | null; version?: string; ref: string; run: string; parent: string; callID: string; role: Role; challengeId?: string; childID?: string; state: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'; delivered: boolean; noticeMessageID?: string; delivery?: 'queued' | 'consumed' | 'suppressed' | 'stop_reply'; lateResult?: string; initialOutput?: string; result?: string }
/** Result-delivery view of a synchronous dispatch. Identity, source and facts live only on its Execution (the accessors below), so the two cannot disagree. */
interface SyncCall {parent:string;callID:string;role:Role;execution:string;childID?:string;source:ChildSource;state: 'active' | 'reading' | 'done'; fingerprint:string;displayed:boolean;facts?:ChildResult|null}
interface Preparation {sessionID:string;execution:string;version:string;directory:string;metadata:{path:string;sha256:string;size:number}[];files:{path:string;sha256:string;size:number}[]}
interface Outside { execute: () => Promise<unknown> }

export interface ControlOptions {
  completionJudges?:Readonly<Record<string,CompletionJudge>>;
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
  /** Known credentials and other exact strings that must never reach the progress ledger. */
  redactions?: readonly string[];
  /** Incremental human-review projection callback; the full audit remains authoritative. */
  onAudit?: (record: AuditRecord) => void;
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
  private readonly pending = new Map<string, Map<Role, { callID: string; challengeId?: string; childID?: string; background?: boolean; version?: string }>>();
  private readonly versions = new Map<string, string>();
  private readonly declarations = new Map<string, Map<Role, string>>();
  private readonly syncCalls = new Map<string,SyncCall>();
  private readonly executions = new Map<string, Execution>();
  private readonly childStops = new Map<string, Promise<TaskStopResult>>();
  private readonly dispatched = new Map<string, { parent: string; role: Role; background: boolean }>();
  private readonly usageMessages = new Map<string, Map<string, Message>>();
  private readonly usageGaps = new Set<string>();

  private readonly resources = new Map<string, Resource>();
  private readonly http = new Map<string, ReturnType<typeof createHttpTools>>();
  private readonly jars = new Map<string, CookieJar>();
  private readonly jobs: JobManager;
  private readonly publications = new ArtifactPublisher();
  private readonly packages = new CandidatePackages(this.publications);
  private readonly completions:CompletionRequests;
  completionSnapshot(){return this.completions.snapshot();}
  private readonly verificationResults = new VerificationResults();
  private readonly verificationJobs = new Map<string,{sessionID:string;execution:string;version:string;association:Record<string,unknown>;terminal:{state:string;exitCode:number|null}}>();
  verificationResultSnapshot(){return this.verificationResults.snapshot();}
  private readonly preparations = new Map<string, Preparation>();
  private verifierExecution(binding:Binding) {
    const e=[...this.executions.values()].find(e=>e.childID===binding.sessionID&&e.state==='running');
    if(!e?.version) throw new ControlDenied('verification version');
    return e as Execution & {version:string};
  }
  private readonly fileSources = new Map<string,{sha256:string;source:ArtifactSource}>();
  private readonly outputSources = new Map<string, {source: ArtifactSource; bytes?: Buffer; complete?: boolean}>();
  publicationSnapshot() { return this.publications.snapshot(); }
  private source(binding: Binding, kind: ArtifactSource['kind'], resource: string, execution?: string): ArtifactSource {
    const e=execution ?? [...this.executions.values()].find(e=>e.childID===binding.sessionID && e.state==='running')?.ref;
    if(!e) throw new ControlDenied('artifact execution');
    return {kind, run:this.options.runId ?? 'run', challenge:binding.challengeId!, sessionID:binding.sessionID, execution:e, resource};
  }

  private readonly rootsReady = new Map<string, Promise<void>>();
  constructor(private readonly options: ControlOptions) { this.completions=new CompletionRequests(join(options.workdir,'..','state','completion')); this.jobs = new JobManager({ jobsRoot: join(options.workdir, '..', 'state', 'jobs') }); }

  executionSnapshot() { return [...this.executions.values()].map(e => structuredClone(e)); }
  hasOutstandingWork(status: Record<string, { type: string }>): boolean {
    return [...this.executions.values()].some(e => e.state === 'starting' || e.state === 'running' || !e.delivered || e.delivery === 'queued') || [...this.pending.values()].some(p => p.size > 0) ||
      [...this.resources.values()].some(r => r.state !== 'settled') || [...this.syncCalls.values()].some(c => c.state !== 'done');
  }

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
      if (!['chat.message', 'model.call', 'tool.before', 'tool.execute', 'tool.after', 'task.event'].includes(operation)) throw new ControlDenied('unknown operation');
      if (operation === 'task.event') return await this.serial(() => this.taskEvent(sessionID, body));
      // Runtime-synthetic native completion is consumed once before admission; stopped runs retain it without waking.
      const completionRefs = operation === 'chat.message' ? await this.receiveCompletion(sessionID, body) : [];
      let binding: Binding | undefined;
      if (operation !== 'tool.after') {
        const hookAgent = typeof body.agent === 'string' ? body.agent : undefined;
        binding = this.bindings.get(sessionID) ?? await this.bindFromSdk(sessionID, hookAgent);
        this.live(binding);
        if (binding.challengeId) await this.initializeRoots(binding);
        if ((operation === 'tool.before' && body.tool === 'ctf_task_stop' || operation === 'tool.execute' && body.tool === 'task.stop') && binding.role === 'coordinator') {
          const childID = (body.args as {task_id?: string} | undefined)?.task_id;
          const execution = [...this.executions.values()].find(e => e.parent === sessionID && e.childID === childID);
          if (childID && !this.bindings.has(childID) && execution) await this.bindFromSdk(childID, execution.role);
        }
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
          case 'chat.message': {
            this.freezeChildSource(binding!, body);
            this.freezeSyncSource(binding!, body);
            const completionDisplays = completionRefs.map(ref => {
              const e = this.executions.get(ref)!;
              const child = e.childID ? this.bindings.get(e.childID) : undefined;
              if (e.parent !== sessionID || e.noticeMessageID !== body.messageID || e.delivery !== 'queued' || !child || child.state !== 'active' || Date.now() >= child.expiresAt) throw new ControlDenied('completion correlation');
              const f = e.resultFacts!;
              return { ref: e.ref, role: e.role, completeness: f.completeness, reason: f.reason, finish: f.finish, textChars: f.completeness === 'unknown' ? null : f.textChars, source: e.source.status };
            });
            return completionDisplays.length ? { bound: true, completionDisplays } : { bound: true };
          }
          case 'model.call': return this.admit(binding!, body);
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
    for (const e of this.executions.values()) if (e.state === 'starting' || e.state === 'running') { e.state = 'cancelled'; e.delivered = true; e.delivery = 'suppressed'; }
    for (const e of this.executions.values()) if (e.delivery === 'queued') e.delivery = 'suppressed';
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
      await Promise.all([...all].map(id => this.childStops.get(id) ?? this.abortSession(id)));
    })();
    return this.stopping;
  }

  /** Withdraw one child; its later hooks are refused. */
  async revoke(sessionID: string): Promise<void> {
    const binding = this.bindings.get(sessionID);
    if (!binding || binding.via === 'root') throw new Error('only a bound child can be revoked');
    await this.stopChild(binding, true);
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

  private stopChild(child: Binding, forceRevoke = false): Promise<TaskStopResult> {
    const existing = this.childStops.get(child.sessionID); if (existing) return existing;
    const execution = [...this.executions.values()].reverse().find(e => e.childID === child.sessionID);
    if (!forceRevoke && execution && (execution.state === 'completed' || execution.state === 'failed')) return Promise.resolve({ state: execution.state, resources: this.resourceSnapshot().some(r => r.sessionID === child.sessionID && r.state !== 'settled') ? 'unknown' : 'settled', sessionAbort: 'not_required', executionRef: execution.ref });
    if (execution && (execution.state === 'starting' || execution.state === 'running')) { execution.state = 'cancelled'; execution.delivered = true; execution.delivery = 'stop_reply'; this.record(child.sessionID, 'task.cancel', true, undefined, { ref: execution.ref, callID: execution.callID }); }
    child.state = 'revoked';
    this.clearDispatchState(child.sessionID);
    this.record(child.sessionID, 'revoke', true);
    const stopped = (async (): Promise<TaskStopResult> => {
      await this.cancelResources(child.sessionID);
      const confirmed = await this.abortSession(child.sessionID, 4000);
      const resources = this.resourceSnapshot().some(r => r.sessionID === child.sessionID && r.state !== 'settled') ? 'unknown' : 'settled';
      const result: TaskStopResult = { executionRef: execution?.ref, state: resources === 'settled' && confirmed ? 'stopped' : 'unknown', resources, sessionAbort: confirmed ? 'confirmed' : 'unknown' };
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
    const binding = this.bindings.get(sessionID);
    const record: AuditRecord = { seq: ++this.seq, t: Date.now() - this.startedAt, at: Date.now(), sessionID, op, allow,
      ...(reason ? { reason } : {}), ...(detail === undefined ? {} : { detail }),
      ...(binding ? { role: binding.role } : {}), ...(binding?.challengeId ? { challengeId: binding.challengeId } : {}) };
    this.audit.push(record);
    this.options.onAudit?.(record);
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
    // The native running tool part binds a child ID to this exact creation call.
    // Parent/role alone is insufficient once an earlier creation can arrive late.
    const candidate = info?.parentID && isRole(info.agent) ? this.pending.get(info.parentID)?.get(info.agent) : undefined;
    let nativeChild: string | undefined;
    if (candidate && !candidate.childID && info?.parentID) {
      try {
        const messages = (await this.options.client.session.messages({ sessionID: info.parentID }, { throwOnError: true })).data ?? [];
        const part = messages.flatMap(m => m.parts).find(p => p.type === 'tool' && p.tool === 'task' && p.callID === candidate.callID);
        if (part?.type === 'tool' && 'metadata' in part.state && typeof part.state.metadata?.sessionId === 'string') nativeChild = part.state.metadata.sessionId;
      } catch { throw new ControlDenied('unbound session', 'native dispatch correlation unavailable'); }
    }
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
    if (waiting.childID && waiting.childID !== sessionID) throw fail('dispatch child mismatch');
    if (candidate?.callID !== waiting.callID || (waiting.childID ?? nativeChild) !== sessionID) throw fail('native call child mismatch');
    this.pending.get(info.parentID)!.delete(info.agent);
    const binding: Binding = { sessionID, role: info.agent, parentID: info.parentID, via: 'dispatch', dispatchCallID: waiting.callID, challengeId: waiting.challengeId, scope: 'run',
      expiresAt: this.options.expiresAt, state: 'active', boundAt: Date.now() };
    if (binding.challengeId) binding.workDir = this.roots(binding).workDir;
    this.bindings.set(sessionID, binding);
    this.dispatched.set(sessionID, { parent: info.parentID, role: info.agent, background: waiting.background === true });
    const execution = [...this.executions.values()].find(e => e.parent === info.parentID && e.callID === waiting.callID);
    if (execution && (execution.state === 'starting' || execution.state === 'running')) { execution.childID = sessionID; execution.state = 'running'; } // A settled execution is never revived by a late bind.
    this.record(sessionID, 'bind', true, undefined, { role: binding.role, via: 'dispatch', sdkParentID: info.parentID, sdkAgent: info.agent, callID: waiting.callID, challengeId: waiting.challengeId, sdkMs });
    return binding;
    });
  }

  private admit(binding: Binding, body: Record<string, unknown>): { maxOutputTokens: number; admitNo: number; role: Role } {
    // Async dispatches survive parent admission; only trusted binding/terminal facts release them.
    // Stop, revocation or expiry may have occurred while the SDK usage query was pending.
    if (this.stopReason) throw new ControlDenied('run stopped');
    this.live(binding);
    const { maxModelCalls, maxObservableTokens } = this.options.budget;
    if (this.admitted >= maxModelCalls || this.observed >= maxObservableTokens) {
      void this.stopAll('budget');
      throw new ControlDenied('budget', JSON.stringify({ admitted: this.admitted, observedTokens: this.observed }));
    }
    if(binding.role==='verifier')this.verifierExecution(binding);
    this.admitted++;
    const requestMessageIDs = new Set(Array.isArray(body.requestMessageIDs) ? body.requestMessageIDs.filter((id): id is string => typeof id === 'string') : []);
    for (const e of this.executions.values()) if (e.parent === binding.sessionID && e.delivery === 'queued' && requestMessageIDs.has(e.noticeMessageID!)) { e.delivery = 'consumed'; this.record(binding.sessionID, 'task.delivered', true, undefined, {ref: e.ref, messageID: e.noticeMessageID, admitNo: this.admitted}); }
    return { maxOutputTokens: maxObservableTokens - this.observed, admitNo: this.admitted, role: binding.role };
  }

  private toolBefore(binding: Binding, body: Record<string, unknown>): unknown {
    const tool = typeof body.tool === 'string' ? body.tool : '';
    if (tool === 'ctf_challenge_assign' || tool === 'ctf_challenge_unassign') {
      this.checkDeclaration(binding, body.args, tool === 'ctf_challenge_assign');
      return { allowed: true }; // Precheck only: execution is the declaration's linearization point.
    }
    if (tool === 'ctf_completion_request') { if(binding.role!=='coordinator')throw new ControlDenied('tool not permitted');return {allowed:true,rpcTimeoutMs:25000}; }
    if (tool === 'ctf_verification_read') { if(binding.role!=='coordinator')throw new ControlDenied('tool not permitted');return {allowed:true,rpcTimeoutMs:20000}; }
    if (tool === 'ctf_task_stop') { this.checkTaskStop(binding, body.args); return { allowed: true, rpcTimeoutMs: 10000 }; }
    const progress = PROGRESS_TOOLS.find(name => `ctf_${name.replaceAll('.', '_')}` === tool);
    if (progress) { this.checkProgress(binding, progress); return { allowed: true }; }
    const managed = SOLVER_TOOLS.find(name => `ctf_${name.replaceAll('.', '_')}` === tool);
    if (managed) { this.checkSolver(binding, managed); return { allowed: true, rpcTimeoutMs: this.waitLimit(binding, managed, (body.args ?? {}) as Record<string, unknown>) + 5000 }; }
    const intake = INTAKE_BY_ID.get(tool);
    if (intake) { this.checkIntake(binding, intake, body.args); return { allowed: true }; }
    const allowed = Object.hasOwn(NATIVE_TOOL_ROLES, tool) && NATIVE_TOOL_ROLES[tool]!.includes(binding.role);
    if (!allowed) throw new ControlDenied('tool not permitted', tool);
    let args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;

    if (tool === 'task') {
      if (args.background !== undefined && typeof args.background !== 'boolean') throw new ControlDenied('dispatch', 'background must be boolean');
      let background = args.background === true;
      if (args.background === undefined && args.task_id !== undefined && args.task_id !== null && args.task_id !== '') {
        const owned = typeof args.task_id === 'string' ? this.dispatched.get(args.task_id) : undefined;
        if (!owned || owned.parent !== binding.sessionID || owned.role !== args.subagent_type) throw new ControlDenied('dispatch', 'task id not owned; cannot inherit background');
        if (typeof owned.background !== 'boolean') throw new ControlDenied('dispatch', 'creation background unavailable');
        background = owned.background;
      }
      args = { ...args, background };
      const key = binding.sessionID + '/' + body.callID;
      const prior = this.syncCalls.get(key);
      if (!prior && [...this.executions.values()].some(e => e.parent === binding.sessionID && e.callID === body.callID)) throw new ControlDenied('duplicate dispatch call');
      const fingerprint = fingerprintJson(args);
      if (prior) {
        if (prior.state === 'done') throw new ControlDenied('sync call terminal');
        if (prior.fingerprint !== fingerprint) {
          prior.source = {...prior.source, status:'conflict', reason:'different_call', observedAt:Date.now()};
          this.record(prior.parent, 'sync.source', true, undefined, {callID:prior.callID, childID:prior.childID, source:{...prior.source}});
          throw new ControlDenied('sync call conflict');
        }
        return {allowed:true, taskBackground: background};
      }
      const active = [...this.syncCalls.values()].filter(c => c.parent === binding.sessionID && c.state !== 'done' && typeof args.task_id === 'string' && c.childID === args.task_id);
      if (active.length) {
        for (const c of active) {
          c.source = {...c.source, status:'conflict', reason:'multiple_calls', observedAt:Date.now()};
          this.record(c.parent, 'sync.source', true, undefined, {callID:c.callID, childID:c.childID, source:{...c.source}});
        }
        throw new ControlDenied('sync active call');
      }
      this.registerDispatch(binding, typeof body.callID === 'string' ? body.callID : '', args);
      // Both modes mint the one execution identity of this call; background/sync only decides how the result is awaited and delivered.
      const ref = randomUUID();
      const taskID = typeof args.task_id === 'string' ? args.task_id : undefined;
      const execution: Execution = { mode: background ? 'background' : 'sync', source: {status:'unknown',userMessageID:null,observedAt:null,reason:'missing_source'}, resultFacts:null, ref, run: this.options.runId ?? 'run', parent: binding.sessionID, callID: String(body.callID), role: args.subagent_type as Role, version: this.versions.get(binding.sessionID+'/'+String(args.subagent_type)), challengeId: taskID ? this.bindings.get(taskID)?.challengeId : this.pending.get(binding.sessionID)?.get(args.subagent_type as Role)?.challengeId, childID: taskID, state: taskID ? 'running' : 'starting', delivered: !background };
      this.executions.set(ref, execution);
      this.versions.delete(binding.sessionID+'/'+String(args.subagent_type));
      this.record(binding.sessionID, 'task.execution', true, undefined, {...execution});
      if (!background) {
        this.syncCalls.set(key, {parent:binding.sessionID, callID:String(body.callID), role:args.subagent_type as Role, execution:ref,
          get childID() { return execution.childID; }, set childID(id) { execution.childID = id; },
          get source() { return execution.source; }, set source(source) { execution.source = source; },
          get facts() { return execution.resultFacts; }, set facts(facts) { execution.resultFacts = facts ?? null; },
          state:'active', fingerprint, displayed:false});
        return { allowed: true, taskBackground: background };
      }
      return { allowed: true, taskDescription: `[ctf:${ref}]`, taskBackground: background };
    }
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
    if (name === 'progress.read') {
      this.checkProgress(binding, name);
      const args = (body.args ?? {}) as Record<string, unknown>;
      return {...progressDigest(this.audit, { runId: this.options.runId ?? 'run', redactions: this.options.redactions, limit: typeof args.limit === 'number' ? args.limit : undefined,
        usage: { ...this.usageSnapshot().total } }),completion:{challenges:(this.options.challenges??[]).map(c=>this.completions.status(this.options.runId??'run',c.id,this.options.completionJudges?.[c.id])),budget:{admittedModelCalls:this.admitted,maxModelCalls:this.options.budget.maxModelCalls,observedTokens:this.observed,maxObservableTokens:this.options.budget.maxObservableTokens,deadline:this.options.expiresAt,stopped:this.stopReason??null}}};
    }
    if (name === 'progress.note') {
      this.checkProgress(binding, name);
      let note: ReturnType<typeof validateProgressNote>;
      try { note = validateProgressNote(body.args); } catch (error) { throw new ControlDenied(error instanceof Error ? error.message : 'progress note'); }
      this.record(binding.sessionID, 'progress.note', true, undefined, note);
      return { source: binding.role, ...note };
    }
    if (name === 'task.stop') {
      const child = this.checkTaskStop(binding, body.args);
      const alreadyStopped = this.childStops.has(child.sessionID);
      const stopped = this.stopChild(child);
      return { execute: async () => ({ ...await stopped, alreadyStopped }) };
    }
    if (name === 'challenge.assign' || name === 'challenge.unassign') {
      const { role, challenge, version } = this.checkDeclaration(binding, body.args, name === 'challenge.assign');
      this.live(binding);
      if (name === 'challenge.unassign') {
        this.versions.delete(binding.sessionID+'/'+role);
        const cleared = this.declarations.get(binding.sessionID)?.delete(role) ?? false;
        this.record(binding.sessionID, 'assign.clear', true, undefined, { role, cleared });
        return { cleared };
      }
      const commit=()=>{
        this.checkDeclaration(binding,body.args,true);this.live(binding);
        const declared=this.declarations.get(binding.sessionID)??new Map<Role,string>();
        declared.set(role,challenge!);this.declarations.set(binding.sessionID,declared);
        if(version)this.versions.set(binding.sessionID+'/'+role,version);
        this.record(binding.sessionID,'assign',true,undefined,{role,challenge,version});return {challenge,version};
      };
      if(version)return {execute:async()=>{await this.packages.candidateBytes(this.options.runId??'run',challenge!,version,()=>this.live(binding));return this.serial(commit);}};
      return commit();
    }
    if(name==='verification.read') {
      if(binding.role!=='coordinator')throw new ControlDenied('tool not permitted');
      return {execute:()=>this.verificationResults.read(this.options.runId??'run',(body.args??{}) as Record<string,unknown>,r=>this.checkVerification(r),()=>{if(signal?.aborted)throw new ControlDenied('rpc abandoned');this.live(binding);if(this.stopReason)throw new ControlDenied('run stopped');})};
    }
    if(name==='completion.request') {
      if(binding.role!=='coordinator')throw new ControlDenied('tool not permitted');
      const args=(body.args??{}) as Record<string,unknown>,run=this.options.runId??'run';
      const active=()=>{if(signal?.aborted)throw new ControlDenied('rpc abandoned');this.live(binding);if(this.stopReason)throw new ControlDenied('run stopped');if(Date.now()>=this.options.expiresAt)throw new ControlDenied('deadline');if(this.admitted>=this.options.budget.maxModelCalls||this.observed>=this.options.budget.maxObservableTokens)throw new ControlDenied('budget');};
      return {execute:async()=>{
        const result=await this.completions.request(run,args,this.options.completionJudges?.[String(args.challenge)],async()=>{
          const page=await this.verificationResults.read(run,args,r=>this.checkVerification(r),active);
          if(!page.completionAdmission.allowed)throw new ControlDenied(page.completionAdmission.reasons.join('; '));
          const bytes=await this.packages.candidateBytes(run,String(args.challenge),String(args.version),active);
          // Recheck after bytes are loaded; do not mix results/versions across awaited reads.
          const check=await this.verificationResults.read(run,args,r=>this.checkVerification(r),active);if(!check.completionAdmission.allowed)throw new ControlDenied(check.completionAdmission.reasons.join('; '));
          const finalBytes=await this.packages.candidateBytes(run,String(args.challenge),String(args.version),active);if(!bytes.equals(finalBytes))throw new ControlDenied('fixed candidate changed');return finalBytes;
        },active,signal);
        this.record(binding.sessionID,'completion.saved',true,undefined,result);return result;
      }};
    }
    if (SOLVER_TOOLS.includes(name)) return this.prepareSolver(binding, name, (body.args ?? {}) as Record<string, unknown>, body.callID, signal);
    if (!INTAKE_TOOLS.includes(name)) throw new ControlDenied('no managed tools');
    const args = this.checkIntake(binding, name, body.args);
    const challenges = this.options.challenges ?? [];
    if (name === 'challenge.list') return listChallenges(challenges,c=>this.completions.status(this.options.runId??'run',c.id,this.options.completionJudges?.[c.id]));
    return { execute: async () => { try { return await readMaterial(challenges, args); } catch (error) { throw this.refusal(error); } } };
  }

  private async checkVerification(r:import('./verification-results.js').Stored){
    const reasons:string[]=[],hardBlocking:string[]=[],warnings:{evidenceIndex:number;reason:string}[]=[];
    try{await this.packages.candidateBytes(r.run,r.challenge,r.version,()=>{});}catch{hardBlocking.push('fixed candidate or original reference unavailable');}
    const execution=this.executions.get(r.execution);if(!execution||execution.run!==r.run||execution.role!=='verifier'||execution.challengeId!==r.challenge||execution.version!==r.version||execution.childID!==r.sessionID)hardBlocking.push('verification execution mismatch');
    try{await this.packages.read(r.run,r.challenge,{version:r.version,component:'manifest'});}catch{reasons.push('fixed package or dependency unavailable');}
    for(const [evidenceIndex,e] of r.evidence.entries()){
      const changed=(reason:string)=>{if(e.necessary)reasons.push(reason);else warnings.push({evidenceIndex,reason});};
      if(e.kind==='artifact'){try{const src=e.source as {ref:string};await this.publications.bytes(r.run,r.challenge,src.ref);}catch{changed('fixed evidence unavailable');}}
      if(e.preparation){const p=this.preparations.get(e.preparation),b=this.bindings.get(r.sessionID);try{if(!p||!b)throw new Error();await this.packages.checkPrepared(this.roots(b).workDir,p);}catch{changed('relevant prepared dependency changed_or_unreadable');}}
    }return {blocking:reasons,warnings,hardBlocking};
  }
  private checkProgress(binding: Binding, name: string): void {
    if (!['coordinator', 'recovery-critic'].includes(binding.role)) throw new ControlDenied('tool not permitted', name);
  }
  private checkSolver(binding: Binding, name: string): void {
    if (!binding.challengeId || !CHALLENGE_ROLES.includes(binding.role) ||
      (name === 'http.request' && !['recon', 'domain-solver'].includes(binding.role)) ||
      (name === 'artifact.publish' && binding.role === 'verifier') ||
      (name === 'package.publish' && binding.role !== 'engineer') ||
      (name === 'package.read' && !['engineer','verifier'].includes(binding.role)) ||
      (['package.prepare','verification.report'].includes(name) && binding.role !== 'verifier')) throw new ControlDenied('tool not permitted');
    if (!this.options.challenges?.some(c => c.id === binding.challengeId)) throw new ControlDenied('challenge outside run');
  }

  private waitLimit(binding: Binding, name: string, args: Record<string, unknown>): number {
    const bounded = (value: unknown, fallback: number, max: number, min = 1) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ControlDenied('tool timeout');
      return value;
    };
    if (name === 'job.run') {
      bounded(args.wait_ms, 5000, 30000, 0);
      if (args.completion !== undefined && args.completion !== 'terminal') throw new ControlDenied('job completion');
    }
    const wait = name === 'http.request' ? bounded(args.timeout_ms, 15000, 60000) :
      name === 'job.run' ? (args.completion === 'terminal' || args.wait_ms === undefined
        ? bounded(args.timeout_ms, 60000, 600000) + 4000
        : bounded(args.wait_ms, 5000, 30000, 0)) : name === 'job.cancel' ? 4000 : 15000;
    return Math.max(0, Math.min(wait, binding.expiresAt - Date.now()));
  }

  private prepareSolver(binding: Binding, name: string, args: Record<string, unknown>, call: unknown, rpcSignal?: AbortSignal): Outside {
    this.checkSolver(binding, name);
    if (typeof call !== 'string' || !/^[\w.-]{1,128}$/.test(call)) throw new ControlDenied('call id');
    const key = `${binding.sessionID}/${call}`;
    if (this.resources.has(key)) throw new ControlDenied('duplicate tool call');
    const active = [...this.resources.values()].filter(r => r.state !== 'settled');
    if (name === 'http.request' && active.filter(r => r.tool === name && r.challengeId === binding.challengeId).length >= 8) throw new ControlDenied('http limit');
    if(binding.role==='verifier'&&['package.read','package.prepare','job.run','verification.report'].includes(name)) {
      const e=this.verifierExecution(binding);
      if(name==='package.read'&&args.version!==e.version)throw new ControlDenied('verification version');
    }
    this.waitLimit(binding, name, args);
    const duration = name === 'http.request' ? Math.min(typeof args.timeout_ms === 'number' ? args.timeout_ms : 15000, 60000) :
      name === 'job.run' ? Math.min(typeof args.timeout_ms === 'number' ? args.timeout_ms : 60000, 600000) : 15000;
    const operation: Resource = { run: this.options.runId ?? 'run', sessionID: binding.sessionID, challengeId: binding.challengeId!, callID: call, tool: name,
      execution: [...this.executions.values()].find(e => e.childID === binding.sessionID && e.state === 'running')?.ref,
      state: 'active', controller: new AbortController(), deadline: Math.min(binding.expiresAt, Date.now() + duration) };
    this.resources.set(key, operation);
    const safeArgs = summarizeToolArgs(name, args, this.options.redactions);
    this.record(binding.sessionID, 'tool.registered', true, undefined, { callID: call, tool: name, challengeId: binding.challengeId, deadline: operation.deadline, safeArgs: safeArgs.summary, argFingerprint: safeArgs.fingerprint });
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
              adapter = createHttpTools({ target: challenge.target.url, jar, workDir: roots.workDir, redactions: this.options.redactions }); this.http.set(binding.sessionID, adapter);
            }
            const resource=randomUUID(); let captured: {bytes:Buffer;complete:boolean;http:HttpResponseFacts}|undefined;
            const response=await adapter.request(args, { ...operation, signal: operation.controller.signal, capture:(bytes,complete,http)=>{captured={bytes,complete,http};} });
            if(!captured) throw new ControlDenied('http capture');
            if(operation.execution) this.outputSources.set(resource,{source:{...this.source(binding,'http',resource,operation.execution),callID:call,http:captured.http},bytes:captured.bytes,complete:captured.complete});
            result=operation.execution?{...response,resource}:response;
          } else if (name === 'job.run') {
            const jobBinding = this.jobBinding(binding, roots);
            let association:Record<string,unknown>|undefined;
            let preparation:Preparation|undefined;
            if(binding.role==='verifier') {
              const e=this.verifierExecution(binding);
              if(Object.keys(args).some(k=>!['argv','timeout_ms','wait_ms','completion','preparation'].includes(k)))throw new ControlDenied('job arguments');
              preparation=typeof args.preparation==='string'?this.preparations.get(args.preparation):undefined;
              if(!preparation||preparation.sessionID!==binding.sessionID||preparation.execution!==e.ref||preparation.version!==e.version)throw new ControlDenied('preparation');
              await this.packages.checkPrepared(roots.workDir,preparation);
              operation.controller.signal.throwIfAborted();this.live(binding);
              if(this.verifierExecution(binding).ref!==operation.execution)throw new ControlDenied('verification execution');
              jobBinding.workDir=join(roots.workDir,preparation.directory);
              association={version:e.version,preparation:args.preparation,execution:e.ref,argv:args.argv,files:preparation.files,metadata:preparation.metadata,before:'matched',after:'pending',continuousIntegrity:'unknown',undeclaredDependencies:'unknown'};
              this.record(binding.sessionID,'verification.job.input',true,undefined,structuredClone(association));
            }
            result = await this.jobs.run(jobBinding, args, { signal: operation.controller.signal, deadline: operation.deadline, onRegistered: job => { operation.job = job; if(operation.execution) this.outputSources.set(job,{source:{...this.source(binding,'job',job,operation.execution),callID:call}}); } });
            const done = this.jobs.waitSettled(jobBinding, operation.job!).then(async snapshot=>{
              if(association&&preparation){try{await this.packages.checkPrepared(roots.workDir,preparation);association.after='matched';}catch{association.after='changed_or_unreadable';}
                this.verificationJobs.set(operation.job!,{sessionID:binding.sessionID,execution:operation.execution!,version:String(association.version),association:structuredClone(association),terminal:{state:snapshot.state,exitCode:snapshot.exitCode}});
                this.record(binding.sessionID,'verification.job.terminal',true,undefined,{...association,job:operation.job,terminal:snapshot});
                return {...snapshot,inputAssociation:association};}
              return snapshot;
            });
            keep = true;
            void done.then(snapshot => this.settleResource(operation, snapshot.reapIncomplete ? 'cleanup_unknown' : snapshot.state));
            // Decision prototype: retain the same RPC/call until terminal cleanup, without a model polling loop.
            if (args.completion === 'terminal' || args.wait_ms === undefined) result = await done;
          } else if (name === 'artifact.publish') {
            if(!operation.execution) throw new ControlDenied('artifact execution');
            const allowed=['source','path','job','stream','resource','start','end'];
            if(Object.keys(args).some(k=>!allowed.includes(k))) throw new ControlDenied('artifact arguments');
            let bytes:Buffer,complete:boolean|null,source:ArtifactSource;
            if(args.source==='file') {
              if(Object.keys(args).some(k=>!['source','path','start','end'].includes(k))) throw new ControlDenied('artifact arguments');
              bytes=await snapshotWork(roots,args.path); complete=null;
              const selected=this.source(binding,'file',call,operation.execution);
              const known=this.fileSources.get(`${binding.sessionID}/${String(args.path)}`);
              const matches=known?.sha256===createHash('sha256').update(bytes).digest('hex');
              source=matches?{...known!.source,selectedExecution:selected.execution!}:{...selected,execution:null,selectedExecution:selected.execution!,path:String(args.path)};
            } else {
              const keys=args.source==='job'?['source','job','stream','start','end']:['source','resource','start','end'];
              if(Object.keys(args).some(k=>!keys.includes(k))) throw new ControlDenied('artifact arguments');
              const key=args.source==='job'?args.job:args.source==='http'?args.resource:undefined;
              const original=typeof key==='string'?this.outputSources.get(key):undefined;
              if(!original || original.source.kind!==args.source || original.source.run!==operation.run || original.source.challenge!==binding.challengeId || original.source.sessionID!==binding.sessionID) throw new ControlDenied('artifact source');
              source=original.source;
              if(args.source==='job') { const output=this.jobs.outputSnapshot(this.jobBinding(binding,roots),args.job,args.stream); bytes=output.bytes; complete=output.complete; source={...source,stream:String(args.stream)}; }
              else { bytes=original.bytes!; complete=original.complete!; }
            }
            const publication=await this.publications.publish(roots.publishedDir,source,bytes,complete,args,()=>{ operation.controller.signal.throwIfAborted(); this.live(binding); });
            result=publication;
            this.record(binding.sessionID,'artifact.published',true,undefined,this.publicationSnapshot().find(p=>p.ref===publication.ref));
          } else if(name==='package.publish') {
            if(!operation.execution) throw new ControlDenied('package execution');
            result=await this.packages.publish({source:this.source(binding,'package',call,operation.execution),dir:roots.publishedDir,challenge:this.options.challenges!.find(c=>c.id===binding.challengeId)!},args,()=>{operation.controller.signal.throwIfAborted();this.live(binding);});
            this.record(binding.sessionID,'package.published',true,undefined,this.publicationSnapshot().find(p=>p.ref===(result as {version:string}).version));
          } else if(name==='package.read') result=await this.packages.read(operation.run,binding.challengeId!,args);
          else if(name==='verification.report') {
            const e=this.verifierExecution(binding);
            if(e.ref!==operation.execution)throw new ControlDenied('verification execution');
            const active=()=>{operation.controller.signal.throwIfAborted();this.live(binding);if(this.stopReason)throw new ControlDenied('run stopped');if(this.verifierExecution(binding).ref!==e.ref)throw new ControlDenied('verification execution');};
            result=await this.verificationResults.register({run:operation.run,challenge:binding.challengeId!,version:e.version,sessionID:binding.sessionID,execution:e.ref},args,async selection=>{
              if(selection.kind==='artifact'){
                const p=await this.publications.bytes(operation.run,binding.challengeId!,selection.ref);
                if(p.source.kind==='package')throw new ControlDenied('verification evidence');
                return fixEvidence(selection,p.bytes,{kind:'artifact',source:{...p.source,ref:selection.ref},originalComplete:p.record.originalComplete});
              }
              const j=this.verificationJobs.get(selection.job);
              if(!j||j.sessionID!==binding.sessionID||j.execution!==e.ref||j.version!==e.version)throw new ControlDenied('verification job');
              const output=this.jobs.outputSnapshot(this.jobBinding(binding,roots),selection.job,selection.stream);
              return fixEvidence(selection,output.bytes,{kind:'job',source:{...this.outputSources.get(selection.job)!.source,stream:selection.stream},originalComplete:output.complete,association:structuredClone(j.association),terminal:j.terminal,preparation:String(j.association.preparation)});
            },async()=>{
              return this.packages.candidateBytes(operation.run,binding.challengeId!,e.version,active);
            },active);
            this.record(binding.sessionID,'verification.registered',true,undefined,this.verificationResultSnapshot().find(r=>r.result===(result as {result:string}).result));
          }
          else if(name==='package.prepare') {
            if(Object.keys(args).length)throw new ControlDenied('prepare arguments');
            const e=this.verifierExecution(binding);
            const p=await this.packages.prepare(operation.run,binding.challengeId!,e.version,roots.workDir,()=>{operation.controller.signal.throwIfAborted();this.live(binding);if(this.verifierExecution(binding).ref!==e.ref)throw new ControlDenied('verification execution');});
            this.preparations.set(p.preparation,{...p,sessionID:binding.sessionID,execution:e.ref,version:e.version});
            this.record(binding.sessionID,'package.prepared',true,undefined,{...p,execution:e.ref,version:e.version});
            result={...p,execution:e.ref,version:e.version};
          }
          else if(name==='artifact.read') result=await this.publications.read(operation.run,binding.challengeId!,args);
          else if (name === 'job.read') result = this.jobs.read(this.jobBinding(binding, roots), args);
          else if (name === 'job.cancel') result = await this.jobs.cancel(this.jobBinding(binding, roots), args.job);
          else if (name === 'workspace.list') {
            if(args.path==='published') {
              const records=this.publicationSnapshot().filter(p=>p.source.run===operation.run&&p.source.challenge===binding.challengeId);
              for(const r of records) await this.publications.bytes(operation.run,binding.challengeId!,r.ref);
              result={path:'published',entries:records.map(r=>({name:`${r.ref}.bin`,type:'file',size:r.size})).sort((a,b)=>a.name.localeCompare(b.name)),truncated:false};
            } else if(typeof args.path==='string'&&args.path.startsWith('published/')) throw new ControlDenied('workspace path');
            else result=await listWorkspace(roots,args);
          }
          else if (name === 'workspace.read') {
            if(typeof args.path==='string' && args.path.startsWith('published/')) {
              const match=/^published\/([\w-]+)\.bin$/.exec(args.path); if(!match) throw new ControlDenied('artifact source');
              const fixed=await this.publications.bytes(operation.run,binding.challengeId!,match[1]);
              result={path:args.path,size:fixed.bytes.length,sha256:fixed.record.sha256,...filePage(fixed.bytes,args.cursor,()=>{throw new ControlDenied('cursor');})};
            } else result=await readWorkspace(roots,args);
          }
          else if (name === 'workspace.diff') {
            const published = [];
            for (const path of new Set([args.a, args.b])) {
              const segments = splitWorkspacePath(path);
              if (segments[0] !== 'published') continue;
              const match = /^published\/([\w-]+)\.bin$/.exec(path as string);
              if (!match) throw new ControlDenied('artifact source');
              const fixed = await this.publications.bytes(operation.run, binding.challengeId!, match[1]);
              published.push({ path: path as string, bytes: fixed.bytes });
            }
            result = await diffWorkspace(roots, args, published);
          }
          else if (name === 'workspace.search') {
            const published=[];
            if(args.path===undefined || args.path===null || typeof args.path==='string'&&args.path.startsWith('published')) {
              for(const r of this.publicationSnapshot().filter(p=>p.source.run===operation.run&&p.source.challenge===binding.challengeId)) {
                const fixed=await this.publications.bytes(operation.run,binding.challengeId!,r.ref);published.push({path:r.path,bytes:fixed.bytes});
              }
            }
            result=await searchWorkspace(roots,args,published);
          }
          else {
            const written=await writeWorkspace(roots,args);result=written;
            if(operation.execution) this.fileSources.set(`${binding.sessionID}/${written.path}`,{sha256:written.sha256,source:{...this.source(binding,'file',call,operation.execution),path:written.path,callID:call}});
          }
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
  private checkDeclaration(binding: Binding, raw: unknown, assigning: boolean): { role: Role; challenge?: string; version?:string } {
    if (binding.role !== 'coordinator') throw new ControlDenied('tool not permitted');
    const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const role = args.role;
    if (!isRole(role) || !CHALLENGE_ROLES.includes(role)) throw new ControlDenied('dispatch', 'role cannot accept challenge');
    if (this.pending.get(binding.sessionID)?.has(role)) throw new ControlDenied('dispatch', 'pending dispatch exists for role');
    if (!assigning) return { role };
    if (this.declarations.get(binding.sessionID)?.has(role)) throw new ControlDenied('dispatch', 'challenge already declared');
    const challenge = args.challenge;
    if (typeof challenge !== 'string' || !this.options.challenges?.some(c => c.id === challenge)) throw new ControlDenied('dispatch', 'challenge outside run');
    const version=args.version;
    if(role==='verifier'&&(typeof version!=='string'||!version))throw new ControlDenied('verification version');
    if(role!=='verifier'&&version!==undefined)throw new ControlDenied('verification role');
    return { role, challenge,version:version as string|undefined };
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
      if ([...this.executions.values()].some(e => e.childID === taskId && (e.state === 'starting' || e.state === 'running'))) throw new ControlDenied('dispatch', 'execution still active');
      if(role==='verifier'&&!this.versions.has(binding.sessionID+'/'+role))throw new ControlDenied('verification version');
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
    if(role==='verifier'&&args.background!==true)throw new ControlDenied('verification execution');
    byRole.set(role, { callID, challengeId, background: args.background === true,version:this.versions.get(binding.sessionID+'/'+role) });
    this.declarations.get(binding.sessionID)?.delete(role);
    this.record(binding.sessionID, 'dispatch.register', true, undefined, { role, callID, challengeId, argsFingerprint: fingerprintJson(args) });
    this.pending.set(binding.sessionID, byRole);
  }

  /** The only place a synchronous call ends its execution; a terminal or cancelled execution is never revived or overwritten by a late event. */
  private settleSync(c: SyncCall, state: 'completed' | 'failed' | 'cancelled'): void {
    const e = this.executions.get(c.execution);
    if (!e || (e.state !== 'starting' && e.state !== 'running')) return;
    e.state = state;
    this.record(c.parent, 'sync.settled', true, undefined, {ref: e.ref, callID: e.callID, childID: e.childID, state});
  }

  private taskEvent(parent: string, body: Record<string, unknown>): {ok: true} {
    const sync=this.syncCalls.get(parent+'/'+body.callID);
    if(sync && body.state==='error' && sync.state!=='done'){sync.state='done';sync.facts=unknownChildResult(sync.source,'native_error');this.settleSync(sync,'failed');for(const [role,waiting] of this.pending.get(parent)??[])if(waiting.callID===sync.callID)this.pending.get(parent)!.delete(role);this.record(parent,'sync.failed',true,undefined,{callID:sync.callID,childID:sync.childID,source:{...sync.source},facts:{...sync.facts}});}
    const execution = [...this.executions.values()].find(e => e.parent === parent && e.callID === body.callID);
    if (!execution || execution.mode !== 'background' || body.state !== 'error' || execution.state !== 'starting') return {ok: true};
    execution.state = 'failed'; execution.delivered = true; execution.delivery = 'stop_reply'; execution.result = typeof body.error === 'string' ? body.error : 'native task error';
    for (const [role, waiting] of this.pending.get(parent) ?? []) if (waiting.callID === execution.callID) this.pending.get(parent)!.delete(role);
    this.record(parent, 'task.start.failed', true, undefined, {ref: execution.ref, callID: execution.callID});
    return {ok: true};
  }

  private freezeChildSource(binding: Binding, body: Record<string, unknown>): void {
    if (binding.via !== 'dispatch') return;
    const candidates = [...this.executions.values()].filter(e => e.childID === binding.sessionID && !e.delivered && (e.state === 'starting' || e.state === 'running'));
    if (!candidates.length) return; // Synchronous resume has no background execution to claim.
    for (const e of candidates) {
      if (e.source.status === 'conflict') continue;
      const id = typeof body.messageID === 'string' && body.messageID.length ? body.messageID : null;
      let reason: string | undefined;
      if (candidates.length !== 1) reason = 'multiple_executions';
      else if (e.parent !== binding.parentID || e.role !== binding.role) reason = 'binding_identity';
      else if (id && e.source.userMessageID && id !== e.source.userMessageID) reason = 'different_user';
      if (reason) e.source = {...e.source,status:'conflict',reason,observedAt:Date.now()};
      else if (!id) { if(e.source.status!=='associated')e.source={status:'unknown',userMessageID:null,reason:'missing_source',observedAt:Date.now()}; }
      else if (e.source.status !== 'associated') e.source={status:'associated',userMessageID:id,reason:'hook',observedAt:Date.now()};
      else continue;
      this.record(binding.sessionID, 'task.source', true, undefined, {ref:e.ref,source:{...e.source}});
    }
  }

  private freezeSyncSource(binding: Binding, body: Record<string, unknown>): void {
    if (binding.via !== 'dispatch' || !binding.parentID) return;
    const candidates = [...this.syncCalls.values()].filter(c => c.parent === binding.parentID && c.state !== 'done' &&
      (c.childID === binding.sessionID || !c.childID && c.callID === binding.dispatchCallID));
    for (const c of candidates) {
      c.childID = binding.sessionID;
      if (c.source.status === 'conflict') continue;
      const id = typeof body.messageID === 'string' && body.messageID.length ? body.messageID : null;
      let reason: string | undefined;
      if (candidates.length !== 1) reason = 'multiple_calls';
      else if (c.role !== binding.role) reason = 'binding_identity';
      else if (id && c.source.userMessageID && id !== c.source.userMessageID) reason = 'different_user';
      if (reason) c.source = {...c.source, status:'conflict', reason, observedAt:Date.now()};
      else if (id && c.source.status !== 'associated') c.source = {status:'associated', userMessageID:id, reason:'hook', observedAt:Date.now()};
      else continue;
      this.record(c.parent, 'sync.source', true, undefined, {callID:c.callID, childID:c.childID, source:{...c.source}});
    }
  }

  private async receiveCompletion(parent: string, body: Record<string, unknown>): Promise<string[]> {
    const accepted: string[] = [];
    let suppressed = false;
    const reads = await this.serial(() => {
      const pending: Array<{ref:string;childID:string;source:ChildSource;ordinaryCompleted:boolean}> = [];
      if (!Array.isArray(body.parts)) return pending;
      for (const part of body.parts as Array<{type?: string; synthetic?: boolean; text?: string}>) {
        if (part.type !== 'text' || part.synthetic !== true || typeof part.text !== 'string') continue;
        const match = /^<task id="([\w.-]+)" state="(completed|error)">\n<summary>Background task (?:completed|failed): \[ctf:([a-f0-9-]{36})\]<\/summary>/.exec(part.text);
        if (!match) continue;
        const e = this.executions.get(match[3]!);
        if (!e || e.parent !== parent || e.childID !== match[1]) throw new ControlDenied('completion correlation');
        if (e.delivered) { e.lateResult=part.text;this.record(parent,'task.completion.ignored',true,undefined,{ref:e.ref,reason:'duplicate or late',messageID:body.messageID});throw new ControlDenied('duplicate completion'); }
        accepted.push(e.ref);
        e.state=match[2]==='completed'?'completed':'failed';e.result=part.text;
        e.noticeMessageID=typeof body.messageID==='string'?body.messageID:undefined;
        e.delivered=true;e.delivery=this.stopReason?'suppressed':'queued';
        e.resultFacts=unknownChildResult(e.source,this.stopReason?'stopped':e.source.status==='conflict'?'source_conflict':'missing_source');
        this.record(parent,'task.completion',true,undefined,{ref:e.ref,childID:e.childID,callID:e.callID,state:e.state,messageID:e.noticeMessageID,wake:!this.stopReason});
        if(!this.stopReason && e.source.status==='associated') pending.push({ref:e.ref,childID:e.childID!,source:{...e.source},ordinaryCompleted:e.state==='completed'});
        else this.record(parent,'task.result',true,undefined,{ref:e.ref,source:{...e.source},resultFacts:{...e.resultFacts}});
      }
      return pending;
    });
    // Public SDK I/O must not occupy the trusted state queue: stop and duplicate notices stay responsive.
    for (const read of reads) {
      let facts: ChildResult;
      try {
        const messages=(await this.options.client.session.messages({sessionID:read.childID},{throwOnError:true})).data;
        facts=messages?classifyChildResult(messages,read.childID,read.source,read.ordinaryCompleted):unknownChildResult(read.source,'sdk_missing');
      } catch { facts=unknownChildResult(read.source,'sdk_error'); }
      await this.serial(() => {
        const e=this.executions.get(read.ref);
        if(!e || e.parent!==parent || e.childID!==read.childID) return;
        const child=this.bindings.get(read.childID);
        if(this.stopReason || child?.state!=='active' || Date.now()>=child.expiresAt) { suppressed=true;e.delivery='suppressed';facts=unknownChildResult(e.source,'stopped'); }
        else if(e.source.status!=='associated' || e.source.userMessageID!==read.source.userMessageID) facts=unknownChildResult(e.source,'source_conflict');
        e.resultFacts=facts;
        this.record(parent,'task.result',true,undefined,{ref:e.ref,source:{...e.source},resultFacts:{...facts}});
      });
    }
    if(this.stopReason || suppressed) throw new ControlDenied('run stopped');
    return accepted;
  }

  /** Audit correlation only: ties the task call to the child session reported by OpenCode, and releases an unconsumed pending slot. */
  private toolAfter(sessionID: string, body: Record<string, unknown>): { ok: true } | Outside {
    if (body.tool === 'task') {
      const metadata = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>;
      const child = typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined;
      const callID = typeof body.callID === 'string' ? body.callID : '';
      this.record(sessionID, 'task.correlate', true, undefined, { callID, childSessionID: child ?? null,
        childBoundToCaller: child ? this.bindings.get(child)?.parentID === sessionID : false });
      const execution = [...this.executions.values()].find(e => e.parent === sessionID && e.callID === callID);
      // A synchronous execution takes its child only from the bind; its wait view below judges any different child as untrusted.
      if (execution?.mode === 'background') { if (child && execution.childID && execution.childID !== child) throw new ControlDenied('completion correlation'); if (child) execution.childID = child; if (execution.initialOutput === undefined && typeof body.output === 'string') execution.initialOutput = body.output; }
      for (const [, waiting] of this.pending.get(sessionID) ?? []) if (waiting.callID === callID && child) waiting.childID = child;
      const c=this.syncCalls.get(sessionID+'/'+callID);
      if(c && c.state==='active') {
        c.state='reading';
        const binding=child?this.bindings.get(child):undefined, parent=this.bindings.get(sessionID);
        const trusted=!!child && metadata.parentSessionId===sessionID && c.childID===child && binding?.parentID===sessionID && binding.role===c.role && parent?.state==='active' && binding.state==='active' && Date.now()<Math.min(parent.expiresAt,binding.expiresAt);
        // The native task wrapper is host output; child report text cannot authorize completion.
        // Promotion returns background metadata and a running envelope through this same hook.
        const ordinaryCompleted=metadata.background!==true && typeof body.output==='string' && body.output.startsWith(`<task id="${child}" state="completed">\n`);
        const source={...c.source};
        return {execute:async()=>{
          let facts=unknownChildResult(source,trusted?(ordinaryCompleted?'missing_source':'native_not_completed'):'binding_identity');
          if(trusted && ordinaryCompleted && !this.stopReason && source.status==='associated') {
            try {const ms=(await this.options.client.session.messages({sessionID:child!},{throwOnError:true})).data;facts=ms?classifyChildResult(ms,child!,source,true):unknownChildResult(source,'sdk_missing');}catch{facts=unknownChildResult(source,'sdk_error');}
          } else if(source.status==='conflict')facts=unknownChildResult(source,'source_conflict');
          return this.serial(()=>{
            const current=this.syncCalls.get(sessionID+'/'+callID), b=child?this.bindings.get(child):undefined, p=this.bindings.get(sessionID);
            if(current!==c || c.state!=='reading')return {ok:true};
            c.state='done';
            if(this.stopReason || p?.state!=='active' || b?.state!=='active' || Date.now()>=Math.min(p.expiresAt,b.expiresAt)){c.facts=unknownChildResult(c.source,'stopped');this.settleSync(c,this.stopReason||p?.state!=='active'||(b&&b.state!=='active')||Date.now()>=Math.min(p.expiresAt,b?.expiresAt??Infinity)?'cancelled':'failed');this.record(sessionID,'sync.result',true,undefined,{callID:c.callID,childID:c.childID,source:{...c.source},facts:{...c.facts}});return {ok:true};}
            if (b.parentID !== sessionID || b.role !== c.role || this.dispatched.get(child!)?.parent !== sessionID || this.dispatched.get(child!)?.role !== c.role) facts=unknownChildResult(c.source,'binding_identity');
            else if(c.source.status!==source.status || c.source.userMessageID!==source.userMessageID || c.childID!==child)facts=unknownChildResult(c.source,'source_conflict');
            c.facts=facts;
            // Promotion (running envelope, background metadata) is not a terminal fact: the execution stays running until a trusted terminal is correlated (design §8.2, Q5).
            if(metadata.background!==true)this.settleSync(c,trusted&&ordinaryCompleted&&facts.reason!=='binding_identity'?'completed':'failed');
            const display={callID:c.callID,role:c.role,completeness:facts.completeness,reason:facts.reason,finish:facts.finish,textChars:facts.completeness==='unknown'?null:facts.textChars,source:c.source.status};
            this.record(sessionID,'sync.result',true,undefined,{callID:c.callID,childID:c.childID,source:{...c.source},facts:{...facts}});
            if(c.displayed)return {ok:true};c.displayed=true;return {ok:true,syncDisplay:display};
          });
        }};
      }
    }
    return { ok: true };
  }
}
