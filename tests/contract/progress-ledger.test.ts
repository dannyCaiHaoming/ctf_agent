import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProgressLedger, progressDigest, renderProgressMarkdown, summarizeToolArgs } from '../../apps/launcher/src/progress-ledger.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const SECRET = 'provider-secret-progress-0123456789';
const CANDIDATE = 'flag{fictional_progress_candidate}';

describe('progress ledger safe projection', () => {
  it.each([
    { result: 'exited', exitCode: 0, allow: true, status: 'succeeded' },
    { result: 'exited', exitCode: 7, allow: true, status: 'failed' },
    { result: 'exited', exitCode: null, allow: true, status: 'failed' },
    { result: 'exited', exitCode: undefined, allow: true, status: 'failed' },
    { result: 'timed_out', exitCode: 0, allow: true, status: 'failed' },
    { result: 'cancelled', exitCode: 0, allow: true, status: 'failed' },
    { result: 'failed_to_start', exitCode: null, allow: true, status: 'failed' },
    { result: 'cleanup_unknown', exitCode: 0, allow: false, status: 'unknown' },
    { result: 'completed', exitCode: undefined, allow: true, status: 'succeeded' }
  ])('classifies $result with exitCode=$exitCode as $status', ({ result, exitCode, allow, status }) => {
    const detail = { callID: 'terminal-call', tool: result === 'completed' ? 'http.request' : 'job.run', result,
      ...(exitCode !== undefined ? { exitCode } : {}) };
    const digest = progressDigest([
      { seq: 1, t: 1, at: 1, sessionID: 'solver', op: 'tool.settled', allow, detail }
    ], { runId: 'run-terminal' });
    const recent = digest.recent as Array<{ status: string; facts: Record<string, unknown> }>;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ status, facts: detail });
    if (exitCode === undefined) expect(recent[0]!.facts).not.toHaveProperty('exitCode');
  });

  it('keeps useful tool shape but never copies bodies, queries, argv or candidates', () => {
    const job = summarizeToolArgs('job.run', {
      argv: ['/usr/bin/python3', '-c', `print(${JSON.stringify(SECRET)})`, CANDIDATE], timeout_ms: 30000
    });
    expect(job.summary).toMatchObject({ executable: 'python3', argvCount: 4, timeoutMs: 30000 });
    expect(job.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(job)).not.toContain(SECRET);
    expect(JSON.stringify(job)).not.toContain(CANDIDATE);

    const http = summarizeToolArgs('http.request', {
      method: 'POST', url: `http://user:${SECRET}@127.0.0.1:8010/login?token=${SECRET}#${CANDIDATE}`,
      headers: { authorization: SECRET, 'content-type': 'application/json' }, body: CANDIDATE
    });
    expect(http.summary).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8010/login', headerNames: ['authorization', 'content-type'], bodyBytes: CANDIDATE.length });
    expect(JSON.stringify(http)).not.toContain(SECRET);
    expect(JSON.stringify(http)).not.toContain(CANDIDATE);

    const write = summarizeToolArgs('workspace.write', { path: 'work/a.txt', content: CANDIDATE, encoding: 'utf8' });
    expect(write.summary).toEqual({ path: 'work/a.txt', contentBytes: Buffer.byteLength(CANDIDATE), encoding: 'utf8' });
    expect(JSON.stringify(write)).not.toContain(CANDIDATE);
  });

  it('writes an append-only safe timeline and a manual report with separate fact layers', async () => {
    const dir = realpathSync(await mkdtemp(join(tmpdir(), 'progress-ledger-')));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const startedAt = Date.now();
    const ledger = new ProgressLedger({ directory: dir, runId: 'run-progress', redactions: [SECRET], startedAt });
    await ledger.initialize();
    const one = summarizeToolArgs('job.run', { argv: ['python3', '-c', CANDIDATE], timeout_ms: 1000 });
    const two = summarizeToolArgs('job.run', { argv: ['python3', '-c', CANDIDATE], timeout_ms: 1000 });
    expect(two.fingerprint).toBe(one.fingerprint);
    const events = [
      { seq: 1, t: 1, at: startedAt + 1, sessionID: 'root', role: 'coordinator', op: 'model.call', allow: true, detail: { admitNo: 1, maxOutputTokens: 900, role: 'coordinator' } },
      { seq: 2, t: 2, at: startedAt + 2, sessionID: 'solver', role: 'domain-solver', challengeId: 'mfw', op: 'tool.registered', allow: true,
        detail: { callID: 'call-1', tool: 'job.run', challengeId: 'mfw', safeArgs: one.summary, argFingerprint: one.fingerprint, args: { argv: [SECRET, CANDIDATE] } } },
      { seq: 3, t: 3, at: startedAt + 3, sessionID: 'solver', role: 'domain-solver', challengeId: 'mfw', op: 'tool.settled', allow: true,
        detail: { callID: 'call-1', tool: 'job.run', result: 'failed' } },
      { seq: 4, t: 4, at: startedAt + 4, sessionID: 'solver', role: 'domain-solver', challengeId: 'mfw', op: 'tool.registered', allow: true,
        detail: { callID: 'call-2', tool: 'job.run', challengeId: 'mfw', safeArgs: two.summary, argFingerprint: two.fingerprint } },
      { seq: 5, t: 5, at: startedAt + 5, sessionID: 'critic', role: 'recovery-critic', op: 'progress.note', allow: true,
        detail: { stage: 'recovery', route: 'redirect', summary: `blocked on ${CANDIDATE}`, blocker: 'same failed command', repeatedRoute: 'job.run:call-1', nextAction: 'inspect input encoding', capabilityGap: { kind: 'reference', detail: 'missing encoding note' } } },
      { seq: 6, t: 6, at: startedAt + 6, sessionID: 'root', role: 'coordinator', op: 'progress.note', allow: true,
        detail: { stage: 'recovery', route: 'continue', summary: 'retry with changed input', nextAction: 'dispatch revised experiment' } }
    ] as const;
    for (const event of events) ledger.append(event as never);
    await ledger.finalize({ status: 'failed', model: 'fake/model', budget: { maxModelCalls: 10, maxObservableTokens: 1000 }, usage: { availability: 'reported', observableTokens: 321, lowerBound: false } });

    const jsonl = await readFile(join(dir, 'progress.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n')).toHaveLength(6);
    expect(jsonl).not.toContain(SECRET);
    expect(jsonl).not.toContain(CANDIDATE);
    expect(jsonl).not.toContain('"args"');
    expect(JSON.parse(jsonl.trim().split('\n')[1]!)).toMatchObject({ v: 1, seq: 2, role: 'domain-solver', challenge: 'mfw', kind: 'tool', status: 'started' });

    const report = await readFile(join(dir, 'progress.md'), 'utf8');
    for (const heading of ['## Run 摘要', '## 停滯／重複訊號', '## Recovery Critic 判斷', '## Coordinator 決策', '## 能力缺口候選', '## 事件時間線', '## 證據索引']) expect(report).toContain(heading);
    expect(report).toContain('重複 2 次');
    expect(report).toContain('missing encoding note');
    expect(report).toContain('retry with changed input');
    expect(report).not.toContain(SECRET);
    expect(report).not.toContain(CANDIDATE);
  });

  it('distinguishes completed session shutdown from an aborted challenge', () => {
    const report = renderProgressMarkdown([
      { v: 1, seq: 1, at: '2026-10-24T00:00:00.000Z', elapsedMs: 1, runId: 'run', sessionId: 'solver', role: 'domain-solver', challenge: 'throwback',
        kind: 'model', op: 'model.call', status: 'admitted', summary: 'model call admitted #1' },
      { v: 1, seq: 2, at: '2026-10-24T00:00:01.000Z', elapsedMs: 2, runId: 'run', sessionId: 'root', role: 'coordinator',
        kind: 'session', op: 'stop_marked', status: 'observed', summary: 'stop_marked', facts: { reason: 'completed' } },
      { v: 1, seq: 3, at: '2026-10-24T00:00:02.000Z', elapsedMs: 3, runId: 'run', sessionId: 'solver', role: 'domain-solver', challenge: 'throwback',
        kind: 'session', op: 'aborted', status: 'observed', summary: 'aborted' }
    ], { status: 'completed', model: 'fake/model', budget: { maxModelCalls: 10, maxObservableTokens: 1000 },
      usage: { availability: 'reported', observableTokens: 100, lowerBound: false } });

    expect(report).toContain('run 正常完成；session 在收束時結束。最後非收束事件 `model.call`');
    expect(report).not.toContain('`throwback`: 最後事件 `aborted`');
  });
});
