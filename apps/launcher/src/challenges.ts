// Challenge list: loads and validates the non-secret challenge list named by the release profile.
// It only parses and checks the file; copying materials and reachability checks live in run-prep.ts.
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Blocked } from './blocked.js';

export const DEFAULT_REACHABILITY_TIMEOUT_MS = 3000;

export type ChallengeTarget = { protocol: 'http' | 'https' | 'tcp'; host: string; port: number; url?: string };
export interface Challenge {
  id: string; title?: string;
  /** Exactly one of `file` / `text` is set when the challenge has a statement. */
  statement?: { file?: string; text?: string };
  materials: string[]; // absolute paths
  target?: ChallengeTarget;
}
export interface ChallengeList { path: string; reachabilityTimeoutMs: number; challenges: Challenge[] }

const FIELDS = new Set(['id', 'title', 'statement', 'statementFile', 'materials', 'target']);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function requireRegularFile(path: string, what: string): Promise<void> {
  if (!existsSync(path)) throw new Blocked(`${what} does not exist: ${path}`);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Blocked(`${what} must not be a symbolic link: ${path}`);
  if (!info.isFile()) throw new Blocked(`${what} must be a regular file: ${path}`);
}

function parseTarget(id: string, value: unknown): ChallengeTarget {
  if (!isObject(value)) throw new Blocked(`challenge ${id}: target must be an object`);
  const { protocol } = value;
  if (protocol !== 'http' && protocol !== 'https' && protocol !== 'tcp') throw new Blocked(`challenge ${id}: target.protocol must be http, https or tcp`);
  const allowed = protocol === 'tcp' ? ['protocol', 'host', 'port'] : ['protocol', 'url'];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Blocked(`challenge ${id}: target for ${protocol} only accepts ${allowed.join(', ')}`);
  if (protocol === 'tcp') {
    if (typeof value.host !== 'string' || !value.host || !Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535) {
      throw new Blocked(`challenge ${id}: tcp target needs host and port`);
    }
    return { protocol, host: value.host, port: value.port as number };
  }
  if (typeof value.url !== 'string') throw new Blocked(`challenge ${id}: ${protocol} target needs url`);
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Blocked(`challenge ${id}: target.url is not a valid URL`); }
  if (url.protocol !== `${protocol}:` || !url.hostname) throw new Blocked(`challenge ${id}: target.url does not match protocol ${protocol}`);
  return { protocol, url: value.url, host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : protocol === 'https' ? 443 : 80 };
}

export async function loadChallengeList(path: string): Promise<ChallengeList> {
  if (!existsSync(path)) throw new Blocked(`challenge list does not exist: ${path}`);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Blocked(`challenge list is not valid JSON: ${path}`); }
  if (!isObject(raw) || Object.keys(raw).some(k => k !== 'reachabilityTimeoutMs' && k !== 'challenges')) {
    throw new Blocked('challenge list must be an object with only reachabilityTimeoutMs and challenges');
  }
  const timeout = raw.reachabilityTimeoutMs ?? DEFAULT_REACHABILITY_TIMEOUT_MS;
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) throw new Blocked('reachabilityTimeoutMs must be a positive number');
  if (!Array.isArray(raw.challenges) || raw.challenges.length === 0) throw new Blocked('challenge list is empty');
  const base = dirname(resolve(path));
  const ids = new Set<string>();
  const challenges: Challenge[] = [];
  for (const entry of raw.challenges) {
    if (!isObject(entry)) throw new Blocked('challenge entry must be an object');
    const unknown = Object.keys(entry).filter(k => !FIELDS.has(k));
    if (unknown.length) throw new Blocked(`challenge has unknown fields: ${unknown.join(', ')}`);
    const id = entry.id;
    if (typeof id !== 'string' || !/^[\w.-]+$/.test(id) || id.startsWith('.')) throw new Blocked(`invalid challenge id: ${String(id)}`);
    if (ids.has(id)) throw new Blocked(`duplicate challenge id: ${id}`);
    ids.add(id);
    if (entry.title !== undefined && typeof entry.title !== 'string') throw new Blocked(`challenge ${id}: title must be a string`);
    const challenge: Challenge = { id, ...(entry.title !== undefined ? { title: entry.title as string } : {}), materials: [] };
    if (entry.statement !== undefined && entry.statementFile !== undefined) throw new Blocked(`challenge ${id}: statement and statementFile are mutually exclusive`);
    if (entry.statement !== undefined) {
      if (typeof entry.statement !== 'string' || !entry.statement.trim()) throw new Blocked(`challenge ${id}: statement must be a non-empty string`);
      challenge.statement = { text: entry.statement };
    }
    if (entry.statementFile !== undefined) {
      if (typeof entry.statementFile !== 'string' || !entry.statementFile) throw new Blocked(`challenge ${id}: statementFile must be a path`);
      const file = resolve(base, entry.statementFile);
      await requireRegularFile(file, `challenge ${id}: statement file`);
      challenge.statement = { file };
    }
    if (entry.materials !== undefined) {
      if (!Array.isArray(entry.materials) || entry.materials.some(m => typeof m !== 'string' || !m)) throw new Blocked(`challenge ${id}: materials must be a list of paths`);
      for (const m of entry.materials as string[]) {
        const file = resolve(base, m);
        await requireRegularFile(file, `challenge ${id}: material`);
        challenge.materials.push(file);
      }
    }
    if (entry.target !== undefined) challenge.target = parseTarget(id, entry.target);
    if (!challenge.statement && challenge.materials.length === 0 && !challenge.target) {
      throw new Blocked(`challenge ${id}: needs at least one of statement, materials, target`);
    }
    challenges.push(challenge);
  }
  return { path: resolve(path), reachabilityTimeoutMs: timeout, challenges };
}
