import { describe, expect, it } from 'vitest';
import type { EventDelta } from '@ctf/contracts';
import { normalizeRunError, renderRunPostmortem } from '../../apps/cli/src/commands/runPostmortem.js';

const base = { kind: 'solver.activity', runId: 'run_test', challengeId: 'challenge_test', taskId: 'task_solver',
  sessionId: 'ses_test', attemptId: 'attempt_test' } as const;
function event(seq: number, activity: string, data: Record<string, unknown>, second: number): EventDelta {
  return { ...base, activity, data, at: new Date(second * 1000).toISOString() } as unknown as EventDelta;
}
function start(seq: number, receipt: string, tool: string, input: Record<string, unknown>, second: number) {
  return event(seq, 'tool.started', { receipt_id: receipt, tool, input }, second);
}
function done(seq: number, receipt: string, tool: string, raw: unknown, second: number, outcome = 'success') {
  return event(seq, 'tool.result', { receipt_id: receipt, tool,
    observation: { tool, outcome, failure_code: outcome === 'failure' ? 'tool_invocation_error' : null,
      raw: typeof raw === 'string' ? raw : JSON.stringify(raw), complete: true } }, second);
}

describe('run postmortem', () => {
  it('keeps a safe quota classification and omits provider secrets and raw response fields', () => {
    const rawError = { name: 'APIError', data: {
      statusCode: 429, isRetryable: true,
      responseHeaders: { authorization: 'header-secret' },
      responseBody: JSON.stringify({ error: { code: 'AccountQuotaExceeded', type: 'TooManyRequests',
        message: '5-hour usage quota exhausted; reset at 2026-10-22 02:00:29 +0800 CST. Request id: request-secret. key=body-secret' } })
    } };
    const safeError = normalizeRunError(rawError);
    expect(safeError).toEqual({ status_code: 429, provider_code: 'AccountQuotaExceeded', provider_type: 'TooManyRequests',
      summary: 'Provider 5-hour usage quota exhausted', reset_at: '2026-10-22 02:00:29 +0800 CST' });
    expect(JSON.stringify(safeError)).not.toMatch(/header-secret|body-secret|request-secret|responseBody|responseHeaders/);
    const report = renderRunPostmortem({ result: { run_id: 'run_test', outcome: 'inconclusive', solve_state: 'blocked_runtime',
      reason: safeError.summary, safe_error: safeError, budget: { wallClockMs: 1513500, maxSteps: 1, maxToolJobs: 0,
        maxObservableTokens: 8746368, authorizedObservableTokenLimit: 10000000 },
      provider_usage: { availability: 'unavailable', admitted_model_calls: 111 }, candidate: null }, events: [], safeError });
    expect(report).toContain('HTTP 429 / AccountQuotaExceeded / TooManyRequests');
    expect(report).toContain('8,746,368 / 10,000,000');
    expect(report).toContain('25:13.5');
    expect(report).not.toMatch(/header-secret|body-secret|request-secret|responseBody|responseHeaders/);
  });

  it('pairs interleaved receipts, preserves real seq and JSONL line, sanitizes the timeline, and separates exact duplicates', () => {
    const events = [
      start(10, 'receipt-http', 'http.request', { method: 'GET', url: 'http://127.0.0.1/team/abc?token=query-secret',
        headers: { authorization: 'header-secret' }, body: 'body-secret' }, 0),
      start(11, 'receipt-search-a', 'workspace.search', { path: 'derived/tar-1234567890abcdef/CTFd', needle: 'private-needle' }, 1),
      start(12, 'receipt-search-b', 'workspace.search', { path: 'derived/tar-1234567890abcdef/CTFd', needle: 'private-needle' }, 1),
      done(13, 'receipt-search-b', 'workspace.search', { matches: [] }, 2),
      done(14, 'receipt-search-a', 'workspace.search', { matches: [] }, 2),
      done(15, 'receipt-http', 'http.request', { method: 'GET', url: 'http://127.0.0.1/team/abc?token=query-secret', status: 404,
        complete: true, observation_ref: 'obs-private', body_preview: '{"auth":false,"flag":"candidate-secret"}' }, 3),
      start(16, 'receipt-search-c', 'workspace.search', { path: 'derived/tar-1234567890abcdef/CTFd', needle: 'changed-needle' }, 4),
      done(17, 'receipt-search-c', 'workspace.search', { matches: ['changed-result'] }, 5),
      start(18, 'receipt-read', 'observation.read', { ref: 'obs-private', max_bytes: 200 }, 6),
      done(19, 'receipt-read', 'observation.read', { source_ref: 'obs-private', cursor: 0, next_cursor: 22, eof: true,
        chunk: 'auth=false; traceback; value=candidate-secret' }, 7),
      start(20, 'receipt-search-fail', 'workspace.search', { path: 'derived/tar-1234567890abcdef/CTFd/templates', needle: 'private-needle' }, 8),
      done(21, 'receipt-search-fail', 'workspace.search', { error: 'EISDIR: expected a file but got a directory',
        absolute_path: '/private/user/secret-path' }, 9, 'failure'),
      event(22, 'candidate', { status: 'candidate_only', candidate: 'candidate-secret' }, 10),
      event(23, 'candidate.stage', { stage: 'verification', state: 'started', value: 'candidate-secret' }, 11),
      event(24, 'candidate.stage', { stage: 'oracle_submit', state: 'started', answer: 'oracle-secret' }, 12)
    ];
    const refs = events.map((_, index) => ({ seq: 100 + index * 7, jsonlLine: index + 1 }));
    const safeError = { status_code: 429, provider_code: 'AccountQuotaExceeded', summary: 'Provider 5-hour usage quota exhausted' };
    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', solve_state: 'blocked_runtime', safe_error: safeError,
      budget: { wallClockMs: 15000, maxSteps: 20, maxToolJobs: 0, maxObservableTokens: 1000,
        authorizedObservableTokenLimit: 10000000 }, provider_usage: { availability: 'unavailable', admitted_model_calls: 6 } },
      events, eventRefs: refs, safeError });

    expect(report).toContain('seq 100 / JSONL 行 1');
    expect(report).toContain('seq 121 / JSONL 行 4');
    expect(report).toContain('seq 135 / JSONL 行 6');
    expect(report).toMatch(/開始 seq 100 \/ JSONL 行 1.*；結果 seq 135 \/ JSONL 行 6/);
    expect(report).toContain('HTTP 404');
    expect(report).toContain('auth=false');
    expect(report).toContain('回應含 traceback 關鍵字');
    expect(report).toContain('GET /team/{id} [非數字路徑參數探查（值已隱去）] → HTTP 404');
    expect(report).toContain('操作要求檔案；先列出目錄項目');
    expect(report).toContain('完全相同的輸入與結果');
    expect(report).toContain('相同路徑但請求參數或回應不同不列為完全重複');
    expect(report).toContain('受管 job.run jobs 使用 0');
    expect(report).toContain('candidate_only'); // status is safely visible as category; candidate bytes are not
    expect(report).not.toMatch(/query-secret|header-secret|body-secret|private-needle|changed-needle|candidate-secret|oracle-secret|secret-path|127\.0\.0\.1|obs-private/);
    expect(report).not.toMatch(/\/private\//);
  });

  it('reports a missing result rather than inventing completion', () => {
    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} },
      events: [start(1, 'receipt-in-flight', 'http.request', { url: 'http://127.0.0.1/private/segment', method: 'POST' }, 1)] });
    expect(report).toContain('結果缺失');
    expect(report).toContain('結果未記錄');
    expect(report).not.toContain('/private/segment');
  });

  it('separates HTTP transport from business feedback and preserves safe activity transitions', () => {
    const events: EventDelta[] = [];
    const add = (activity: string, data: Record<string, unknown>, second: number) => events.push(event(events.length + 1, activity, data, second));
    const http = (receipt: string, method: string, url: string, raw: Record<string, unknown>, second: number) => {
      add('tool.started', { receipt_id: receipt, tool: 'http.request', input: { method, url, headers: { cookie: 'cookie-secret' }, body: 'payload-secret' } }, second);
      add('tool.result', { receipt_id: receipt, tool: 'http.request', observation: { tool: 'http.request', outcome: 'success',
        raw: JSON.stringify({ method, url, ...raw }) } }, second + 1);
    };
    http('login', 'POST', 'http://127.0.0.1/login?pin=pin-secret', { status: 302, redirect_location: '/team/123',
      body_size: 223, complete: true, body_fully_inline: true, content_type: 'text/html', cookie_names_sent: [] }, 1);
    http('protected', 'GET', 'http://127.0.0.1/profile?session=session-secret', { status: 200, body_size: 42, complete: true,
      body_fully_inline: true, content_type: 'text/html', cookie_names_sent: ['session'] }, 3);
    http('empty', 'GET', 'http://127.0.0.1/chals', { status: 200, body_size: 16, complete: true, content_type: 'application/json',
      cookie_names_sent: ['session'], body_preview: '{"game":[]}' }, 5);
    http('auth-false', 'GET', 'http://127.0.0.1/team/abc', { status: 200, body_size: 35, complete: true, content_type: 'application/json',
      cookie_names_sent: ['session'], body_preview: '{"auth":false,"exhausted":true}' }, 7);
    http('asset', 'GET', 'http://127.0.0.1/static/app.js?token=token-secret', { status: 200, body_size: 90,
      complete: true, content_type: 'application/javascript', body_fully_inline: false }, 9);
    http('route-probe', 'GET', 'http://127.0.0.1/team/123', { status: 404, body_size: 0, complete: true, content_type: 'text/html' }, 11);

    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} }, events });
    expect(report).toContain('POST /login [認證／session 操作] | HTTP 302');
    expect(report).toContain('重新導向至 /team/{id}');
    expect(report).toContain('回應主體完整');
    expect(report).toContain('GET /profile [其他目標路由請求] | HTTP 200');
    expect(report).toContain('cookie metadata 記錄有送出 cookie（值已隱去）');
    expect(report).toContain('回應 JSON 的 game 是空清單');
    expect(report).toContain('業務狀態負向回饋（與 HTTP 傳輸分開）');
    expect(report).toContain('認證業務狀態未建立');
    expect(report).toContain('HTTP 200'); // auth=false is not an HTTP transport failure.
    expect(report).toContain('靜態資源讀取');
    expect(report).toContain('數字路徑參數請求（值已隱去）');
    expect(report).toContain('按連續活動分段');
    expect(report).toContain('下一段最先記錄的操作');
    expect(report).toContain('未記錄的選擇理由保留為未知');
    expect(report).not.toMatch(/pin-secret|session-secret|cookie-secret|payload-secret|token-secret|127\.0\.0\.1/);

    const emptyOnlyEvents = events.slice(4, 6);
    const emptyOnly = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} }, events: emptyOnlyEvents });
    expect(emptyOnly).toContain('回應 JSON 的 game 是空清單');
    expect(emptyOnly).not.toContain('業務狀態負向回饋');
  });

  it('keeps each server error event reference visible instead of collapsing a repeated route to its final occurrence', () => {
    const events: EventDelta[] = [];
    for (let index = 0; index < 7; index++) {
      const receipt = `server-error-${index}`;
      events.push(start(index * 2 + 1, receipt, 'http.request', { method: 'GET', url: 'http://127.0.0.1/team/abc' }, index * 2));
      events.push(done(index * 2 + 2, receipt, 'http.request', { method: 'GET', url: 'http://127.0.0.1/team/abc',
        status: 500, complete: true, body_size: 17612 }, index * 2 + 1));
    }
    const refs = events.map((_, index) => ({ seq: 1000 + index, jsonlLine: index + 1 }));
    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} }, events, eventRefs: refs });
    const negativeSection = report.split('### 目標負向回饋')[1]?.split('### ')[0] ?? '';
    for (const seq of [1001, 1003, 1005, 1007, 1009, 1011, 1013]) expect(negativeSection).toContain(`seq ${seq} / JSONL 行`);
    expect(report).toContain('展開 7 項工具操作');
    expect(report).not.toContain('只保留最後一次');
  });

  it('classifies debugger query actions by allowlisted command names without exposing PINs or payload values', () => {
    const actions = [
      ['resource', '__debugger__=yes&cmd=resource&f=secret-file'],
      ['pin', '__debugger__=yes&cmd=pinauth&pin=pin-secret&s=session-secret'],
      ['expression', '__debugger__=yes&cmd=1%2B1&s=TRACEBACK-secret&frm=frame-secret'],
      ['evaluate', '__debugger__=yes&cmd=evaluate&expr=payload-secret'],
      ['resource-again', '__debugger__=yes&cmd=resource&f=another-secret-file']
    ] as const;
    const events: EventDelta[] = [];
    actions.forEach(([receipt, query], index) => {
      const url = `http://127.0.0.1/team/abc?${query}`;
      events.push(start(index * 2 + 1, receipt, 'http.request', { method: 'GET', url }, index * 2));
      events.push(done(index * 2 + 2, receipt, 'http.request', { method: 'GET', url, status: 200, complete: true }, index * 2 + 1));
    });
    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} }, events });
    expect(report).toContain('debugger 資源讀取');
    expect(report).toContain('debugger PIN 認證嘗試（值已隱去）');
    expect(report).toContain('debugger 表達式命令探查（值已隱去）');
    expect(report).toContain('debugger 表達式評估探查（值已隱去）');
    const activitySummary = report.split('## 候選與裁判')[0] ?? '';
    expect(activitySummary.match(/debugger 資源讀取：GET HTTP 200/g)).toHaveLength(2);
    expect(report).not.toMatch(/pin-secret|session-secret|secret-file|TRACEBACK-secret|frame-secret|payload-secret|127\.0\.0\.1/);
  });

  it('describes an observation read retry from the same source without applying workspace follow-up rules', () => {
    const events = [
      start(1, 'read-failed', 'observation.read', { ref: 'observation-secret', max_bytes: 200 }, 0),
      done(2, 'read-failed', 'observation.read', { error: 'private-read-error' }, 1, 'failure'),
      start(3, 'read-retry', 'observation.read', { ref: 'observation-secret', max_bytes: 200 }, 2),
      done(4, 'read-retry', 'observation.read', { cursor: 200, next_cursor: 400, size: 500, eof: false,
        source_ref: 'source-secret', chunk: 'body-secret' }, 3)
    ];
    const report = renderRunPostmortem({ result: { outcome: 'inconclusive', budget: {}, provider_usage: {} }, events });
    expect(report).toContain('同一觀察來源之後有一次續讀成功');
    expect(report).toContain('回應仍有後續內容');
    expect(report).toContain('不能由此證明整份回應已讀完');
    expect(report).not.toContain('同路徑 workspace.list');
    expect(report).not.toMatch(/private-read-error|observation-secret|source-secret|body-secret/);
  });
});
