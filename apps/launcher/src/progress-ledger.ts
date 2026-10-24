import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AuditRecord } from './control-service.js';

export interface ToolArgumentSummary {
  summary: Record<string, unknown>;
  fingerprint: string;
}

export interface ProgressEvent {
  v: 1;
  seq: number;
  at: string;
  elapsedMs: number;
  runId: string;
  sessionId: string;
  role?: string;
  challenge?: string;
  kind: 'run' | 'session' | 'model' | 'tool' | 'dispatch' | 'critic' | 'decision' | 'evidence' | 'budget' | 'error';
  op: string;
  status: string;
  summary: string;
  facts?: Record<string, unknown>;
}

interface LedgerNote {
  stage: string;
  route: 'continue' | 'redirect' | 'stop_and_report';
  summary: string;
  blocker?: string;
  repeatedRoute?: string;
  nextAction?: string;
  capabilityGap?: { kind: string; detail: string };
}

interface FinalSummary {
  rootResult?: import('./root-result.js').RootResult;
  trustedResults?: { publications: number; verifications: number; completions: number };
  status: string;
  model: string;
  budget: { maxModelCalls: number; maxObservableTokens: number };
  usage: { availability: string; observableTokens: number; lowerBound: boolean };
}

const PROGRESS_NOTE_STAGES = new Set(['intake', 'recon', 'strategy', 'solve', 'engineering', 'verification', 'recovery', 'finalize']);
const PROGRESS_ROUTES = new Set(['continue', 'redirect', 'stop_and_report']);
const CAPABILITY_GAPS = new Set(['skill', 'reference', 'tool', 'coordination', 'environment', 'unknown']);
const FLAG = /\b(?:flag|ctf|picoctf|htb|ductf|uiuctf|csawctf|asis|hitcon|tjctf)\{[^}\r\n]{1,512}\}/gi;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
}

export function fingerprintJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function redactProgressText(value: string, redactions: readonly string[] = []): string {
  let result = value;
  for (const secret of [...redactions].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('<redacted>');
  return result.replace(FLAG, '<redacted-flag>');
}

function shortText(value: unknown, redactions: readonly string[], max = 500): string {
  return redactProgressText(String(value ?? ''), redactions).slice(0, max);
}

function safeString(value: unknown, redactions: readonly string[]): string | undefined {
  return typeof value === 'string' ? shortText(value, redactions) : undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanUrl(value: unknown, redactions: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return shortText(url.toString(), redactions);
  } catch {
    return shortText(value.split(/[?#]/, 1)[0], redactions);
  }
}

/** A deliberately small, model-visible projection: bodies and values never leave the raw evidence store. */
export function summarizeToolArgs(tool: string, args: Record<string, unknown>, redactions: readonly string[] = []): ToolArgumentSummary {
  let summary: Record<string, unknown>;
  switch (tool) {
    case 'workspace.list': summary = { path: safeString(args.path, redactions) ?? null }; break;
    case 'workspace.read': summary = { path: safeString(args.path, redactions), cursorPresent: args.cursor !== undefined }; break;
    case 'workspace.search': summary = { path: safeString(args.path, redactions) ?? null, patternBytes: typeof args.needle === 'string' ? Buffer.byteLength(args.needle) : null }; break;
    case 'workspace.write': summary = { path: safeString(args.path, redactions), contentBytes: typeof args.content === 'string' ? Buffer.byteLength(args.content) : null, encoding: args.encoding ?? 'utf8' }; break;
    case 'http.request': {
      const headers = object(args.headers);
      summary = { method: typeof args.method === 'string' ? args.method : 'GET', url: cleanUrl(args.url, redactions),
        headerNames: Object.keys(headers).map(name => shortText(name, redactions, 100)).sort(), bodyBytes: typeof args.body === 'string' ? Buffer.byteLength(args.body) : typeof args.body_base64 === 'string' ? Buffer.byteLength(args.body_base64, 'base64') : 0 };
      break;
    }
    case 'job.run': {
      const argv = Array.isArray(args.argv) ? args.argv : [];
      summary = { executable: typeof argv[0] === 'string' ? shortText(basename(argv[0]), redactions, 100) : null, argvCount: argv.length,
        timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : null, preparation: safeString(args.preparation, redactions) ?? null };
      break;
    }
    case 'job.read': summary = { job: safeString(args.job, redactions), stream: safeString(args.stream, redactions), cursorPresent: args.cursor !== undefined }; break;
    case 'job.cancel': summary = { job: safeString(args.job, redactions) }; break;
    case 'artifact.publish': summary = { source: safeString(args.source, redactions), path: safeString(args.path, redactions) ?? null,
      job: safeString(args.job, redactions) ?? null, stream: safeString(args.stream, redactions) ?? null, resource: safeString(args.resource, redactions) ?? null }; break;
    case 'artifact.read': summary = { ref: safeString(args.ref, redactions), cursorPresent: args.cursor !== undefined }; break;
    case 'package.publish': {
      const candidate = object(args.candidate), argv = Array.isArray(args.argv) ? args.argv : [], files = Array.isArray(args.files) ? args.files : [];
      summary = { candidateRef: safeString(candidate.ref, redactions), fileCount: files.length,
        executable: typeof argv[0] === 'string' ? shortText(basename(argv[0]), redactions, 100) : null, argvCount: argv.length };
      break;
    }
    case 'package.read': summary = { version: safeString(args.version, redactions), component: safeString(args.component, redactions), pathPresent: args.path !== undefined, cursorPresent: args.cursor !== undefined }; break;
    case 'package.prepare': summary = {}; break;
    case 'verification.report': summary = { judgment: safeString(args.judgment, redactions), mode: safeString(args.mode, redactions),
      evidenceCount: Array.isArray(args.evidence) ? args.evidence.length : 0, issueCount: Array.isArray(args.issues) ? args.issues.length : 0 }; break;
    case 'verification.read': summary = { challenge: safeString(args.challenge, redactions), version: safeString(args.version, redactions), result: safeString(args.result, redactions), cursorPresent: args.cursor !== undefined }; break;
    case 'completion.request': summary = { challenge: safeString(args.challenge, redactions), version: safeString(args.version, redactions), result: safeString(args.result, redactions) }; break;
    case 'challenge.assign': summary = { role: safeString(args.role, redactions), challenge: safeString(args.challenge, redactions), version: safeString(args.version, redactions) ?? null }; break;
    case 'challenge.unassign': summary = { role: safeString(args.role, redactions) }; break;
    case 'challenge.list': summary = {}; break;
    case 'challenge.read': summary = { id: safeString(args.id, redactions), path: safeString(args.path, redactions), cursorPresent: args.cursor !== undefined }; break;
    case 'task.stop': summary = { taskId: safeString(args.task_id, redactions) }; break;
    case 'progress.read': summary = { limit: typeof args.limit === 'number' ? args.limit : null }; break;
    case 'progress.note': summary = { stage: safeString(args.stage, redactions), route: safeString(args.route, redactions),
      capabilityGap: safeString(object(args.capabilityGap).kind, redactions) ?? null }; break;
    default: summary = { argumentNames: Object.keys(args).sort().map(name => shortText(name, redactions, 100)) };
  }
  return { summary, fingerprint: fingerprintJson({ tool, args }) };
}

function eventKind(op: string, role?: string): ProgressEvent['kind'] {
  if (op === 'progress.note') return role === 'recovery-critic' ? 'critic' : 'decision';
  if (op === 'model.call') return 'model';
  if (op.startsWith('tool.') || /^(artifact|package|verification|completion)\./.test(op)) return 'tool';
  if (/^(assign|dispatch|task\.)/.test(op)) return 'dispatch';
  if (/^budget/.test(op)) return 'budget';
  if (/^(bind|aborted|revoke|stop_|usage\.)/.test(op)) return 'session';
  if (op === 'error') return 'error';
  return 'run';
}

function statusFor(record: AuditRecord, result?: unknown): string {
  if (!record.allow) return record.reason === 'cleanup_unknown' ? 'unknown' : 'denied';
  if (record.op === 'model.call') return 'admitted';
  if (record.op === 'tool.registered' || record.op === 'dispatch.register' || record.op === 'bind') return 'started';
  if (record.op === 'tool.settled') return typeof result === 'string' && result === 'completed' ? 'succeeded' : 'failed';
  if (record.op === 'task.completion' || record.op === 'completion.saved' || record.op === 'progress.note' || record.op === 'verification.registered') return 'completed';
  return 'observed';
}

function pick(detail: Record<string, unknown>, keys: string[], redactions: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = detail[key];
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = shortText(value, redactions);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
    else if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) out[key] = value.map(v => typeof v === 'string' ? shortText(v, redactions, 200) : v);
  }
  return out;
}

function ledgerNote(detail: Record<string, unknown>, redactions: readonly string[]): LedgerNote {
  const gap = object(detail.capabilityGap);
  return {
    stage: shortText(detail.stage, redactions, 40), route: shortText(detail.route, redactions, 40) as LedgerNote['route'],
    summary: shortText(detail.summary, redactions, 800),
    ...(typeof detail.blocker === 'string' ? { blocker: shortText(detail.blocker, redactions, 400) } : {}),
    ...(typeof detail.repeatedRoute === 'string' ? { repeatedRoute: shortText(detail.repeatedRoute, redactions, 400) } : {}),
    ...(typeof detail.nextAction === 'string' ? { nextAction: shortText(detail.nextAction, redactions, 400) } : {}),
    ...(Object.keys(gap).length ? { capabilityGap: { kind: shortText(gap.kind, redactions, 40), detail: shortText(gap.detail, redactions, 500) } } : {})
  };
}

function safeDetail(op: string, raw: unknown, redactions: readonly string[]): Record<string, unknown> {
  const detail = object(raw);
  switch (op) {
    case 'model.call': return pick(detail, ['admitNo', 'maxOutputTokens', 'role', 'provider', 'model'], redactions);
    case 'tool.registered': {
      const safeArgs = object(detail.safeArgs);
      return { callID: safeString(detail.callID, redactions), tool: safeString(detail.tool, redactions), challengeId: safeString(detail.challengeId, redactions),
        safeArgs: Object.fromEntries(Object.entries(safeArgs).map(([k, v]) => [k, typeof v === 'string' ? shortText(v, redactions, 300) : v])),
        argFingerprint: safeString(detail.argFingerprint, redactions) };
    }
    case 'tool.settled': return pick(detail, ['callID', 'tool', 'job', 'result', 'durationMs'], redactions);
    case 'tool.before': case 'tool.execute': case 'tool.after': return pick(detail, ['tool', 'callID', 'result'], redactions);
    case 'assign': case 'assign.clear': return pick(detail, ['role', 'challenge', 'version', 'cleared'], redactions);
    case 'dispatch.register': case 'dispatch.resume': return pick(detail, ['role', 'callID', 'taskId', 'challengeId', 'version', 'argsFingerprint', 'declarationConsumed'], redactions);
    case 'bind': return pick(detail, ['role', 'via', 'callID', 'challengeId', 'sdkMs'], redactions);
    case 'task.correlate': return pick(detail, ['callID', 'childSessionID', 'childBoundToCaller'], redactions);
    case 'task.completion': return pick(detail, ['ref', 'childID', 'callID', 'state', 'wake'], redactions);
    case 'task.start.failed': case 'task.delivered': case 'task.completion.ignored': return pick(detail, ['ref', 'callID', 'reason', 'messageID'], redactions);
    case 'task.cancel': case 'task.stop.result': return pick(detail, ['ref', 'callID', 'state', 'resources', 'sessionAbort', 'executionRef'], redactions);
    case 'progress.note': {
      const note = ledgerNote(detail, redactions);
      return { ...note, ...(note.capabilityGap ? { capabilityGap: note.capabilityGap } : {}) };
    }
    case 'progress.read': return pick(detail, ['limit', 'eventCount'], redactions);
    case 'artifact.published': return pick(detail, ['ref', 'path', 'sha256', 'size'], redactions);
    case 'package.published': return pick(detail, ['ref', 'path', 'sha256', 'size'], redactions);
    case 'package.prepared': return pick(detail, ['preparation', 'directory', 'workspaceDirectory', 'manifestSha256'], redactions);
    case 'verification.registered': return pick(detail, ['challenge', 'version', 'result', 'judgment', 'mode', 'effectiveJudgment'], redactions);
    case 'verification.job.terminal': return pick(detail, ['job', 'state', 'exitCode', 'command'], redactions);
    case 'completion.saved': return pick(detail, ['challenge', 'version', 'result', 'judge', 'candidateSha256', 'candidateSize', 'state', 'solved', 'businessOutcome'], redactions);
    case 'budget_reached': return pick(detail, ['observedTokens'], redactions);
    case 'stop_marked': return pick(detail, ['reason'], redactions);
    case 'aborted': case 'stop_enumerated': case 'usage.read': return pick(detail, ['sessions', 'reason'], redactions);
    default: return {};
  }
}

function summaryFor(record: AuditRecord, facts: Record<string, unknown>, redactions: readonly string[]): string {
  if (!record.allow) return shortText(`${record.op} denied: ${record.reason ?? 'unknown'}`, redactions, 300);
  const tool = typeof facts.tool === 'string' ? facts.tool : undefined;
  if (record.op === 'model.call') return `model call admitted${typeof facts.admitNo === 'number' ? ` #${facts.admitNo}` : ''}`;
  if (record.op === 'tool.registered') return `${tool ?? 'tool'} started`;
  if (record.op === 'tool.settled') return `${tool ?? 'tool'} ${String(facts.result ?? 'settled')}`;
  if (record.op === 'progress.note') return `${record.role === 'recovery-critic' ? 'critic judgement' : 'coordinator decision'}: ${String(facts.route ?? 'observed')}`;
  if (record.op === 'dispatch.register' || record.op === 'dispatch.resume') return `${record.op} ${String(facts.role ?? '')}`.trim();
  if (record.op === 'assign') return `assign ${String(facts.role ?? '')} to ${String(facts.challenge ?? '')}`.trim();
  if (record.op === 'artifact.published' || record.op === 'package.published') return `${record.op} ${String(facts.ref ?? '')}`.trim();
  if (record.op === 'verification.registered') return `verification ${String(facts.effectiveJudgment ?? facts.judgment ?? facts.result ?? 'registered')}`;
  if (record.op === 'completion.saved') return `completion ${String(facts.businessOutcome ?? facts.state ?? 'saved')}${facts.solved === true ? ' solved' : ''}`;
  if (record.op === 'task.completion') return `child task ${String(facts.state ?? 'completed')}`;
  return shortText(record.op, redactions, 300);
}

function projectAudit(audit: readonly AuditRecord[], runId: string, redactions: readonly string[] = []): ProgressEvent[] {
  const starts = new Map<string, number>();
  const startedAt = audit.length ? audit[0]!.at - audit[0]!.t : Date.now();
  return audit.map(record => {
    const raw = object(record.detail);
    const facts = safeDetail(record.op, record.detail, redactions);
    const key = `${record.sessionID}/${String(raw.callID ?? '')}`;
    if (record.op === 'tool.registered' && raw.callID !== undefined) starts.set(key, record.at);
    if (record.op === 'tool.settled' && raw.callID !== undefined && starts.has(key)) {
      facts.durationMs = Math.max(0, record.at - starts.get(key)!);
      starts.delete(key);
    }
    const challenge = record.challengeId ?? safeString(raw.challengeId, redactions) ?? safeString(raw.challenge, redactions);
    return { v: 1 as const, seq: record.seq, at: new Date(record.at).toISOString(), elapsedMs: record.t, runId,
      sessionId: record.sessionID, ...(record.role ? { role: record.role } : {}), ...(challenge ? { challenge } : {}),
      kind: eventKind(record.op, record.role), op: record.op, status: statusFor(record, facts.result),
      summary: summaryFor(record, facts, redactions), ...(Object.keys(facts).length ? { facts } : {}) };
  });
}

export class ProgressLedger {
  private readonly events: ProgressEvent[] = [];
  private readonly directory: string;
  private readonly runId: string;
  private readonly redactions: readonly string[];
  private readonly startedAt: number;
  private tail: Promise<unknown> = Promise.resolve();
  private failure?: unknown;

  constructor(options: { directory: string; runId: string; redactions?: readonly string[]; startedAt?: number }) {
    this.directory = options.directory; this.runId = options.runId; this.redactions = options.redactions ?? []; this.startedAt = options.startedAt ?? Date.now();
  }

  async initialize(): Promise<void> {
    await writeFile(join(this.directory, 'progress.jsonl'), '', { flag: 'wx' });
  }

  append(record: AuditRecord): void {
    const event = projectAudit([record], this.runId, this.redactions)[0]!;
    // A one-record projection cannot compute settle duration; preserve duration from the full in-memory timeline on the next event.
    const prior = this.events.findLast(e => e.op === 'tool.registered' && e.sessionId === event.sessionId && e.facts?.callID === object(record.detail).callID);
    if (event.op === 'tool.settled' && prior) {
      const duration = Math.max(0, Date.parse(event.at) - Date.parse(prior.at));
      event.facts = { ...event.facts, durationMs: duration };
    }
    this.events.push(event);
    this.tail = this.tail.then(() => appendFile(join(this.directory, 'progress.jsonl'), `${JSON.stringify(event)}\n`)).catch(error => { this.failure ??= error; });
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }

  async finalize(summary: FinalSummary): Promise<void> {
    await this.flush();
    const report = renderProgressMarkdown(this.events, summary);
    await writeFile(join(this.directory, 'progress.md'), report, { flag: 'wx' });
  }
}

function repeated(events: readonly ProgressEvent[]): Array<{ tool: string; fingerprint: string; summary: Record<string, unknown>; count: number; calls: string[] }> {
  const groups = new Map<string, { tool: string; fingerprint: string; summary: Record<string, unknown>; count: number; calls: string[] }>();
  for (const event of events) {
    if (event.op !== 'tool.registered') continue;
    const fingerprint = typeof event.facts?.argFingerprint === 'string' ? event.facts.argFingerprint : undefined;
    const tool = typeof event.facts?.tool === 'string' ? event.facts.tool : undefined;
    if (!fingerprint || !tool) continue;
    const key = `${tool}/${fingerprint}`;
    const found = groups.get(key);
    const call = typeof event.facts?.callID === 'string' ? event.facts.callID : '';
    if (found) { found.count++; found.calls.push(call); }
    else groups.set(key, { tool, fingerprint, summary: object(event.facts?.safeArgs), count: 1, calls: call ? [call] : [] });
  }
  return [...groups.values()].filter(group => group.count >= 2).sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}

export function progressDigest(audit: readonly AuditRecord[], input: { runId: string; redactions?: readonly string[]; limit?: number;
  usage?: { availability: string; input: number; output: number; reasoning: number; incomplete: boolean } }): Record<string, unknown> {
  const events = projectAudit(audit, input.runId, input.redactions);
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 80)));
  const compact = (event: ProgressEvent) => ({ seq: event.seq, at: event.at, role: event.role ?? null, challenge: event.challenge ?? null,
    kind: event.kind, op: event.op, status: event.status, summary: event.summary, facts: event.facts ?? {} });
  return {
    schema: 'progress-digest/v1', runId: input.runId, generatedAt: new Date().toISOString(), eventCount: events.length,
    usage: input.usage ? { availability: input.usage.availability, observableTokens: input.usage.input + input.usage.output + input.usage.reasoning, incomplete: input.usage.incomplete } : null,
    repeated: repeated(events).map(group => ({ ...group, fingerprint: group.fingerprint.slice(0, 16) })),
    latestCritic: [...events].reverse().find(event => event.kind === 'critic') ?? null,
    latestDecision: [...events].reverse().find(event => event.kind === 'decision') ?? null,
    recent: events.slice(-limit).map(compact)
  };
}

function cell(value: unknown): string {
  return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function notesOf(events: readonly ProgressEvent[], kind: 'critic' | 'decision'): Array<{ event: ProgressEvent; note: LedgerNote }> {
  return events.filter(event => event.kind === kind).map(event => ({ event, note: ledgerNote(object(event.facts), []) }));
}

export function renderProgressMarkdown(events: readonly ProgressEvent[], summary: FinalSummary): string {
  const lines: string[] = ['# CTF Agent run progress', '', '> 本檔是去敏的人工入口；完整原始訊息仍在 `evidence/`。事件只表示宿主可定位的事實，Critic 判斷不是 solved 依據。', ''];
  lines.push('## Run 摘要', '', `- Status: **${summary.status}**`, `- Model: \`${summary.model}\``,
    `- Budget: ${summary.budget.maxModelCalls} model calls / ${summary.budget.maxObservableTokens} observable tokens`,
    `- Observed: ${summary.usage.availability}, ${summary.usage.observableTokens} tokens${summary.usage.lowerBound ? '（下限／不完整）' : ''}`, '');
  if (summary.rootResult) {
    const r = summary.rootResult;
    lines.push(`- Report completeness: **${r.completeness}** (${r.reason})`,
      `- Report source: user=${r.userMessageID ?? 'unknown'}, assistant=${r.assistantMessageID ?? 'unknown'}; finish=${r.finish ?? 'unknown'}; completed=${r.completed}; textChars=${r.textChars}; hasError=${r.hasError}`,
      `- Report metadata: created=${r.assistantCreated ?? 'unknown'}, completed=${r.assistantCompleted ?? 'unknown'}; evidence: ${r.evidence ?? 'unavailable'}; 判定來源見 state/run.json（收束前觀測凍結，非原子最終快照）; observedAt=${r.observedAt ?? 'unknown'}; exportedSourceMatches=${r.exportedSourceMatches ?? 'unknown'}`,
      '- complete 只表示報告正常結束且有文字，不表示內容正確或 solved。', '');
  }
  if (summary.trustedResults) lines.push(`- 可信產物記錄數量：publications=${summary.trustedResults.publications}, verifications=${summary.trustedResults.verifications}, completions=${summary.trustedResults.completions}；記錄位於 evidence/publications.json、evidence/verification-results.json、evidence/completion-results.json；數量不代表 verified 或 solved。`, '');
  const latestByChallenge = new Map<string, ProgressEvent>();
  for (const event of events) if (event.challenge) latestByChallenge.set(event.challenge, event);
  lines.push('## Challenge 進度', '');
  if (!latestByChallenge.size) lines.push('- 尚未建立 challenge 綁定。');
  else for (const [challenge, event] of latestByChallenge) {
    const shutdownAfterCompletion = summary.status === 'completed' && event.kind === 'session' && /^(aborted|stop_|revoke|usage\.)/.test(event.op);
    if (!shutdownAfterCompletion) {
      lines.push(`- \`${challenge}\`: 最後事件 \`${event.op}\` — ${event.summary}`);
      continue;
    }
    const lastSubstantive = [...events].reverse().find(candidate => candidate.challenge === challenge &&
      !(candidate.kind === 'session' && /^(aborted|stop_|revoke|usage\.)/.test(candidate.op)));
    lines.push(`- \`${challenge}\`: run 正常完成；session 在收束時結束${lastSubstantive ? `。最後非收束事件 \`${lastSubstantive.op}\` — ${lastSubstantive.summary}` : ''}`);
  }
  lines.push('', '## 停滯／重複訊號', '', '> 以下只列重複動作，不自行判定死循環；語義判斷見 Recovery Critic。', '');
  const groups = repeated(events);
  if (!groups.length) lines.push('- 尚無相同工具參數 fingerprint 的重複。');
  else for (const group of groups) lines.push(`- \`${group.tool}\` 重複 ${group.count} 次；fingerprint \`${group.fingerprint.slice(0, 16)}\`；摘要：\`${JSON.stringify(group.summary)}\``);
  lines.push('', '## Recovery Critic 判斷', '');
  const critic = notesOf(events, 'critic');
  if (!critic.length) lines.push('- 尚無 Recovery Critic 結構化判斷。');
  else for (const { event, note } of critic) lines.push(`- **${note.route}**（${note.stage}）${note.summary}${note.blocker ? `；卡點：${note.blocker}` : ''}${note.repeatedRoute ? `；重複路線：${note.repeatedRoute}` : ''}${note.nextAction ? `；下一步：${note.nextAction}` : ''}`);
  lines.push('', '## Coordinator 決策', '');
  const decisions = notesOf(events, 'decision');
  if (!decisions.length) lines.push('- 尚無 Coordinator 結構化決策。');
  else for (const { note } of decisions) lines.push(`- **${note.route}**（${note.stage}）${note.summary}${note.nextAction ? `；下一步：${note.nextAction}` : ''}`);
  lines.push('', '## 能力缺口候選', '');
  const gaps = [...critic, ...decisions].flatMap(({ note }) => note.capabilityGap ? [note.capabilityGap] : []);
  if (!gaps.length) lines.push('- 尚無已記錄的能力缺口。');
  else for (const gap of gaps) lines.push(`- \`${gap.kind}\`: ${gap.detail}`);
  lines.push('', '## 事件時間線', '', '| seq | elapsed | role | challenge | event | status | summary |', '| ---: | ---: | --- | --- | --- | --- | --- |');
  const shown = events.length > 500 ? events.slice(-500) : events;
  if (events.length > shown.length) lines.push('', `> 只顯示最後 ${shown.length} 個事件；完整時間線見 \`progress.jsonl\`。`);
  for (const event of shown) lines.push(`| ${event.seq} | ${event.elapsedMs}ms | ${cell(event.role)} | ${cell(event.challenge)} | \`${cell(event.op)}\` | ${cell(event.status)} | ${cell(event.summary)} |`);
  lines.push('', '## 證據索引', '', '- `progress.jsonl`: 本次 run 的完整去敏事件流。', '- `evidence/control-audit.json`: 原始控制審計。',
    '- `evidence/tool-resources.json`: 工具資源終態。', '- `evidence/task-executions.json`: 子任務生命週期。', '- `evidence/sessions.json`: 會話與 usage 摘要。',
    '- `evidence/messages-*.json`: 完整訊息；可能含候選，只供受控復盤。', '- `evidence/verification-results.json`／`completion-results.json`: 驗證與可信完成結果。', '');
  return lines.join('\n');
}

export function validateProgressNote(raw: unknown): LedgerNote {
  const value = object(raw);
  const stage = typeof value.stage === 'string' ? value.stage : '';
  const route = typeof value.route === 'string' ? value.route : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (!PROGRESS_NOTE_STAGES.has(stage)) throw new Error('progress stage');
  if (!PROGRESS_ROUTES.has(route)) throw new Error('progress route');
  if (!summary || summary.length > 800) throw new Error('progress summary');
  for (const key of ['blocker', 'repeatedRoute', 'nextAction'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 500)) throw new Error(`progress ${key}`);
  }
  let capabilityGap: LedgerNote['capabilityGap'];
  if (value.capabilityGap !== undefined) {
    const gap = object(value.capabilityGap);
    if (typeof gap.kind !== 'string' || !CAPABILITY_GAPS.has(gap.kind) || typeof gap.detail !== 'string' || !gap.detail.trim() || gap.detail.length > 500) throw new Error('progress capability gap');
    capabilityGap = { kind: gap.kind, detail: gap.detail.trim() };
  }
  return { stage, route: route as LedgerNote['route'], summary,
    ...(typeof value.blocker === 'string' ? { blocker: value.blocker.trim() } : {}),
    ...(typeof value.repeatedRoute === 'string' ? { repeatedRoute: value.repeatedRoute.trim() } : {}),
    ...(typeof value.nextAction === 'string' ? { nextAction: value.nextAction.trim() } : {}),
    ...(capabilityGap ? { capabilityGap } : {}) };
}
