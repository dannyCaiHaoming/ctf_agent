import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperienceStore } from '../../apps/launcher/src/experience-store.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const fixture = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'recon-trace-')), 'memory.sqlite');
  return { path, store: new ExperienceStore(path) };
};

const v1Fixture = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'recon-trace-v1-')), 'memory.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA user_version=1;
    CREATE TABLE recon_turns (
      id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, session_id TEXT NOT NULL,
      execution_ref TEXT, message_id TEXT, turn_no INTEGER, call_id TEXT, kind TEXT NOT NULL,
      tool TEXT, args_json TEXT, status TEXT, result_json TEXT, note_json TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
      UNIQUE(run_id,session_id,call_id,kind));
    CREATE INDEX recon_scope ON recon_turns(run_id,challenge_id,id);
    CREATE TABLE episodes (episode_id TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
      input_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(episode_id,version), UNIQUE(run_id,challenge_id,input_hash));
    CREATE TABLE lessons (lesson_id TEXT NOT NULL, version INTEGER NOT NULL, episode_id TEXT NOT NULL, episode_version INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(lesson_id,version), FOREIGN KEY(episode_id,episode_version) REFERENCES episodes(episode_id,version));
    INSERT INTO recon_turns(run_id,challenge_id,session_id,message_id,turn_no,call_id,kind,tool,args_json,status,result_json,created_at,updated_at,finished_at)
      VALUES('run','challenge','session','message',1,'call','tool','workspace.read','{"path":"work/a"}','completed','{"output":"legacy result"}',1,2,3);`);
  db.close();
  return path;
};

describe('complete Recon trace', () => {
  it('migrates a real v1 store and labels legacy rows as not original-complete', () => {
    const path = v1Fixture();
    const store = new ExperienceStore(path);

    expect(store.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
    expect(store.db.prepare("PRAGMA index_info('recon_scope')").all().map(row => row.name))
      .toEqual(['run_id', 'challenge_id', 'sequence', 'id']);

    const [row] = store.allRecords('run', 'challenge');
    expect(row).toMatchObject({
      args_json: { path: 'work/a' },
      result_json: { output: 'legacy result' },
      status: 'completed',
      original_complete: false,
    });
    expect(row.step_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.sequence).toBe(1);
    store.close();
  });

  it('preserves oversized tool args and result with reconstructable metadata', () => {
    const { store } = fixture();
    const scope = { run: 'run', challenge: 'challenge', session: 'session', message: 'message', call: 'call' };
    const args = { body: 'a'.repeat(13_000) };
    const result = { output: 'b'.repeat(13_000) };

    store.start(scope, 'workspace.read', args);
    store.finish(scope, 'completed', result);

    const row = store.records('run', 'challenge', { ids: [1] }).records[0]!;
    expect(row.step_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.sequence).toBe(1);
    expect(row.args_json).toEqual(args);
    expect(row.result_json).toEqual(result);
    expect(row.args_meta).toEqual({
      sha256: createHash('sha256').update(JSON.stringify(args)).digest('hex'),
      size: Buffer.byteLength(JSON.stringify(args)),
      complete: true,
      storage: 'inline',
      transformation: 'none',
    });
    expect(row.result_meta).toEqual({
      sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      size: Buffer.byteLength(JSON.stringify(result)),
      complete: true,
      storage: 'inline',
      transformation: 'none',
    });
    expect(row.original_complete).toBe(true);
    store.close();
  });

  it('marks redaction scope without presenting a sanitized payload as original-complete', () => {
    const { store } = fixture();
    store.addRedactions(['private-secret']);
    const scope = { run: 'run', challenge: 'challenge', session: 'session', message: 'message', call: 'call' };
    store.start(scope, 'http.request', { password: 'private-secret', body: 'token private-secret flag{proof}' });
    store.finish(scope, 'completed', { output: 'Authorization: Bearer abc.def' });

    const row = store.records('run', 'challenge', { ids: [1] }).records[0]!;
    expect(JSON.stringify(row.args_json)).not.toContain('private-secret');
    expect(JSON.stringify(row.args_json)).not.toContain('flag{proof}');
    expect(JSON.stringify(row.result_json)).not.toContain('abc.def');
    expect(row.args_meta).toMatchObject({
      transformation: 'redacted',
      redactions: ['password', 'body'],
      complete: true,
    });
    expect(row.args_meta.original_size).toBeGreaterThan(row.args_meta.size);
    expect(row.result_meta).toMatchObject({ transformation: 'redacted', redactions: ['output'] });
    expect(row.original_complete).toBe(true);
    store.close();
  });

  it('keeps cross-session order and monotonic terminal state across duplicate events', () => {
    const { store } = fixture();
    const first = { run: 'run', challenge: 'challenge', session: 'session-a', message: 'message-a', call: 'call-a' };
    const second = { run: 'run', challenge: 'challenge', session: 'session-b', message: 'message-b', call: 'call-b' };
    const third = { run: 'run', challenge: 'challenge', session: 'session-a', message: 'message-a2', call: 'call-c' };

    store.start(first, 'workspace.read', { path: 'work/a' });
    store.start(first, 'workspace.read', { path: 'work/overwritten' });
    store.start(second, 'workspace.list', { path: 'work' });
    store.start(third, 'workspace.view', { path: 'work/view' });

    const before = store.records('run', 'challenge', { limit: 40 }).records;
    expect(before.map(row => row.sequence)).toEqual([1, 2, 3]);
    expect(before[0]!.args_json).toEqual({ path: 'work/a' });
    const firstStepId = before[0]!.step_id;

    store.finish(first, 'completed', { output: 'event preview' }, { priority: 10 });
    store.finish(first, 'error', { error: 'stale event' }, { priority: 5 });
    store.finish(first, 'completed', { output: 'complete terminal' }, { priority: 30 });
    store.start(first, 'workspace.read', { path: 'work/overwritten-again' });
    store.finish(first, 'error', { error: 'late lower priority event' }, { priority: 10 });

    const rows = store.records('run', 'challenge', { ids: [before[0]!.id] }).records;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.step_id).toBe(firstStepId);
    expect(rows[0]!.args_json).toEqual({ path: 'work/a' });
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.result_json).toEqual({ output: 'complete terminal' });
    store.close();
  });

  it('navigates the complete matching trace with stable cursors, coverage and fingerprints', () => {
    const { store } = fixture();
    for (let index = 0; index < 45; index++) {
      const scope = { run: 'run', challenge: 'challenge', session: `session-${index % 3}`, message: `message-${index}`, call: `call-${index}` };
      store.start(scope, index % 2 ? 'workspace.list' : 'workspace.read', { path: `work/${index}` });
      store.finish(scope, 'completed', { output: `result-${index}` });
    }

    const first = store.records('run', 'challenge', { limit: 40 });
    expect(first.records.length).toBeLessThanOrEqual(40);
    expect(first.index).toHaveLength(45);
    expect(first.done).toBe(false);
    expect(first.next_cursor).toMatch(/^\d+:\d+$/);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.coverage).toMatchObject({ total: 45, returned: first.records.length, remaining: 45 - first.records.length, complete: false, next_cursor: first.next_cursor });
    expect(first.index[0]).toMatchObject({
      step_id: expect.stringMatching(/^[0-9a-f-]{36}$/), sequence: 1, cursor: '1:1', tool: 'workspace.read', kind: 'tool', status: 'completed',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), args_ref: null, result_ref: null,
      result_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), result_size: expect.any(Number), result_complete: true, original_complete: true,
    });

    const pages = [first];let last = first;
    while (!last.done) {
      last = store.records('run', 'challenge', { cursor: last.next_cursor!, limit: 40 });
      pages.push(last);
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(last.next_cursor).toBeNull();
    expect(last.fingerprint).toBe(first.fingerprint);
    expect(last.coverage).toMatchObject({ total: 45, returned: last.records.length, remaining: 0, complete: true, next_cursor: null });
    expect(pages.flatMap(page => page.records).map(row => row.step_id)).toEqual(first.index.map(row => row.step_id));

    const selected = store.records('run', 'challenge', { ids: [first.index[2]!.id, first.index[41]!.id] });
    expect(selected.records.map(row => row.id)).toEqual([first.index[2]!.id, first.index[41]!.id]);
    expect(selected.done).toBe(true);
    expect(store.records('run', 'challenge', { step_id: first.index[7]!.step_id }).records.map(row => row.step_id)).toEqual([first.index[7]!.step_id]);
    expect(store.records('run', 'challenge', { start_sequence: 11, end_sequence: 16 }).records.map(row => row.sequence)).toEqual([11, 12, 13, 14, 15]);
    expect(store.records('run', 'challenge', { after_id: 38 }).records.map(row => row.id)).toEqual([39, 40, 41, 42, 43, 44, 45]);
    expect(() => store.records('run', 'challenge', { ids: [1], after_id: 0 })).toThrow(/exclusive/);
    store.close();
  });

  it('exposes the same snapshot publication refs and completeness in the trace index', () => {
    const { store } = fixture();
    const scope = { run: 'run', challenge: 'challenge', session: 'session', message: 'message', call: 'call' };
    store.start(scope, 'workspace.read', { path: 'work/a' });
    const publication = { ref: 'artifact-1', size: 32_000, sha256: 'a'.repeat(64), status: 'complete', cursor: null };
    store.finish(scope, 'completed', { output: 'x'.repeat(20_000) }, { prepared: {
      raw: JSON.stringify(publication),
      meta: { sha256: publication.sha256, size: publication.size, complete: true, transformation: 'none', storage: 'artifact' },
    } });

    const page = store.records('run', 'challenge', { ids: [1] });
    expect(page.index[0]).toMatchObject({
      result_ref: 'artifact-1', result_sha256: publication.sha256, result_size: 32_000, result_complete: true,
    });
    expect(page.coverage.included_ids).toEqual([1]);
    store.close();
  });
});
