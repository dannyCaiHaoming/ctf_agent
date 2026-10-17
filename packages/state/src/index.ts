import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

  constructor(private readonly root: string, runId: string) {
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
    return (this.db.prepare('SELECT payload FROM events ORDER BY seq').all() as Array<Record<string, unknown>>)
      .map(row => JSON.parse(String(row.payload)));
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

  private payloadIdentity(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  prepareEffect(input: Omit<EffectRecord, 'state' | 'payload_hash' | 'response' | 'businessOutcome'>): EffectRecord {
    const payloadHash = this.payloadIdentity(input.payload);
    const existing = this.db.prepare('SELECT payload_hash, state, response, business_outcome FROM effects WHERE id = ?').get(input.id);
    if (existing) {
      if (String(existing.payload_hash) !== payloadHash) throw new Error('effect ID conflict');
      return {
        ...input,
        state: String(existing.state) as EffectRecord['state'],
        ...(existing.response == null ? {} : { authoritativeResponse: JSON.parse(String(existing.response)) }),
        ...(existing.business_outcome == null ? {} : { businessOutcome: JSON.parse(String(existing.business_outcome)) })
      };
    }
    this.db.prepare(`INSERT INTO effects(
        id, run_id, operation, kind, payload_hash, payload, challenge_id, generation, budget,
        deadline, expected_postcondition, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`)
      .run(input.id, input.runId, input.operation, input.kind, payloadHash, JSON.stringify(input.payload), input.challengeId, input.generation, JSON.stringify(input.budget), input.deadline, input.expectedPostcondition);
    return { ...input, state: 'prepared' };
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
      state: String(row.state) as EffectRecord['state'],
      ...(row.response == null ? {} : { authoritativeResponse: JSON.parse(String(row.response)) }),
      ...(row.business_outcome == null ? {} : { businessOutcome: JSON.parse(String(row.business_outcome)) })
    };
  }

  dispatchEffect(id: string): EffectRecord {
    const effect = this.getEffect(id);
    if (effect.state !== 'prepared') throw new Error(`cannot dispatch from ${effect.state}`);
    this.db.prepare("UPDATE effects SET state = 'dispatching' WHERE id = ?").run(id);
    return this.getEffect(id);
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
