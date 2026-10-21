import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventDelta } from '@ctf/contracts';

export interface SafeRunError {
  status_code?: number;
  provider_code?: string;
  provider_type?: string;
  summary: string;
  reset_at?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : undefined;
}

/** Convert provider or runtime exceptions to a small, allowlisted, secret-free record. */
export function normalizeRunError(value: unknown): SafeRunError {
  const top = record(value);
  const data = record(top?.data) ?? record(top?.cause) ?? top;
  const status = Number(data?.statusCode ?? data?.status_code);
  const statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const body = data?.responseBody ?? data?.response_body;
  let providerError: Record<string, unknown> | undefined;
  if (typeof body === 'string') {
    try { providerError = record(record(JSON.parse(body))?.error); } catch { /* raw response bodies never enter the report */ }
  }
  const code = safeLabel(providerError?.code ?? data?.code);
  const type = safeLabel(providerError?.type ?? data?.type);
  const message = typeof providerError?.message === 'string' ? providerError.message : '';
  const resetMatch = message.match(/reset at ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} [+-][0-9]{4} [A-Z]{2,8})/);
  const resetAt = resetMatch?.[1];
  const name = safeLabel(top?.name);
  if (code === 'AccountQuotaExceeded' || /5.hour.{0,20}quota|quota.{0,20}5.hour/i.test(message)) {
    return { ...(statusCode ? { status_code: statusCode } : {}), ...(code ? { provider_code: code } : {}),
      ...(type ? { provider_type: type } : {}), summary: 'Provider 5-hour usage quota exhausted', ...(resetAt ? { reset_at: resetAt } : {}) };
  }
  if (statusCode === 429) return { status_code: statusCode, ...(code ? { provider_code: code } : {}),
    ...(type ? { provider_type: type } : {}), summary: 'Provider rate limit or quota rejected the request' };
  if (statusCode === 401 || statusCode === 403) return { status_code: statusCode,
    ...(code ? { provider_code: code } : {}), ...(type ? { provider_type: type } : {}), summary: 'Provider authentication or permission rejected the request' };
  if (statusCode && statusCode >= 500) return { status_code: statusCode,
    ...(code ? { provider_code: code } : {}), ...(type ? { provider_type: type } : {}), summary: 'Provider service returned a server error' };
  const errorText = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  if (/resource_exhausted/i.test(errorText)) return { summary: 'Run stopped at a configured resource boundary' };
  if (/aborterror|cancelled|canceled/i.test(name ?? errorText)) return { summary: 'Run was cancelled before completion' };
  if (name) return { summary: `Run stopped after ${name}` };
  return { summary: 'Run stopped because of an unclassified runtime error' };
}

type EventView = EventDelta & { activity?: string; data?: Record<string, unknown> };
export interface EventReference { seq: number; jsonlLine: number }

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return record(value);
  try { return record(JSON.parse(value)); } catch { return undefined; }
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512 || value.includes('\\')) return undefined;
  let path = value;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      path = url.pathname;
    } catch { return undefined; }
  }
  path = path.split(/[?#]/, 1)[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) return undefined;
  const routeIds = new Set(['team', 'user', 'challenge', 'chal', 'solve', 'submission', 'page', 'host',
    'login', 'register', 'logout', 'reset_password']);
  const safe = parts.map((part, index) => {
    if (/^(?:derived|workspaces?)$/i.test(part)) return part.toLowerCase();
    if (/^(?:tar-)?[a-f0-9]{16,}$/i.test(part) || /^[a-f0-9-]{32,}$/i.test(part)) return '{id}';
    if (/^\d{1,12}$/.test(part)) return '{id}';
    if (index > 0 && routeIds.has(parts[index - 1]!.toLowerCase())) return '{id}';
    if (/^(?:token|secret|key|flag|candidate|oracle|cookie|session|password|passwd|auth|credential|private)s?$/i.test(part)) return '{redacted}';
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(part)) return '{redacted}';
    return part;
  });
  if (safe[0]?.toLowerCase() === 'derived' && safe.length > 2) safe.splice(1, 1);
  return `/${safe.join('/')}`;
}

function safeWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) return undefined;
  if (value === '.') return '/';
  return safePath(value);
}

function collectText(value: unknown, into: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === 'string') { into.push(value); return; }
  if (Array.isArray(value)) { for (const child of value) collectText(child, into, depth + 1); return; }
  const object = record(value);
  if (object) for (const child of Object.values(object)) collectText(child, into, depth + 1);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = record(value);
  if (object) return `{${Object.keys(object).filter(key => !/^(?:observation_ref|source_ref|range_ref|next_cursor|body_ref|artifact_refs|cursor)$/i.test(key))
    .sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function fingerprint(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
function msLabel(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '時間未記錄';
  const seconds = ms / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}
function outcomeOf(observation: Record<string, unknown> | undefined): string {
  const value = observation?.outcome;
  return value === 'success' ? 'success' : value === 'error' || value === 'failure' || value === 'failed' ? 'failure' : 'unknown';
}
function failureClass(observation: Record<string, unknown> | undefined, raw: Record<string, unknown> | undefined): string {
  const text: string[] = [];
  collectText([observation?.failure_code, observation?.raw, raw], text);
  const joined = text.join(' ').toLowerCase();
  if (/eisdir|is a directory|expected.{0,20}file|file.{0,20}required|not a regular file/.test(joined) ||
    (/file/.test(joined) && /list/.test(joined) && /require/.test(joined))) return '操作要求檔案；先列出目錄項目';
  if (/enoent|not found|no such file/.test(joined)) return '路徑不存在或未找到';
  if (/permission|eacces|denied/.test(joined)) return '操作遭到權限拒絕';
  if (/invalid|unsupported|bad input/.test(joined)) return '輸入格式不受支援';
  return '工具操作失敗；原始錯誤已脫敏省略';
}

interface Operation {
  tool: string; receipt?: string; start?: EventView; result?: EventView; startRef?: EventReference; resultRef?: EventReference;
  input?: Record<string, unknown>; observation?: Record<string, unknown>; raw?: Record<string, unknown>;
  index: number; resultIndex?: number; startOffset?: number; endOffset?: number;
}

function refText(ref: EventReference | undefined): string {
  return ref ? `seq ${ref.seq} / JSONL 行 ${ref.jsonlLine} ([證據](canonical-events.jsonl#L${ref.jsonlLine}))` : '缺少事件來源';
}
function timeText(offset: number | undefined): string { return offset === undefined ? '時間未記錄' : `T+${msLabel(offset)}`; }
function operationTime(op: Operation): string {
  return `${timeText(op.startOffset ?? op.endOffset)}${op.endOffset !== undefined ? ` → ${timeText(op.endOffset)}` : ''}`;
}
function errorCategory(error: SafeRunError): string { return error.provider_code === 'AccountQuotaExceeded' ? '服務商 5 小時額度停止' : '執行環境停止'; }

function rawTarget(op: Operation): string {
  return String(op.raw?.url ?? op.input?.url ?? '');
}

function targetPath(op: Operation): string {
  return safePath(rawTarget(op)) ?? '/{redacted}';
}

function classifyHttpAction(op: Operation): string {
  const method = String(op.raw?.method ?? op.input?.method ?? 'GET').toUpperCase();
  let path = '';
  let params: URLSearchParams | undefined;
  try { const url = new URL(rawTarget(op)); path = url.pathname; params = url.searchParams; }
  catch { path = rawTarget(op).split(/[?#]/, 1)[0] ?? ''; }
  const lower = path.toLowerCase();
  const command = params?.get('cmd')?.toLowerCase();
  const hasDebuggerMarker = params?.has('__debugger__') === true;
  const debuggerQuery = hasDebuggerMarker || params?.has('cmd') || ((params?.has('s') || params?.has('expr')) && /(?:debugger|console|team)\//i.test(path));
  if (command === 'resource') return 'debugger 資源讀取';
  if (command === 'pinauth' || (hasDebuggerMarker && params?.has('pin'))) return 'debugger PIN 認證嘗試（值已隱去）';
  if (debuggerQuery) {
    if (command === 'evaluate' || command === 'execute' || command === 'eval') return 'debugger 表達式評估探查（值已隱去）';
    if (command && /[^a-z0-9_.-]/i.test(command)) return 'debugger 表達式命令探查（值已隱去）';
    return 'debugger 未知命令探查（值已隱去）';
  }
  if (/\/static\//.test(lower) || /\.(?:js|css|png|jpe?g|gif|svg|ico|woff2?)$/i.test(lower)) return '靜態資源讀取';
  if (/(?:^|\/)(?:console|debugger)(?:\/|$)/i.test(lower)) return 'debugger 端點探索';
  if (/^\/(?:login|register|logout)(?:\/|$)/i.test(lower) || (method === 'POST' && /(?:login|register|logout|reset_password)/i.test(lower))) return '認證／session 操作';
  if (method === 'GET' && /\/reset_password(?:\/|$)/i.test(lower)) return '帳戶復原頁面存取';
  if (/^\/admin(?:\/|$)/i.test(lower)) return '管理介面路由探查';
  if (/^\/api(?:\/|$)/i.test(lower)) return 'API 路由請求';
  if (/^\/(?:chals?|challenges?|teams?|solves?|scoreboard)\/?$/i.test(lower)) return '集合／列表路由請求';
  if (/^\/(?:robots\.txt|flag|files?)(?:\/|$)/i.test(lower)) return '檔案／metadata 路由探查';
  const segments = path.split('/').filter(Boolean);
  const parameterNames = new Set(['team', 'user', 'challenge', 'chal', 'solve', 'submission', 'page', 'host', 'file']);
  const parameterIndex = segments.findIndex(segment => parameterNames.has(segment.toLowerCase())) + 1;
  if (parameterIndex > 0 && segments[parameterIndex]) {
    let value = segments[parameterIndex]!;
    try { value = decodeURIComponent(value); } catch { /* shape classification still uses encoded form */ }
    if (/[<>{}'"`;$()\[\]]/.test(value)) return '表達式形狀路徑參數探查（值已隱去）';
    if (/%[0-9a-f]{2}/i.test(segments[parameterIndex]!)) return '編碼路徑參數探查（值已隱去）';
    if (/^\d+$/.test(value)) return '數字路徑參數請求（值已隱去）';
    return '非數字路徑參數探查（值已隱去）';
  }
  return '其他目標路由請求';
}

function actionCategory(op: Operation, httpByObservation: Map<string, Operation>): string {
  if (op.tool.startsWith('workspace.')) return '題目材料操作';
  if (op.tool === 'http.request') return classifyHttpAction(op);
  if (op.tool === 'observation.read') {
    const source = typeof op.input?.ref === 'string' ? httpByObservation.get(op.input.ref) : undefined;
    return source ? classifyHttpAction(source) : '來源未關聯的回應續讀';
  }
  if (op.tool === 'job.run') return '受管工作執行';
  return '其他工具活動';
}

function safeMime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const mime = value.split(';', 1)[0]?.trim().toLowerCase();
  return mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : undefined;
}

function responseFacts(op: Operation): string[] {
  const raw = op.raw ?? {};
  const facts: string[] = [];
  if (typeof raw.complete === 'boolean') facts.push(raw.complete ? '回應主體完整' : '回應主體不完整');
  if (typeof raw.body_size === 'number' && Number.isFinite(raw.body_size)) facts.push(`${raw.body_size} 位元組`);
  if (typeof raw.body_fully_inline === 'boolean') facts.push(raw.body_fully_inline ? '主體內嵌於觀察資料' : '主體存於附件');
  const mime = safeMime(raw.content_type);
  if (mime) facts.push(`內容類型 ${mime}`);
  const redirect = safePath(raw.redirect_location);
  if (redirect) facts.push(`重新導向至 ${redirect}`);
  const sent = Array.isArray(raw.cookie_names_sent) ? raw.cookie_names_sent.length : undefined;
  if (sent !== undefined) facts.push(sent ? 'cookie metadata 記錄有送出 cookie（值已隱去）' : '未送出 cookie');
  return facts;
}

function continuationFacts(op: Operation): string[] {
  const raw = op.raw ?? {};
  const facts: string[] = [];
  if (typeof raw.cursor === 'number' && Number.isFinite(raw.cursor)) facts.push(`續讀位置 ${raw.cursor}`);
  if (typeof raw.next_cursor === 'number' && Number.isFinite(raw.next_cursor)) facts.push(`下一續讀位置 ${raw.next_cursor}`);
  if (typeof raw.eof === 'boolean') facts.push(raw.eof ? '已到回應末尾' : '回應仍有後續內容');
  if (typeof raw.size === 'number' && Number.isFinite(raw.size)) facts.push(`可讀取 ${raw.size} 位元組`);
  return facts;
}

function emptyJsonCollections(op: Operation): string[] {
  const raw = op.raw ?? {};
  if (safeMime(raw.content_type) !== 'application/json') return [];
  const body = raw.body ?? raw.body_preview;
  if (typeof body !== 'string' || body.length > 65536) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return []; }
  const found: string[] = [];
  const visit = (value: unknown, prefix: string, depth: number) => {
    if (depth > 5) return;
    if (Array.isArray(value)) { if (value.length === 0 && prefix) found.push(prefix); return; }
    const object = record(value);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key) || /(?:secret|token|password|cookie|flag|answer|candidate|oracle|key)/i.test(key)) continue;
      visit(child, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
  };
  visit(parsed, '', 0);
  return [...new Set(found)].slice(0, 8);
}

function businessSignals(op: Operation): string[] {
  const signals = httpSignals(op);
  if (signals.includes('auth=false')) signals.push('認證業務狀態未建立');
  if (signals.includes('認證失敗訊號')) signals.push('認證業務操作遭拒');
  for (const field of emptyJsonCollections(op)) signals.push(`回應 JSON 的 ${field} 是空清單`);
  return [...new Set(signals)];
}

function actionLabel(op: Operation, httpByObservation: Map<string, Operation>): string {
  if (op.tool === 'http.request') {
    const method = safeLabel(op.raw?.method ?? op.input?.method) ?? 'HTTP';
    return `${method} ${targetPath(op)} [${classifyHttpAction(op)}]`;
  }
  if (op.tool === 'observation.read') {
    const source = typeof op.input?.ref === 'string' ? httpByObservation.get(op.input.ref) : undefined;
    return source ? `續讀 ${classifyHttpAction(source)} 回應` : '續讀未關聯來源的回應';
  }
  const path = safeWorkspacePath(op.input?.path ?? op.raw?.path) ?? (op.tool === 'workspace.list' ? '/' : '路徑已隱去');
  const verb: Record<string, string> = { 'workspace.list': '列出材料目錄', 'workspace.unpack': '解包提供的附件',
    'workspace.read': '讀取材料檔案', 'workspace.search': '搜尋材料檔案', 'workspace.patch': '修改工作區檔案', 'job.run': '執行受管工作' };
  return `${verb[op.tool] ?? op.tool} ${path}`;
}

function responseLabel(op: Operation): string {
  if (!op.result) return '結果未記錄';
  if (outcomeOf(op.observation) === 'failure') return `工具失敗：${failureClass(op.observation, op.raw)}`;
  if (op.tool === 'http.request') {
    const status = Number(op.raw?.status);
    return Number.isInteger(status) ? `HTTP ${status}` : 'HTTP 狀態未知';
  }
  return outcomeOf(op.observation);
}

export function renderRunPostmortem(input: {
  result: Record<string, unknown>; events: EventDelta[]; eventRefs?: EventReference[]; safeError?: SafeRunError;
}): string {
  const events = input.events as EventView[];
  const result = input.result;
  const budget = record(result.budget) ?? {};
  const usage = record(result.provider_usage) ?? {};
  const safeError = input.safeError ?? (record(result.safe_error) as SafeRunError | undefined);
  const refs = input.eventRefs ?? events.map((event, index) => ({ seq: index + 1, jsonlLine: index + 1 }));
  const refByIndex = new Map(events.map((_, index) => [index, refs[index] ?? { seq: index + 1, jsonlLine: index + 1 }]));
  const times = events.map(event => Date.parse(event.at)).filter(Number.isFinite);
  const firstTime = times.length ? Math.min(...times) : undefined;
  const atOffset = (event: EventView | undefined): number | undefined => {
    const at = event?.at ? Date.parse(event.at) : NaN;
    return Number.isFinite(at) && firstTime !== undefined && at >= firstTime ? at - firstTime : undefined;
  };
  const operations: Operation[] = [];
  const pending = new Map<string, Operation>();
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (event.activity !== 'tool.started' && event.activity !== 'tool.result') continue;
    const data = event.data ?? {};
    const tool = safeLabel(data.tool) ?? 'unknown-tool';
    const receipt = typeof data.receipt_id === 'string' ? data.receipt_id : undefined;
    if (event.activity === 'tool.started') {
      const op: Operation = { tool, receipt, start: event, startRef: refByIndex.get(index), input: record(data.input), index, startOffset: atOffset(event) };
      operations.push(op);
      if (receipt) pending.set(receipt, op);
    } else {
      const op = receipt ? pending.get(receipt) : undefined;
      const observation = record(data.observation);
      if (op && !op.result && op.tool === tool) {
        op.result = event; op.resultRef = refByIndex.get(index); op.observation = observation;
        op.raw = parseJson(observation?.raw); op.endOffset = atOffset(event); op.resultIndex = index;
        if (receipt) pending.delete(receipt);
      } else {
        operations.push({ tool, receipt, result: event, resultRef: refByIndex.get(index), observation,
          raw: parseJson(observation?.raw), index, resultIndex: index, endOffset: atOffset(event) });
      }
    }
  }
  operations.sort((a, b) => a.index - b.index);

  const httpOps = operations.filter(op => op.tool === 'http.request');
  const httpSource = new Map<string, Operation>();
  for (const op of httpOps) if (typeof op.raw?.observation_ref === 'string') httpSource.set(op.raw.observation_ref, op);
  const operationInputs = operations.map(op => ({ op, hash: fingerprint(op.input ?? {}) }));
  const exactDuplicates = new Map<string, Operation[]>();
  for (const { op, hash } of operationInputs) {
    if (!op.result) continue;
    const signature = `${op.tool}:${hash}:${fingerprint({ outcome: outcomeOf(op.observation), failure: op.observation?.failure_code,
      raw: op.raw })}`;
    const group = exactDuplicates.get(signature) ?? []; group.push(op); exactDuplicates.set(signature, group);
  }
  const duplicateGroups = [...exactDuplicates.values()].filter(group => group.length > 1);
  const activityCounts = new Map<string, number>();
  for (const event of events) if (event.activity) activityCounts.set(event.activity, (activityCounts.get(event.activity) ?? 0) + 1);
  const countTool = (name: string, which: 'start' | 'result' | 'failed') => operations.filter(op => op.tool === name &&
    (which === 'start' ? !!op.start : which === 'result' ? !!op.result : !!op.result && outcomeOf(op.observation) === 'failure')).length;
  const modelCalls = activityCounts.get('driver.call') ?? 0;
  const completedResponses = Number(usage.completed_assistant_responses);
  const toolStarts = operations.filter(op => !!op.start).length;
  const toolResults = operations.filter(op => !!op.result).length;
  const candidateEvents = events.filter(event => event.activity === 'candidate');
  const candidateStageEvents = events.filter(event => event.activity === 'candidate.stage');
  const candidateStatuses = candidateEvents.map(event => safeLabel(event.data?.status) ?? 'registered');
  const candidateState = candidateStatuses.length ? candidateStatuses.join(', ') : '沒有候選';
  const oracleStarts = candidateStageEvents.filter(event => event.data?.stage === 'oracle_submit' && event.data?.state === 'started');
  const oracleResults = candidateStageEvents.filter(event => event.data?.stage === 'oracle_submit' && event.data?.state === 'completed');
  const wallMs = Number(budget.wallClockMs);
  const observableUsed = Number(budget.maxObservableTokens);
  const observableLimit = Number(budget.authorizedObservableTokenLimit ?? budget.observableTokenLimit ?? budget.tokenLimit);
  const maxToolJobs = Number(budget.maxToolJobs);
  const httpStarted = countTool('http.request', 'start');
  const httpResults = countTool('http.request', 'result');
  const httpStatuses = new Map<string, number>();
  for (const op of httpOps) if (op.result) {
    const status = Number(op.raw?.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) httpStatuses.set(String(status), (httpStatuses.get(String(status)) ?? 0) + 1);
  }
  const readOps = operations.filter(op => op.tool === 'workspace.read');
  const listOps = operations.filter(op => op.tool === 'workspace.list');
  const searchOps = operations.filter(op => op.tool === 'workspace.search');
  const unpackOps = operations.filter(op => op.tool === 'workspace.unpack');
  const workspaceOps = operations.filter(op => op.tool.startsWith('workspace.'));
  const observationOps = operations.filter(op => op.tool === 'observation.read');
  const evidenceEvents = events.filter(event => event.activity === 'candidate' || event.activity === 'candidate.stage');
  const activitySegments: Array<{ categories: string[]; operations: Operation[] }> = [];
  for (const op of operations) {
    const category = actionCategory(op, httpSource);
    const last = activitySegments.at(-1);
    const previous = last?.operations.at(-1);
    const gapMs = previous?.endOffset !== undefined && op.startOffset !== undefined
      ? op.startOffset - previous.endOffset : 0;
    if (last && gapMs <= 60_000) {
      last.operations.push(op);
      if (!last.categories.includes(category)) last.categories.push(category);
    } else activitySegments.push({ categories: [category], operations: [op] });
  }
  const lines: string[] = [
    '# Run 復盤', '',
    `**結果：** ${String(result.outcome ?? 'unknown')} / ${String(result.solve_state ?? 'unknown')}。${safeError?.summary ?? (result.outcome === 'solved' ? 'Host 記錄為已接受。' : candidateEvents.length ? '候選未取得權威接受。' : 'Run 結束時沒有權威接受的候選。')}`,
    '',
    '## 先看這次做到哪裡', '',
    `- **停止分類：** ${safeError ? errorCategory(safeError) : result.outcome === 'solved' ? '完成' : 'run 結束；沒有安全化錯誤分類'}${safeError?.status_code ? `（HTTP ${safeError.status_code}${safeError.provider_code ? ` / ${safeError.provider_code}` : ''}${safeError.provider_type ? ` / ${safeError.provider_type}` : ''}）` : ''}${safeError?.reset_at ? `；原時區重置時間 ${safeError.reset_at}` : ''}。`,
    `- **本次路徑：** 工具 start/result ${toolStarts}/${toolResults}；${workspaceOps.length} 個工作區操作（讀取 ${readOps.length}、列出 ${listOps.length}、搜尋 ${searchOps.length}、解包 ${unpackOps.length}）；${httpStarted} 個 HTTP 工具啟動、${httpResults} 個 HTTP 結果（${[...httpStatuses].sort(([a],[b]) => Number(a)-Number(b)).map(([status,n]) => `${status} × ${n}`).join('、') || '無可讀狀態碼'}）；${observationOps.length} 次回應續讀。`,
    `- **模型與限制：** ${modelCalls} 次 admitted provider call；${Number.isFinite(completedResponses) ? `${completedResponses} 則沒有 error 的已完成 OpenCode assistant 回應` : '已完成 assistant 回應數未記錄'}（訊息完成數，不保證與 provider 傳輸一對一）。${Number.isFinite(maxToolJobs) ? `受管 job.run jobs 使用 ${maxToolJobs}；步數 ${String(budget.maxSteps ?? '未記錄')}。` : '受管 job.run jobs 用量未記錄。'} ${Number.isFinite(wallMs) ? `耗時 ${msLabel(wallMs)}（分:秒）。` : '耗時未記錄。'} Observable token 使用 ${Number.isFinite(observableUsed) ? observableUsed.toLocaleString('en-US') : 'unavailable'}${Number.isFinite(observableLimit) ? ` / ${observableLimit.toLocaleString('en-US')}` : ''}；${usage.availability === 'observed' ? `provider 回報 input/output ${String(usage.input_tokens ?? 'unknown')}/${String(usage.output_tokens ?? 'unknown')}` : 'provider input/output usage unavailable'}。`,
    `- **候選與裁判：** ${candidateState}；獨立驗證事件 ${candidateStageEvents.filter(event => event.data?.stage === 'verification').length} 次，oracle 提交啟動/完成 ${oracleStarts.length}/${oracleResults.length} 次。候選值與裁判答案不顯示。`,
    `- **candidate 狀態：** ${candidateEvents.length ? '已登記' : '未登記'}；oracle 狀態：${oracleResults.length ? '有完成事件' : '沒有完成事件'}。`,
    '',
    '## 按連續活動分段', '',
    '按工具操作間隔整理連續活動；超過 60 秒的無操作間隔會開始新段。這只是時間分段，不代表模型因果判斷。每段列活動類型、實際回饋、證據和下一段最先記錄的操作；未記錄的選擇理由保留為未知。', ''
  ];
  const seenCategories = new Set<string>();
  for (let index = 0; index < activitySegments.length; index++) {
    const segment = activitySegments[index]!;
    const first = segment.operations[0]!;
    const last = segment.operations.at(-1)!;
    const firstRef = first.startRef ?? first.resultRef;
    const lastRef = last.resultRef ?? last.startRef;
    lines.push(`### 活動段 ${index + 1}（${timeText(first.startOffset ?? first.endOffset)}–${timeText(last.endOffset ?? last.startOffset)}；${segment.operations.length} 項操作；涉及 ${segment.categories.join('、')}；證據 ${refText(firstRef)} 至 ${refText(lastRef)}）`, '');
    const summaries: Array<{ description: string; operations: Operation[] }> = [];
    for (const op of segment.operations) {
      const facts = op.tool === 'http.request' ? responseFacts(op) : op.tool === 'observation.read' ? continuationFacts(op) : [];
      const signals = businessSignals(op);
      const category = actionCategory(op, httpSource);
      const method = op.tool === 'http.request' ? `${safeLabel(op.raw?.method ?? op.input?.method) ?? 'HTTP'} ` : '';
      const isFailure = outcomeOf(op.observation) === 'failure';
      const redirect = facts.find(fact => fact.startsWith('重新導向至 '));
      const key = `${category}：${method}${isFailure ? `${actionLabel(op, httpSource)} → ` : ''}${responseLabel(op)}`
        + (redirect ? `（${redirect}）` : '') + (facts.length && op.tool === 'observation.read' ? `（${facts.join('；')}）` : '')
        + (signals.length ? `【${signals.join('；')}】` : '');
      const lastSummary = summaries.at(-1);
      if (lastSummary?.description === key) lastSummary.operations.push(op);
      else summaries.push({ description: key, operations: [op] });
    }
    for (const { description, operations: grouped } of summaries) {
      const firstEvidence = grouped[0]!.startRef ?? grouped[0]!.resultRef;
      const lastEvidence = grouped.at(-1)!.resultRef ?? grouped.at(-1)!.startRef;
      lines.push(`- ${description}${grouped.length > 1 ? `（${grouped.length} 次相鄰同類操作）` : ''}；證據 ${refText(firstEvidence)} 至 ${refText(lastEvidence)}。`);
    }
    const next = activitySegments[index + 1];
    if (next) {
      const nextOp = next.operations[0]!;
      const nextCategory = actionCategory(nextOp, httpSource);
      const returned = seenCategories.has(nextCategory);
      lines.push(`- **下一段最先記錄的操作：** ${nextCategory}，${actionLabel(nextOp, httpSource)} → ${responseLabel(nextOp)}（${refText(nextOp.startRef ?? nextOp.resultRef)}）。${returned ? '此前相同活動類別再次出現；這只表示類別重現，不代表沿用策略。' : ''}只能確認順序；是否因前段回饋換路未知。`);
    }
    for (const category of segment.categories) seenCategories.add(category);
    lines.push('');
  }
  if (!activitySegments.length) lines.push('- 沒有配對到的工具操作。', '');
  lines.push('## 候選與裁判', '');
  if (!evidenceEvents.length) lines.push('- 沒有候選登記、獨立驗證或 oracle 提交事件；本次未提交答案。');
  for (const event of evidenceEvents) {
    const eventIndex = events.indexOf(event);
    const ref = refByIndex.get(eventIndex);
    const stage = event.activity === 'candidate' ? `候選狀態 ${safeLabel(event.data?.status) ?? 'registered'}`
      : `${safeLabel(event.data?.stage) ?? 'verification'} ${safeLabel(event.data?.state) ?? 'unknown'}`;
    lines.push(`- ${stage}（${refText(ref)}）。候選內容已隱去。`);
  }

  const blockers: string[] = [];
  const failedOps = operations.filter(op => op.result && outcomeOf(op.observation) === 'failure');
  if (failedOps.length) {
    blockers.push('### 工具操作失敗', '');
    for (const op of failedOps) {
      const after = op.resultIndex ?? op.index;
      const next = operations.find(candidate => candidate.index > after);
      if (op.tool === 'observation.read') {
        const sourceRef = typeof op.input?.ref === 'string' ? op.input.ref : undefined;
        const laterReads = operations.filter(candidate => candidate.tool === 'observation.read' && candidate.index > after &&
          typeof candidate.input?.ref === 'string' && candidate.input.ref === sourceRef);
        const succeededRead = laterReads.find(candidate => candidate.result && outcomeOf(candidate.observation) === 'success');
        const source = sourceRef ? httpSource.get(sourceRef) : undefined;
        const laterFacts = succeededRead ? continuationFacts(succeededRead) : [];
        const progress = succeededRead
          ? `同一觀察來源之後有一次續讀成功（${refText(succeededRead.startRef)}；結果 ${refText(succeededRead.resultRef)}${laterFacts.length ? `；${laterFacts.join('；')}` : ''}）；${laterFacts.includes('已到回應末尾') ? '記錄到該次續讀已到回應末尾' : '不能由此證明整份回應已讀完'}`
          : '未見同一觀察來源的後續成功續讀，後續讀取狀態未知';
        blockers.push(`- observation.read 續讀失敗（開始 ${refText(op.startRef)}；失敗 ${refText(op.resultRef)}）。${source ? `來源操作為 ${actionLabel(source, httpSource)}（${refText(source.resultRef)}）。` : ''}失敗後第一項新工具活動${next ? `是 ${actionLabel(next, httpSource)}（${refText(next.startRef ?? next.resultRef)}）` : '未記錄'}；${progress}。原始讀取錯誤已脫敏，事件未提供可確認的具體原因。`);
        continue;
      }
      const laterWorkspace = operations.filter(candidate => candidate.tool.startsWith('workspace.') && candidate.index > after);
      const failedPath = typeof op.input?.path === 'string' ? op.input.path.replace(/\/+$/, '') : '';
      const samePathList = laterWorkspace.find(candidate => candidate.tool === 'workspace.list' && candidate.input?.path === op.input?.path);
      const descendantRead = failedPath ? laterWorkspace.find(candidate => candidate.tool === 'workspace.read' &&
        typeof candidate.input?.path === 'string' && candidate.input.path.startsWith(`${failedPath}/`)) : undefined;
      const followup = samePathList ? `後續有對同路徑執行 workspace.list（${refText(samePathList.startRef ?? samePathList.resultRef)}）`
        : descendantRead ? `未見同路徑 workspace.list；之後改為讀取該目錄下的檔案（${refText(descendantRead.startRef ?? descendantRead.resultRef)}），這是後續讀取，不足以證明搜尋錯誤當下已被修正`
        : '後續未見同路徑列目錄或子檔案讀取，是否修正未知';
      blockers.push(`- ${op.tool}：${failureClass(op.observation, op.raw)}（開始 ${refText(op.startRef)}；失敗 ${refText(op.resultRef)}）。失敗後第一項新工具活動${next ? `是 ${actionLabel(next, httpSource)}（${refText(next.startRef ?? next.resultRef)}）` : '未記錄'}；${followup}。這些是操作先後事實，是否因此換路未知。`);
    }
    blockers.push('');
  }
  const negativeOps: Operation[] = [];
  for (const op of httpOps) {
    const status = Number(op.raw?.status);
    if (!Number.isFinite(status) || status < 400 || status > 599) continue;
    negativeOps.push(op);
  }
  if (negativeOps.length) {
    blockers.push('### 目標負向回饋', '');
    for (const op of negativeOps) {
      const next = operations.find(candidate => candidate.index > (op.resultIndex ?? op.index));
      blockers.push(`- ${actionLabel(op, httpSource)} → HTTP ${Number(op.raw?.status)}${responseFacts(op).length ? ` (${responseFacts(op).join('; ')})` : ''}；證據 ${refText(op.resultRef)}。失敗後第一項新操作${next ? `是 ${actionLabel(next, httpSource)}（${refText(next.startRef ?? next.resultRef)}）` : '未記錄'}。這是本次目標請求回覆，不能據此判定整體策略錯誤或其他操作重複。`);
    }
    blockers.push('');
  }
  const businessFailureOps = httpOps.filter(op => businessSignals(op).some(signal =>
    signal === '認證業務狀態未建立' || signal === '認證業務操作遭拒'));
  if (businessFailureOps.length) {
    blockers.push('### 業務狀態負向回饋（與 HTTP 傳輸分開）', '');
    for (const op of businessFailureOps) {
      const next = operations.find(candidate => candidate.index > (op.resultIndex ?? op.index));
      const sameCategoryLater = operations.find(candidate => candidate.index > (op.resultIndex ?? op.index) &&
        actionCategory(candidate, httpSource) === actionCategory(op, httpSource));
      blockers.push(`- 回應明示認證業務狀態未建立（HTTP ${Number(op.raw?.status)}；${responseFacts(op).filter(fact => fact.includes('cookie')).join('；') || 'cookie 傳送資訊未記錄'}）；不是 HTTP 傳輸失敗。證據 ${refText(op.resultRef)}。之後實際轉向 ${next ? `${actionLabel(next, httpSource)}（${refText(next.startRef ?? next.resultRef)}）` : '未記錄'}${sameCategoryLater ? `；稍後又出現同類操作 ${actionLabel(sameCategoryLater, httpSource)}（${refText(sameCategoryLater.startRef ?? sameCategoryLater.resultRef)}）` : ''}。回應明確表示當時 auth=false；為何如此及後續是否表示已修復，事件未記錄。`);
    }
    blockers.push('');
  }
  if (duplicateGroups.length) {
    blockers.push('### 完全相同的輸入與結果', '');
    for (const group of duplicateGroups) {
      const lastResult = Math.max(...group.map(op => op.resultIndex ?? op.index));
      const next = operations.find(op => op.index > lastResult);
      blockers.push(`- ${group[0]!.tool} 重複 ${group.length} 次且輸入與結果相同：${group.map(op => `${refText(op.startRef)} → ${refText(op.resultRef)}`).join('；')}。之後第一個工具操作${next ? `是 ${next.tool}（${refText(next.startRef ?? next.resultRef)}）` : '未記錄'}；重複本身未增加可見結果差異。只按原始輸入與結果內容比對；相同路徑但請求參數或回應不同不列為完全重複。複盤問題：這次重複是否帶來新的證據？`);
    }
    blockers.push('');
  }
  const missingResults = operations.filter(op => op.start && !op.result);
  if (missingResults.length) {
    blockers.push('### 結果缺失', '');
    for (const op of missingResults) blockers.push(`- ${actionLabel(op, httpSource)} 已記錄開始事件，但沒有配對到結果事件；證據 ${refText(op.startRef)}。無法從記錄判斷工具是否已執行完成。`);
    blockers.push('');
  }
  if (safeError) {
    const lastEventIndex = events.length - 1;
    blockers.push('### Run 級停止', '', `- ${safeError.summary}${safeError.status_code ? `（HTTP ${safeError.status_code}${safeError.provider_code ? ` / ${safeError.provider_code}` : ''}）` : ''}${safeError.reset_at ? `；服務商原時區重置時間 ${safeError.reset_at}` : ''}（停止狀態 ${refText(refByIndex.get(lastEventIndex))}）。這是${safeError.provider_code === 'AccountQuotaExceeded' ? '服務商額度中止' : 'run 級錯誤'}，與本地 token 門檻分開記錄；本次 observable 用量 ${Number.isFinite(observableUsed) ? observableUsed.toLocaleString('en-US') : '未記錄'}${Number.isFinite(observableLimit) ? ` / ${observableLimit.toLocaleString('en-US')}` : ''}。${candidateEvents.length ? `已登記 ${candidateEvents.length} 個候選事件` : '沒有候選'}，${oracleStarts.length ? `oracle 提交啟動 ${oracleStarts.length} 次` : '沒有 oracle 提交'}。後續沒有模型/目標動作可用於判斷額度停止後的進展。複盤問題：provider 可用後，應先用本報告中最近的未解決證據繼續。`);
  }
  lines.push('', '## 需要人工復盤的卡點', '');
  if (blockers.length) lines.push(...blockers);
  else lines.push('- 未從記錄中識別到上述卡點分類。');

  lines.push('', '## 完整工具時間線', '', `<details><summary>展開 ${operations.length} 項工具操作</summary>`, '',
    '| 相對時間 | 操作與安全化目標 | 結果與安全回饋 | 證據 |', '| --- | --- | --- | --- |');
  for (const op of operations) {
    const facts = op.tool === 'http.request' ? responseFacts(op) : op.tool === 'observation.read' ? continuationFacts(op) : [];
    const signals = businessSignals(op);
    const resultLine = op.resultRef ? refText(op.resultRef) : '未記錄';
    lines.push(`| ${operationTime(op)} | ${actionLabel(op, httpSource)} | ${responseLabel(op)}${facts.length ? `; ${facts.join('; ')}` : ''}${signals.length ? `; ${signals.join('; ')}` : ''} | 開始 ${refText(op.startRef ?? op.resultRef)}；結果 ${resultLine} |`);
  }
  lines.push('', '</details>', '', '## 計數口徑與證據邊界', '',
    `- Tool invocation 以 ${countTool('http.request', 'start') + countTool('workspace.read', 'start') + countTool('workspace.list', 'start') + countTool('workspace.search', 'start') + countTool('workspace.unpack', 'start') + countTool('observation.read', 'start')} 個已知工具 start 計；HTTP 請求另列；\`job.run\` 僅按 \`job.run\` 工具事件計數（${countTool('job.run', 'start')} 個），不把所有工具呼叫當 job。`,
    `- Tool started/result 分開配對，依 receipt_id 關聯；並行交錯不靠相鄰行推斷。每個引用同時顯示 event seq 與 JSONL 行號，兩者由導出映射取得。`,
    '- 報告不輸出 query string、request body/header/cookie 值、候選值、oracle 答案、原始 provider error body、隱藏推理或未脫敏本機絕對路徑。回應內容只用固定語義標籤摘要，不逐字摘錄。',
    `- Candidate/oracle 狀態事件數：${candidateEvents.length}/${candidateStageEvents.length}；活動事件概況：${[...activityCounts].map(([key,count]) => `${key} ${count}`).join('；') || '無'}。`, '');
  return lines.join('\n');
}

function httpSignals(op: Operation): string[] {
  const text: string[] = [];
  collectText(op.raw, text);
  const all = text.join('\n');
  const signals: string[] = [];
  if (/["']auth["']\s*:\s*false/i.test(all)) signals.push('auth=false');
  if (/werkzeug.{0,80}debugger|debugger.{0,80}werkzeug|evalex/i.test(all)) signals.push('回應含 Werkzeug/debugger 字樣或 evalex 特徵（未確認頁面執行狀態）');
  if (/traceback|stack trace/i.test(all)) signals.push('回應含 traceback 關鍵字（僅此不能證明實際錯誤堆疊）');
  if (/authentication failed|unauthorized|login required/i.test(all)) signals.push('認證失敗訊號');
  return [...new Set(signals)];
}

export async function persistRunPostmortem(input: {
  out: string;
  state: { events(): EventDelta[]; eventRecords?(): Array<{ seq: number; event: EventDelta }>; exportJson(eventsPath: string, statePath: string): void };
  result: Record<string, unknown>;
}): Promise<{ result: Record<string, unknown>; reportPath: string; eventsPath: string }> {
  const eventsPath = join(input.out, 'canonical-events.jsonl');
  const statePath = join(input.out, 'state-export.json');
  const reportPath = join(input.out, 'postmortem.md');
  const resultPath = join(input.out, 'result.json');
  const records = input.state.eventRecords?.();
  const events = records ? records.map(item => item.event) : input.state.events();
  const eventRefs = records?.map((item, index) => ({ seq: item.seq, jsonlLine: index + 1 }));
  let exportError: string | undefined;
  try { input.state.exportJson(eventsPath, statePath); } catch { exportError = 'Canonical event export failed'; }
  const result: Record<string, unknown> = { ...input.result, events_path: eventsPath, result_path: resultPath, postmortem_path: reportPath };
  try { await writeFile(reportPath, renderRunPostmortem({ result, events, ...(eventRefs ? { eventRefs } : {}) }), { flag: 'w' }); }
  catch { result.postmortem_error = 'Could not write postmortem report'; }
  if (exportError) result.events_export_error = exportError;
  try { await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`); }
  catch { result.result_persist_error = 'Could not write result JSON'; }
  return { result, reportPath, eventsPath };
}
