import { filePage } from './file-page.js';
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

export function listChallenges(challenges: PreparedChallenge[], completion?: (challenge:PreparedChallenge)=>unknown) {
  return {
    challenges: challenges.map(c => ({
      id: c.id, title: c.title,...(completion?{completion:completion(c)}:{}),
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
  return { ...base, ...filePage(bytes, args.cursor, code => { throw new IntakeRefused(code); }) };
}
