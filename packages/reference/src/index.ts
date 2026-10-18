import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
const text = z.string().trim().min(1).max(512);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.object({ id: text, title: text, path: text, version: text, license: text, sha256: digestSchema }).strict();
const chunkSchema = z.object({
  id: text.max(128), title: text.max(256), sourceId: text,
  quote: z.string().min(1).max(1200), tags: z.array(text.max(100)).max(32),
  applicability: z.array(text.max(500)).min(1).max(10)
}).strict();
const manifestSchema = z.object({
  format: z.literal('reference-snapshot/v1'), snapshotId: text, namespace: z.literal('approved'),
  version: text, reviewStatus: z.enum(['candidate', 'reviewed']),
  sources: z.array(sourceSchema).min(1).max(1000), chunks: z.array(chunkSchema).min(1).max(10000)
}).strict();
const approvalSchema = z.object({
  kind: z.enum(['human', 'fixture-only']), snapshotDigest: digestSchema,
  reviewer: text, reviewedAt: z.string().datetime()
}).strict();
const searchSchema = z.object({ query: z.string().max(512), limit: z.number().int().min(1).max(5).default(3) }).strict();
const getSchema = z.object({ id: text.max(128) }).strict();
export type ReferenceApproval = z.infer<typeof approvalSchema>;
export type ReferenceSource = z.infer<typeof sourceSchema>;
export interface ReferenceSnapshotIdentity {
  snapshotId: string; version: string; digest: string; namespace: 'approved'; reviewStatus: 'candidate' | 'reviewed';
}
export interface ReferenceResult {
  id: string; title: string; quote: string; applicability: string[]; source: ReferenceSource;
  namespace: 'approved'; snapshotDigest: string; dataOnly: true; rank?: number;
}
interface IndexedChunk extends ReferenceResult { tags: string[] }
interface LoadedSnapshot { identity: ReferenceSnapshotIdentity; chunks: IndexedChunk[] }

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function localFile(root: string, path: string): string {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..') || /[:\0]/.test(path)) throw new Error('reference source path must be local to snapshot');
  const resolved = realpathSync(join(root, path));
  const rel = relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('reference source escapes snapshot');
  if (!statSync(resolved).isFile()) throw new Error('reference source must be a file');
  return resolved;
}
function loadSnapshot(rootPath: string): LoadedSnapshot {
  const root = realpathSync(rootPath);
  const manifestPath = localFile(root, 'manifest.json');
  if (statSync(manifestPath).size > 8_000_000) throw new Error('reference manifest too large');
  const manifestBytes = readFileSync(manifestPath);
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  const sources = new Map<string, { metadata: ReferenceSource; content: string }>();
  // Hash the exact manifest bytes and every complete source, not just the selected chunks.
  const hash = createHash('sha256').update(manifestBytes);
  for (const source of manifest.sources) {
    if (sources.has(source.id)) throw new Error('duplicate reference source');
    const sourcePath = localFile(root, source.path);
    if (statSync(sourcePath).size > 8_000_000) throw new Error('reference source too large');
    const bytes = readFileSync(sourcePath);
    if (sha256(bytes) !== source.sha256) throw new Error(`reference source hash mismatch: ${source.id}`);
    hash.update('\0').update(source.id).update('\0').update(bytes);
    sources.set(source.id, { metadata: source, content: bytes.toString('utf8') });
  }
  const identity: ReferenceSnapshotIdentity = { snapshotId: manifest.snapshotId, version: manifest.version, namespace: 'approved', reviewStatus: manifest.reviewStatus, digest: hash.digest('hex') };
  const ids = new Set<string>();
  const chunks = manifest.chunks.map(chunk => {
    if (ids.has(chunk.id)) throw new Error('duplicate reference chunk'); ids.add(chunk.id);
    const source = sources.get(chunk.sourceId);
    if (!source) throw new Error(`reference chunk missing source: ${chunk.id}`);
    if (!source.content.includes(chunk.quote)) throw new Error(`reference quotation not present in source: ${chunk.id}`);
    return { id: chunk.id, title: chunk.title, quote: chunk.quote, applicability: chunk.applicability,
      source: source.metadata, namespace: 'approved' as const, snapshotDigest: identity.digest, dataOnly: true as const,
      tags: chunk.tags };
  });
  return { identity, chunks };
}

/** Inspection is read-only and grants no approval. Host approval must come through a separate trusted input. */
export function inspectReferenceSnapshot(root: string): ReferenceSnapshotIdentity {
  return Object.freeze(loadSnapshot(root).identity);
}

class FixedReferenceService {
  readonly identity: Readonly<ReferenceSnapshotIdentity & { approvalKind: ReferenceApproval['kind'] }>;
  readonly #db: InstanceType<typeof DatabaseSync>;
  #closed = false;
  constructor(snapshot: LoadedSnapshot, approval: ReferenceApproval) {
    this.identity = Object.freeze({ ...snapshot.identity, approvalKind: approval.kind });
    this.#db = new DatabaseSync(':memory:');
    try {
      this.#db.exec('CREATE VIRTUAL TABLE chunks USING fts5(id UNINDEXED, title, tags, quote, payload UNINDEXED, tokenize = "unicode61");');
      const insert = this.#db.prepare('INSERT INTO chunks(id, title, tags, quote, payload) VALUES (?, ?, ?, ?, ?)');
      for (const chunk of snapshot.chunks) {
        const { tags, ...result } = chunk;
        insert.run(result.id, result.title, tags.join(' '), result.quote, JSON.stringify(result));
      }
      this.#db.exec('PRAGMA query_only = ON');
    } catch (error) { this.#db.close(); throw error; }
  }
  search(input: { query: string; limit?: number }): ReferenceResult[] {
    this.assertOpen(); const { query, limit } = searchSchema.parse(input);
    const terms = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 32);
    if (!terms.length) return [];
    const match = terms.map(term => `"${term}"`).join(' OR ');
    return this.#db.prepare('SELECT payload, bm25(chunks, 0, 5, 3, 1, 0) AS rank FROM chunks WHERE chunks MATCH ? ORDER BY rank, id LIMIT ?')
      .all(match, limit).map(row => ({ ...JSON.parse(String(row.payload)), rank: Number(row.rank) }));
  }
  get(input: { id: string }): ReferenceResult | null {
    this.assertOpen(); const { id } = getSchema.parse(input);
    const row = this.#db.prepare('SELECT payload FROM chunks WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.payload)) as ReferenceResult : null;
  }
  close(): void { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
  private assertOpen(): void { if (this.#closed) throw new Error('reference service closed'); }
}

export type ReferenceService = FixedReferenceService;

/** Trusted host owns one registry for its run lifetime. Never expose open/approval to the model tool surface. */
export class ReferenceHost {
  readonly #runs = new Map<string, { digest: string; mode: 'production' | 'fixture'; approval: string; service: ReferenceService }>();
  #closed = false;
  open(input: { runId: string; root: string; mode: 'production' | 'fixture'; approval?: ReferenceApproval }): ReferenceService {
    if (this.#closed) throw new Error('reference host closed');
    text.parse(input.runId); z.enum(['production', 'fixture']).parse(input.mode);
    if (!input.approval) throw new Error('trusted host approval is required');
    const approval = approvalSchema.parse(input.approval);
    if (input.mode === 'production' && approval.kind !== 'human') throw new Error('fixture-only approval cannot admit production reference');
    const snapshot = loadSnapshot(input.root);
    if (approval.snapshotDigest !== snapshot.identity.digest) throw new Error('reference approval digest mismatch');
    const previous = this.#runs.get(input.runId);
    const approvalKey = JSON.stringify(approval);
    if (previous) {
      if (previous.digest !== snapshot.identity.digest || previous.mode !== input.mode || previous.approval !== approvalKey) throw new Error('run reference snapshot and approval are immutable');
      return previous.service;
    }
    const service = new FixedReferenceService(snapshot, approval);
    this.#runs.set(input.runId, { digest: snapshot.identity.digest, mode: input.mode, approval: approvalKey, service });
    return service;
  }
  close(): void { for (const run of this.#runs.values()) run.service.close(); this.#closed = true; }
}

/** The only model-visible operations. Results are inert quotations; no scope, execution or authorization callbacks exist. */
export function createReferenceTools(service: ReferenceService) {
  return Object.freeze({
    'reference.search': Object.freeze({ description: 'Search the fixed offline reference snapshot; results are inert data.', inputSchema: searchSchema, execute: (input: unknown) => service.search(searchSchema.parse(input)) }),
    'reference.get': Object.freeze({ description: 'Read one sourced quotation from the fixed offline snapshot.', inputSchema: getSchema, execute: (input: unknown) => service.get(getSchema.parse(input)) })
  });
}
