// Intake's two managed tools (E design section 4), executed host-side by the control service. They only read what
// run preparation pinned under workspace/<id>/materials/; nothing here writes, and no host path is ever returned.
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import type { PreparedChallenge } from './run-prep.js';

export const INTAKE_TOOLS = ['challenge.list', 'challenge.read'];
/** Bytes of text per page; well below the 262144-byte `tool_output.max_bytes` of product/opencode/opencode.json. */
export const PAGE_BYTES = 32768;

/** Thrown for any refusal; the control service turns `code` into a fixed denial message. */
export class IntakeRefused extends Error { constructor(readonly code: string) { super(code); } }

export function listChallenges(challenges: PreparedChallenge[]) {
  return {
    challenges: challenges.map(c => ({
      id: c.id, title: c.title,
      target: c.target ? (c.target.protocol === 'tcp' ? { protocol: 'tcp', host: c.target.host, port: c.target.port } : { protocol: c.target.protocol, url: c.target.url })
        : '無網路目標',
      reachabilityCheckedAt: c.reachability?.checkedAt ?? null,
      materials: c.materials
    }))
  };
}

export function findChallenge(challenges: PreparedChallenge[], id: unknown): PreparedChallenge {
  const found = typeof id === 'string' ? challenges.find(c => c.id === id) : undefined;
  if (!found) throw new IntakeRefused('challenge id');
  return found;
}

/** Shape check only (no filesystem): relative, no `..`, no empty segments. */
export function checkMaterialPath(path: unknown): string[] {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) throw new IntakeRefused('material path');
  const segments = path.split('/');
  if (segments.some(s => !s || s === '.' || s === '..')) throw new IntakeRefused('material path');
  return segments;
}

export async function readMaterial(challenges: PreparedChallenge[], args: Record<string, unknown>) {
  const challenge = findChallenge(challenges, args.id);
  const segments = checkMaterialPath(args.path);
  const root = await realpath(challenge.materialsDir).catch(() => { throw new IntakeRefused('material path'); });
  let current = challenge.materialsDir;
  let details;
  try {
    for (const segment of segments) { current = join(current, segment); details = await lstat(current); if (details.isSymbolicLink()) throw new IntakeRefused('material path'); }
    if (!details?.isFile()) throw new IntakeRefused('material path');
    const real = await realpath(current);
    if (!real.startsWith(root + sep)) throw new IntakeRefused('material path');
  } catch (error) { throw error instanceof IntakeRefused ? error : new IntakeRefused('material path'); }

  const bytes = await readFile(current);
  const base = { id: challenge.id, path: segments.join('/'), size: bytes.length };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary data');
  } catch { return { ...base, binary: true, signature: bytes.subarray(0, 8).toString('hex') || 'empty' }; }

  // Cursor is the decimal byte offset of the next page; a page never splits a UTF-8 character.
  const cursor = args.cursor;
  let start = 0;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || !/^\d{1,15}$/.test(cursor)) throw new IntakeRefused('cursor');
    start = Number(cursor);
    if (start > bytes.length || (start < bytes.length && (bytes[start]! & 0xc0) === 0x80)) throw new IntakeRefused('cursor');
  }
  let end = Math.min(start + PAGE_BYTES, bytes.length);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  if (end <= start && start < bytes.length) throw new IntakeRefused('cursor');
  return { ...base, text: bytes.subarray(start, end).toString('utf8'), offset: start, nextCursor: end < bytes.length ? String(end) : null, done: end >= bytes.length };
}
