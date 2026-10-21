import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecoverableSnapshotSchema, ResumeResultSchema, snapshotArtifactRefs, type RecoverableSnapshot, type RecoverableCheckpoint, type ResumeResult } from './snapshot.js';
import { EventDeltaSchema, type Budget, type EventDelta } from '@ctf/contracts';

const nodeRequire = createRequire(import.meta.url);
const nodeSqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite');
const DatabaseSync = nodeSqlite.DatabaseSync;
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

export interface RunPaths {
  runId: string;
  root: string;
  statePath: string;
  eventsPath: string;
  input: string;
  artifacts: string;
  scripts: string;
}

export interface ArtifactReferenceRecord {
  hash: string;
  size: number;
  path: string;
}

export interface EvidenceRecord {
  id: string;
  runId: string;
  source: 'observation';
  artifact: ArtifactReferenceRecord;
  startCursor: number;
  endCursor: number;
}

export type LongJobTerminalState = 'completed' | 'error' | 'cancelled' | 'lost';
export interface LongJobWatch {
  runId: string; jobId: string; taskId: string; experimentId: string; cursor: number;
  continuationRef: string; deadline: string; terminalState?: LongJobTerminalState;
  terminalEventId?: string; claimState: 'waiting' | 'available' | 'claimed'; claimedContinuationRef?: string;
}
export interface LongJobTerminalInput {
  runId: string; jobId: string; eventId: string; state: LongJobTerminalState; cursor: number;
  payload: unknown; at?: string;
}

export interface EffectRecord {
  id: string;
  runId: string;
  operation: string;
  kind: string;
  payload: unknown;
  challengeId: string;
  generation: number;
  budget: Budget;
  deadline: string;
  expectedPostcondition: string;
  preparedAt: string;
  dispatchedAt?: string;
  state: 'prepared' | 'dispatching' | 'confirmed' | 'failed_not_dispatched' | 'unknown';
  authoritativeResponse?: unknown;
  businessOutcome?: 'accepted' | 'rejected' | 'duplicate' | 'invalid_state' | 'closed';
}

export interface Checkpoint {
  runId: string;
  challengeId: string;
  target: string;
  nextAction: string;
  stage: string;
  publishedRefs: ArtifactReferenceRecord[];
  rejectedFingerprints: string[];
  activeJobCursors: Record<string, number>;
  usedBudget: Budget;
}

export class StateStore {
  private readonly db: DatabaseSyncInstance;

  constructor(private readonly root: string, private readonly runId: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(join(root, `${runId}.sqlite`));
    this.migrate();
    this.db.prepare('INSERT OR IGNORE INTO runs(id) VALUES (?)').run(runId);
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS recoverable_snapshots (
        run_id TEXT NOT NULL, sequence INTEGER NOT NULL, snapshot_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL, action_state TEXT NOT NULL DEFAULT 'ready', dispatch_pid INTEGER,
        result TEXT, PRIMARY KEY(run_id, sequence), FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS long_job_watches (
        run_id TEXT NOT NULL, job_id TEXT NOT NULL, task_id TEXT NOT NULL, experiment_id TEXT NOT NULL,
        cursor INTEGER NOT NULL CHECK(cursor >= 0), continuation_ref TEXT NOT NULL, deadline TEXT NOT NULL,
        terminal_state TEXT, terminal_event_id TEXT, claim_state TEXT NOT NULL DEFAULT 'waiting',
        claimed_continuation_ref TEXT, PRIMARY KEY(run_id, job_id), FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, job_id TEXT NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, at TEXT NOT NULL, delivery_state TEXT NOT NULL DEFAULT 'pending',
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS accepted_flags (
        run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot >= 0),
        candidate_hash TEXT NOT NULL, correct_flag_count INTEGER NOT NULL CHECK(correct_flag_count >= 1),
        total_flag_count INTEGER NOT NULL CHECK(total_flag_count >= correct_flag_count), completed INTEGER NOT NULL CHECK(completed IN (0,1)),
        PRIMARY KEY(run_id, challenge_id, slot), FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS flag_progress (
        run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, correct_flag_count INTEGER NOT NULL,
        total_flag_count INTEGER NOT NULL, completed INTEGER NOT NULL CHECK(completed IN (0,1)),
        PRIMARY KEY(run_id, challenge_id), FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS submission_generations (
        run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation > 0),
        PRIMARY KEY(run_id, challenge_id), FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        hash TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source = 'observation'),
        artifact_hash TEXT NOT NULL,
        start_cursor INTEGER NOT NULL,
        end_cursor INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id),
        FOREIGN KEY(artifact_hash) REFERENCES artifacts(hash)
      );
      CREATE TABLE IF NOT EXISTS effects (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        budget TEXT NOT NULL,
        deadline TEXT NOT NULL,
        expected_postcondition TEXT NOT NULL,
        prepared_at TEXT NOT NULL DEFAULT '',
        dispatched_at TEXT,
        state TEXT NOT NULL,
        response TEXT,
        business_outcome TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS unknown_scopes (
        operation TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        PRIMARY KEY(operation, challenge_id)
      );
    `);
    const effectColumns = new Set((this.db.prepare('PRAGMA table_info(effects)').all() as Array<Record<string, unknown>>).map(row => String(row.name)));
    if (!effectColumns.has('prepared_at')) this.db.exec("ALTER TABLE effects ADD COLUMN prepared_at TEXT NOT NULL DEFAULT ''");
    if (!effectColumns.has('dispatched_at')) this.db.exec('ALTER TABLE effects ADD COLUMN dispatched_at TEXT');
  }

  runPaths(evalName: string, uniqueCode: string): RunPaths {
    const runRoot = join(this.root, 'runs', evalName, uniqueCode);
    const paths: RunPaths = {
      runId: '',
      root: runRoot,
      statePath: join(runRoot, 'state.json'),
      eventsPath: join(runRoot, 'events.jsonl'),
      input: join(runRoot, 'input'),
      artifacts: join(runRoot, 'artifacts'),
      scripts: join(runRoot, 'scripts')
    };
    return paths;
  }

  appendEvent(delta: EventDelta): number {
    const parsed = EventDeltaSchema.parse(delta);
    const info = this.db.prepare('INSERT INTO events(run_id, kind, payload, at) VALUES (?, ?, ?, ?)')
      .run(parsed.runId, parsed.kind, JSON.stringify(parsed), parsed.at);
    return Number(info.lastInsertRowid);
  }

  events(): EventDelta[] {
    return this.eventRecords().map(record => record.event);
  }

  /** Canonical SQLite sequence numbers paired with payloads for evidence links. */
  eventRecords(): Array<{ seq: number; event: EventDelta }> {
    return (this.db.prepare('SELECT seq, payload FROM events ORDER BY seq').all() as Array<Record<string, unknown>>)
      .map(row => ({ seq: Number(row.seq), event: JSON.parse(String(row.payload)) }));
  }

  /** Persist the exact continuation binding before a worker releases the long job. */
  watchLongJob(input: Omit<LongJobWatch, 'runId' | 'claimState' | 'terminalState' | 'terminalEventId' | 'claimedContinuationRef'>): LongJobWatch {
    if (input.jobId.length < 1 || input.taskId.length < 1 || input.experimentId.length < 1 || input.continuationRef.length < 1) throw new Error('long job watch binding required');
    if (!Number.isSafeInteger(input.cursor) || input.cursor < 0 || !Number.isFinite(Date.parse(input.deadline))) throw new Error('invalid long job cursor or deadline');
    const existing = this.db.prepare('SELECT * FROM long_job_watches WHERE run_id = ? AND job_id = ?').get(this.runId, input.jobId);
    if (existing) {
      const saved = this.longJobWatch(input.jobId)!;
      if (saved.taskId !== input.taskId || saved.experimentId !== input.experimentId || saved.continuationRef !== input.continuationRef || saved.deadline !== input.deadline) throw new Error('job watch binding is immutable');
      if (input.cursor < saved.cursor) throw new Error('job watch cursor cannot move backwards');
      if (input.cursor > saved.cursor && saved.claimState !== 'waiting') throw new Error('terminal job cursor is immutable');
      this.db.prepare('UPDATE long_job_watches SET cursor = ? WHERE run_id = ? AND job_id = ?').run(input.cursor, this.runId, input.jobId);
      return this.longJobWatch(input.jobId)!;
    }
    this.db.prepare(`INSERT INTO long_job_watches(run_id, job_id, task_id, experiment_id, cursor, continuation_ref, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.runId, input.jobId, input.taskId, input.experimentId, input.cursor, input.continuationRef, input.deadline);
    return this.longJobWatch(input.jobId)!;
  }

  longJobWatch(jobId: string): LongJobWatch | undefined {
    const row = this.db.prepare('SELECT * FROM long_job_watches WHERE run_id = ? AND job_id = ?').get(this.runId, jobId);
    if (!row) return undefined;
    return { runId: String(row.run_id), jobId: String(row.job_id), taskId: String(row.task_id), experimentId: String(row.experiment_id),
      cursor: Number(row.cursor), continuationRef: String(row.continuation_ref), deadline: String(row.deadline),
      ...(row.terminal_state == null ? {} : { terminalState: String(row.terminal_state) as LongJobTerminalState }),
      ...(row.terminal_event_id == null ? {} : { terminalEventId: String(row.terminal_event_id) }),
      claimState: String(row.claim_state) as LongJobWatch['claimState'],
      ...(row.claimed_continuation_ref == null ? {} : { claimedContinuationRef: String(row.claimed_continuation_ref) }) };
  }

  /** Terminal state and its outbox delivery are committed in one SQLite transaction. */
  commitLongJobTerminal(input: LongJobTerminalInput): LongJobWatch {
    if (input.runId !== this.runId || !input.eventId || !Number.isSafeInteger(input.cursor) || input.cursor < 0) throw new Error('invalid long job terminal event');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const watch = this.longJobWatch(input.jobId);
      if (!watch) throw new Error('long job watch not found');
      if (watch.terminalEventId) {
        if (watch.terminalEventId !== input.eventId || watch.terminalState !== input.state) throw new Error('conflicting terminal delivery');
        this.db.exec('COMMIT'); return watch;
      }
      this.db.prepare(`UPDATE long_job_watches SET cursor = ?, terminal_state = ?, terminal_event_id = ?, claim_state = 'available'
        WHERE run_id = ? AND job_id = ? AND terminal_event_id IS NULL`).run(Math.max(watch.cursor, input.cursor), input.state, input.eventId, this.runId, input.jobId);
      this.db.prepare(`INSERT INTO outbox(event_id, run_id, job_id, kind, payload, at) VALUES (?, ?, ?, 'job.terminal', ?, ?)`)
        .run(input.eventId, this.runId, input.jobId, JSON.stringify(input.payload), input.at ?? new Date().toISOString());
      this.db.exec('COMMIT');
      return this.longJobWatch(input.jobId)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  /** Compare-and-set gives one canonical continuation a runnable claim, even on duplicate delivery. */
  claimLongJobContinuation(jobId: string): LongJobWatch {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const watch = this.longJobWatch(jobId);
      if (!watch || !watch.terminalEventId) throw new Error('long job has no terminal event');
      if (watch.claimState === 'claimed') { this.db.exec('COMMIT'); return watch; }
      const info = this.db.prepare(`UPDATE long_job_watches SET claim_state = 'claimed', claimed_continuation_ref = continuation_ref
        WHERE run_id = ? AND job_id = ? AND claim_state = 'available'`).run(this.runId, jobId);
      if (Number(info.changes) !== 1) throw new Error('long job continuation claim lost');
      this.db.exec('COMMIT'); return this.longJobWatch(jobId)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  pendingOutbox(): Array<{ eventId: string; runId: string; jobId: string; kind: string; payload: unknown; at: string }> {
    return (this.db.prepare("SELECT * FROM outbox WHERE run_id = ? AND delivery_state = 'pending' ORDER BY at, event_id").all(this.runId) as Array<Record<string, unknown>>)
      .map(row => ({ eventId: String(row.event_id), runId: String(row.run_id), jobId: String(row.job_id), kind: String(row.kind), payload: JSON.parse(String(row.payload)), at: String(row.at) }));
  }

  markOutboxDelivered(eventId: string): void {
    const info = this.db.prepare("UPDATE outbox SET delivery_state = 'delivered' WHERE run_id = ? AND event_id = ?").run(this.runId, eventId);
    if (Number(info.changes) !== 1 && !this.db.prepare('SELECT 1 FROM outbox WHERE run_id = ? AND event_id = ? AND delivery_state = \'delivered\'').get(this.runId, eventId)) throw new Error('outbox event not found');
  }

  /** Store an oracle-confirmed slot and aggregate score atomically; repeated slots never add score. */
  recordAcceptedFlag(input: { challengeId: string; slot: number; candidateHash: string; correctFlagCount: number; totalFlagCount: number; completed: boolean }): {
    acceptedSlots: number[]; correctFlagCount: number; totalFlagCount: number; progressState: 'partial' | 'completed';
  } {
    if (!input.challengeId || !/^[a-f0-9]{64}$/.test(input.candidateHash) || !Number.isSafeInteger(input.slot) || input.slot < 0 ||
      !Number.isSafeInteger(input.correctFlagCount) || input.correctFlagCount < 1 || !Number.isSafeInteger(input.totalFlagCount) || input.totalFlagCount < input.correctFlagCount || typeof input.completed !== 'boolean') throw new Error('invalid authoritative flag acceptance');
    if (input.completed !== (input.correctFlagCount === input.totalFlagCount)) throw new Error('oracle completion/count mismatch');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT candidate_hash FROM accepted_flags WHERE run_id = ? AND challenge_id = ? AND slot = ?').get(this.runId, input.challengeId, input.slot) as Record<string, unknown> | undefined;
      if (existing && String(existing.candidate_hash) !== input.candidateHash) throw new Error('accepted slot is already bound to another candidate');
      const savedProgress = this.db.prepare('SELECT correct_flag_count, total_flag_count, completed FROM flag_progress WHERE run_id = ? AND challenge_id = ?').get(this.runId, input.challengeId) as Record<string, unknown> | undefined;
      if (savedProgress && (Number(savedProgress.total_flag_count) !== input.totalFlagCount || Number(savedProgress.correct_flag_count) > input.correctFlagCount || Number(savedProgress.completed) === 1 && !input.completed)) throw new Error('oracle progress regressed or changed total slot count');
      this.db.prepare(`INSERT OR IGNORE INTO accepted_flags(run_id, challenge_id, slot, candidate_hash, correct_flag_count, total_flag_count, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.runId, input.challengeId, input.slot, input.candidateHash, input.correctFlagCount, input.totalFlagCount, input.completed ? 1 : 0);
      const acceptedSlots = (this.db.prepare('SELECT slot FROM accepted_flags WHERE run_id = ? AND challenge_id = ? ORDER BY slot').all(this.runId, input.challengeId) as Array<Record<string, unknown>>).map(row => Number(row.slot));
      const correctFlagCount = acceptedSlots.length;
      if (correctFlagCount !== input.correctFlagCount) throw new Error('oracle aggregate count does not match persisted accepted slots');
      const completed = input.completed && correctFlagCount === input.totalFlagCount;
      this.db.prepare(`INSERT INTO flag_progress(run_id, challenge_id, correct_flag_count, total_flag_count, completed) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id, challenge_id) DO UPDATE SET correct_flag_count = excluded.correct_flag_count,
        total_flag_count = excluded.total_flag_count, completed = excluded.completed`).run(this.runId, input.challengeId, correctFlagCount, input.totalFlagCount, completed ? 1 : 0);
      this.db.exec('COMMIT');
      return { acceptedSlots, correctFlagCount, totalFlagCount: input.totalFlagCount, progressState: completed ? 'completed' : 'partial' };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  multiFlagProgress(challengeId: string): { acceptedSlots: number[]; correctFlagCount: number; totalFlagCount: number; progressState: 'partial' | 'completed' } | undefined {
    const row = this.db.prepare('SELECT * FROM flag_progress WHERE run_id = ? AND challenge_id = ?').get(this.runId, challengeId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const acceptedSlots = (this.db.prepare('SELECT slot FROM accepted_flags WHERE run_id = ? AND challenge_id = ? ORDER BY slot').all(this.runId, challengeId) as Array<Record<string, unknown>>).map(value => Number(value.slot));
    return { acceptedSlots, correctFlagCount: Number(row.correct_flag_count), totalFlagCount: Number(row.total_flag_count), progressState: Number(row.completed) === 1 ? 'completed' : 'partial' };
  }

  /** Persist a monotonic protected-submit generation before creating its effect. Gaps after crashes are safe. */
  allocateSubmissionGeneration(challengeId: string): number {
    if (!challengeId) throw new Error('challenge id required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = this.db.prepare('SELECT generation FROM submission_generations WHERE run_id = ? AND challenge_id = ?').get(this.runId, challengeId) as Record<string, unknown> | undefined;
      const effects = this.db.prepare("SELECT COALESCE(MAX(generation), 0) AS generation FROM effects WHERE run_id = ? AND challenge_id = ? AND operation = 'candidate.submit'").get(this.runId, challengeId) as Record<string, unknown>;
      const generation = Math.max(Number(saved?.generation ?? 0), Number(effects.generation)) + 1;
      this.db.prepare(`INSERT INTO submission_generations(run_id, challenge_id, generation) VALUES (?, ?, ?)
        ON CONFLICT(run_id, challenge_id) DO UPDATE SET generation = excluded.generation`).run(this.runId, challengeId, generation);
      this.db.exec('COMMIT'); return generation;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    const payload = JSON.stringify(checkpoint);
    this.db.prepare(`
      INSERT INTO checkpoints(run_id, payload) VALUES (?, ?)
      ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload
    `).run(checkpoint.runId, payload);
  }

  loadCheckpoint(runId: string): Checkpoint | undefined {
    const row = this.db.prepare('SELECT payload FROM checkpoints WHERE run_id = ?').get(runId);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }

  /** Strict, append-only canonical checkpoints. JSON exports never feed recovery. */
  saveRecoverableSnapshot(input: unknown): RecoverableSnapshot {
    const snapshot = RecoverableSnapshotSchema.parse(input);
    if (snapshot.run_id !== this.runId) throw new Error('snapshot run mismatch');
    for (const ref of snapshotArtifactRefs(snapshot)) {
      const actual = this.canonicalArtifact(ref.hash);
      if (!actual || actual.size !== ref.size || actual.path !== ref.path) throw new Error('snapshot artifact is not canonical');
    }
    for (const raw of snapshot.raw_observations) {
      const evidence = this.observationEvidence(raw.id);
      if (!evidence || evidence.runId !== snapshot.run_id || evidence.artifact.hash !== raw.artifact.hash || evidence.startCursor !== raw.source_start_cursor || evidence.endCursor !== raw.source_end_cursor) throw new Error('snapshot requires canonical original raw observation evidence');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const latest = this.loadRecoverableSnapshot();
      if (latest && snapshot.sequence <= latest.snapshot.sequence) throw new Error('snapshot sequence must increase');
      if (latest?.action_state === 'dispatched') throw new Error('unknown pending action must be reconciled before checkpoint replacement');
      this.db.prepare('INSERT INTO recoverable_snapshots(run_id, sequence, snapshot_id, payload) VALUES (?, ?, ?, ?)')
        .run(this.runId, snapshot.sequence, snapshot.snapshot_id, JSON.stringify(snapshot));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return snapshot;
  }

  loadRecoverableSnapshot(): RecoverableCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM recoverable_snapshots WHERE run_id = ? ORDER BY sequence DESC LIMIT 1').get(this.runId);
    if (!row) return undefined;
    return { snapshot: RecoverableSnapshotSchema.parse(JSON.parse(String(row.payload))),
      action_state: String(row.action_state) as RecoverableCheckpoint['action_state'],
      dispatch_pid: row.dispatch_pid == null ? null : Number(row.dispatch_pid),
      result: row.result == null ? null : ResumeResultSchema.parse(JSON.parse(String(row.result))) };
  }

  /** CAS is durable before dispatch: a crash in/after spawn is unknown, never blind replay. */
  claimSnapshotAction(snapshotId: string, pid: number): void {
    const info = this.db.prepare("UPDATE recoverable_snapshots SET action_state = 'dispatched', dispatch_pid = ? WHERE run_id = ? AND snapshot_id = ? AND action_state = 'ready' AND sequence = (SELECT MAX(sequence) FROM recoverable_snapshots WHERE run_id = ?)")
      .run(pid, this.runId, snapshotId, this.runId);
    if (Number(info.changes) !== 1) throw new Error('snapshot next action is not ready (completed or unknown dispatch); refusing replay');
  }

  finishSnapshotAction(snapshotId: string, pid: number, input: ResumeResult): void {
    const result = ResumeResultSchema.parse(input);
    this.addCanonicalArtifact(result.output_ref);
    const info = this.db.prepare("UPDATE recoverable_snapshots SET action_state = ?, result = ? WHERE run_id = ? AND snapshot_id = ? AND action_state = 'dispatched' AND dispatch_pid = ?")
      .run(result.state, JSON.stringify(result), this.runId, snapshotId, pid);
    if (Number(info.changes) !== 1) throw new Error('snapshot dispatch owner mismatch');
  }

  canonicalArtifact(hash: string): ArtifactReferenceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE hash = ?').get(hash);
    return row ? { hash: String(row.hash), size: Number(row.size), path: String(row.path) } : undefined;
  }

  addCanonicalArtifact(reference: ArtifactReferenceRecord): void {
    this.db.prepare('INSERT OR IGNORE INTO artifacts(hash, size, path) VALUES (?, ?, ?)')
      .run(reference.hash, reference.size, reference.path);
    const row = this.db.prepare('SELECT size, path FROM artifacts WHERE hash = ?').get(reference.hash);
    if (!row || Number(row.size) !== reference.size || String(row.path) !== reference.path) throw new Error('canonical artifact conflict');
  }

  addEvidence(evidence: EvidenceRecord): void {
    if (evidence.source !== 'observation') throw new Error('evidence requires observation source');
    const artifact = this.db.prepare('SELECT hash FROM artifacts WHERE hash = ?').get(evidence.artifact.hash);
    if (!artifact) throw new Error('evidence artifact is not canonical');
    if (evidence.endCursor < evidence.startCursor) throw new Error('invalid evidence range');
    this.db.prepare('INSERT INTO evidence(id, run_id, source, artifact_hash, start_cursor, end_cursor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(evidence.id, evidence.runId, evidence.source, evidence.artifact.hash, evidence.startCursor, evidence.endCursor);
  }

  observationEvidence(id: string): EvidenceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
    if (!row) return undefined;
    const artifact = this.canonicalArtifact(String(row.artifact_hash));
    if (!artifact) throw new Error('canonical observation artifact missing');
    return { id: String(row.id), runId: String(row.run_id), source: 'observation', artifact,
      startCursor: Number(row.start_cursor), endCursor: Number(row.end_cursor) };
  }

  private payloadIdentity(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  prepareEffect(input: Omit<EffectRecord, 'state' | 'preparedAt' | 'dispatchedAt' | 'payload_hash' | 'response' | 'businessOutcome'> & { preparedAt?: string }): EffectRecord {
    const payloadHash = this.payloadIdentity(input.payload);
    const existing = this.db.prepare('SELECT payload_hash, state, response, business_outcome, prepared_at, dispatched_at FROM effects WHERE id = ?').get(input.id);
    const preparedAt = input.preparedAt ?? new Date().toISOString();
    if (existing) {
      if (String(existing.payload_hash) !== payloadHash) throw new Error('effect ID conflict');
      return {
        ...input,
        preparedAt: String(existing.prepared_at || preparedAt),
        ...(existing.dispatched_at == null ? {} : { dispatchedAt: String(existing.dispatched_at) }),
        state: String(existing.state) as EffectRecord['state'],
        ...(existing.response == null ? {} : { authoritativeResponse: JSON.parse(String(existing.response)) }),
        ...(existing.business_outcome == null ? {} : { businessOutcome: JSON.parse(String(existing.business_outcome)) })
      };
    }
    this.db.prepare(`INSERT INTO effects(
        id, run_id, operation, kind, payload_hash, payload, challenge_id, generation, budget,
        deadline, expected_postcondition, prepared_at, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`)
      .run(input.id, input.runId, input.operation, input.kind, payloadHash, JSON.stringify(input.payload), input.challengeId, input.generation, JSON.stringify(input.budget), input.deadline, input.expectedPostcondition, preparedAt);
    return { ...input, preparedAt, state: 'prepared' };
  }

  private getEffect(id: string): EffectRecord {
    const row = this.db.prepare('SELECT * FROM effects WHERE id = ?').get(id);
    if (!row) throw new Error('effect not found');
    return {
      id: String(row.id),
      runId: String(row.run_id),
      operation: String(row.operation),
      kind: String(row.kind),
      payload: JSON.parse(String(row.payload)),
      challengeId: String(row.challenge_id),
      generation: Number(row.generation),
      budget: JSON.parse(String(row.budget)),
      deadline: String(row.deadline),
      expectedPostcondition: String(row.expected_postcondition),
      preparedAt: String(row.prepared_at ?? ''),
      ...(row.dispatched_at == null ? {} : { dispatchedAt: String(row.dispatched_at) }),
      state: String(row.state) as EffectRecord['state'],
      ...(row.response == null ? {} : { authoritativeResponse: JSON.parse(String(row.response)) }),
      ...(row.business_outcome == null ? {} : { businessOutcome: JSON.parse(String(row.business_outcome)) })
    };
  }

  dispatchEffect(id: string): EffectRecord {
    const effect = this.getEffect(id);
    if (effect.state !== 'prepared') throw new Error(`cannot dispatch from ${effect.state}`);
    this.db.prepare("UPDATE effects SET state = 'dispatching', dispatched_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    return this.getEffect(id);
  }

  effect(id: string): EffectRecord | undefined {
    const row = this.db.prepare('SELECT id FROM effects WHERE id = ?').get(id);
    return row ? this.getEffect(id) : undefined;
  }

  effectsFor(input: { operation?: string; challengeId?: string; generation?: number } = {}): EffectRecord[] {
    const clauses = ['run_id = ?']; const values: Array<string | number> = [this.runId];
    if (input.operation !== undefined) { clauses.push('operation = ?'); values.push(input.operation); }
    if (input.challengeId !== undefined) { clauses.push('challenge_id = ?'); values.push(input.challengeId); }
    if (input.generation !== undefined) { clauses.push('generation = ?'); values.push(input.generation); }
    const rows = this.db.prepare(`SELECT id FROM effects WHERE ${clauses.join(' AND ')} ORDER BY rowid`).all(...values) as Array<Record<string, unknown>>;
    return rows.map(row => this.getEffect(String(row.id)));
  }

  confirmEffect(id: string, response: unknown, business: EffectRecord['businessOutcome']): EffectRecord {
    const effect = this.getEffect(id);
    if (effect.state !== 'dispatching') throw new Error(`cannot confirm from ${effect.state}`);
    this.db.prepare("UPDATE effects SET state = 'confirmed', response = ?, business_outcome = ? WHERE id = ?")
      .run(JSON.stringify(response), JSON.stringify(business), id);
    if (business === 'invalid_state' || business === 'closed') {
      this.db.prepare('INSERT OR IGNORE INTO unknown_scopes(operation, challenge_id) VALUES (?, ?)')
        .run(effect.operation, effect.challengeId);
    } else {
      this.db.prepare('DELETE FROM unknown_scopes WHERE operation = ? AND challenge_id = ?')
        .run(effect.operation, effect.challengeId);
    }
    return this.getEffect(id);
  }

  failNotDispatched(id: string): EffectRecord {
    const effect = this.getEffect(id);
    if (effect.state !== 'prepared') throw new Error('only a prepared effect can be marked failed_not_dispatched');
    this.db.prepare("UPDATE effects SET state = 'failed_not_dispatched' WHERE id = ?").run(id);
    return this.getEffect(id);
  }

  markUnknown(id: string): EffectRecord {
    const effect = this.getEffect(id);
    if (effect.state !== 'dispatching') throw new Error('only dispatching can become unknown');
    this.db.prepare("UPDATE effects SET state = 'unknown' WHERE id = ?").run(id);
    this.db.prepare('INSERT OR IGNORE INTO unknown_scopes(operation, challenge_id) VALUES (?, ?)')
      .run(effect.operation, effect.challengeId);
    return this.getEffect(id);
  }

  isScopeUnknown(operation: string, challengeId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM unknown_scopes WHERE operation = ? AND challenge_id = ?')
      .get(operation, challengeId);
  }

  exportJson(eventsPath: string, statePath: string): void {
    const events = this.events().map(event => JSON.stringify(event)).join('\n') + '\n';
    mkdirSync(dirname(eventsPath), { recursive: true });
    mkdirSync(dirname(statePath), { recursive: true });
    const tempEvents = join(dirname(eventsPath), `.${randomUUID()}.tmp`);
    const tempState = join(dirname(statePath), `.${randomUUID()}.tmp`);
    writeFileSync(tempEvents, events);
    writeFileSync(tempState, JSON.stringify({ state: 'canonical export', checkpoint: this.loadCheckpoint(this.events()[0]?.runId ?? '') }, null, 2));
    renameSync(tempEvents, eventsPath);
    renameSync(tempState, statePath);
  }

  close(): void {
    this.db.close();
  }
}

export async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temp, bytes);
  await rename(temp, path);
}

export * from './snapshot.js';
export * from './hypothesis-snapshot.js';
