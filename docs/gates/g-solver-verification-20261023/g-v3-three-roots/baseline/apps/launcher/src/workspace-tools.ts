// Workspace tools for the solver role (G design section 3). They take one already-resolved challenge root that holds
// materials/ (read-only), work/ (read-write) and published/ (read-only). The module knows nothing about sessions or
// roles: binding is the control service's job. Host paths are never returned; every result uses the virtual path.
import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export const WORKSPACE_ROOTS = ['materials', 'work', 'published'];
/** Bytes of text per read page; same value as intake-tools' PAGE_BYTES, kept separate so the intake behaviour is untouched. */
export const READ_PAGE_BYTES = 32768;
export const WRITE_LIMIT_BYTES = 1024 * 1024;
export const LIST_LIMIT = 500;
export const SEARCH_FILE_LIMIT = 1024 * 1024;
export const SEARCH_MATCH_LIMIT = 200;
export const SEARCH_OUTPUT_BYTES = 32768;
export const SEARCH_SNIPPET_CHARS = 200;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Thrown for any refusal; callers turn `code` into a fixed denial message. */
export class WorkspaceRefused extends Error { constructor(readonly code: string) { super(code); } }

function refuse(code: string): never { throw new WorkspaceRefused(code); }

/** Shape check only (no filesystem): relative, no `..`, no empty or `.` segments, first segment is a workspace root. */
export function splitWorkspacePath(path: unknown): string[] {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) refuse('workspace path');
  const segments = path.split('/');
  if (segments.some(s => !s || s === '.' || s === '..')) refuse('workspace path');
  if (!WORKSPACE_ROOTS.includes(segments[0]!)) refuse('workspace path');
  return segments;
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

async function realRootOf(root: string): Promise<string> {
  return realpath(root).catch(() => refuse('workspace path'));
}

/**
 * Walks the segments from the real root with lstat; any symbolic link refuses, as does a non-directory in the middle.
 * With `creating`, a missing trailing segment is allowed (returned without details), and a missing middle directory is
 * created, but never the first-level root directory itself.
 */
async function walk(realRoot: string, segments: string[], creating: boolean): Promise<{ abs: string; details?: Stats }> {
  let current = realRoot;
  let details: Stats | undefined;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const last = index === segments.length - 1;
    details = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (creating && error.code === 'ENOENT') return undefined;
      return refuse('workspace path');
    });
    if (!details) {
      if (last) break;
      if (index === 0) refuse('workspace path');
      await mkdir(current).catch(() => refuse('workspace path'));
      continue;
    }
    if (details.isSymbolicLink() || (!last && !details.isDirectory())) refuse('workspace path');
  }
  return { abs: current, details };
}

/** The real location of `path` must stay under the real root's first-level directory (equality allowed for directories). */
async function assertInside(base: string, path: string): Promise<void> {
  const real = await realpath(path).catch(() => refuse('workspace path'));
  if (real !== base && !real.startsWith(base + sep)) refuse('workspace path');
}

async function describeEntry(dir: string, name: string, dirent: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }) {
  if (dirent.isDirectory()) return { name, type: 'dir' as const };
  if (dirent.isSymbolicLink()) return { name, type: 'symlink' as const };
  if (dirent.isFile()) return { name, type: 'file' as const, size: (await lstat(join(dir, name))).size };
  return { name, type: 'other' as const };
}

export async function listWorkspace(root: string, args: Record<string, unknown>) {
  const realRoot = await realRootOf(root);
  if (args.path === undefined || args.path === null) {
    const dirents = (await readdir(realRoot, { withFileTypes: true })).filter(d => WORKSPACE_ROOTS.includes(d.name) && d.isDirectory());
    return { path: '', entries: dirents.sort(byName).map(d => ({ name: d.name, type: 'dir' as const })), truncated: false };
  }
  const segments = splitWorkspacePath(args.path);
  const { abs, details } = await walk(realRoot, segments, false);
  if (!details?.isDirectory()) refuse('workspace path');
  await assertInside(join(realRoot, segments[0]!), abs);
  const dirents = (await readdir(abs, { withFileTypes: true })).sort(byName);
  const entries = await Promise.all(dirents.slice(0, LIST_LIMIT).map(d => describeEntry(abs, d.name, d)));
  return { path: segments.join('/'), entries, truncated: dirents.length > LIST_LIMIT };
}

export async function readWorkspace(root: string, args: Record<string, unknown>) {
  const segments = splitWorkspacePath(args.path);
  const realRoot = await realRootOf(root);
  const { abs, details } = await walk(realRoot, segments, false);
  if (!details?.isFile()) refuse('workspace path');
  await assertInside(join(realRoot, segments[0]!), abs);

  const bytes = await readFile(abs);
  const base = { path: segments.join('/'), size: bytes.length };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary data');
  } catch { return { ...base, binary: true, signature: bytes.subarray(0, 8).toString('hex') || 'empty' }; }

  // Cursor is the decimal byte offset of the next page; a page never splits a UTF-8 character.
  const cursor = args.cursor;
  let start = 0;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || !/^\d{1,15}$/.test(cursor)) refuse('cursor');
    start = Number(cursor);
    if (start > bytes.length || (start < bytes.length && (bytes[start]! & 0xc0) === 0x80)) refuse('cursor');
  }
  let end = Math.min(start + READ_PAGE_BYTES, bytes.length);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  if (end <= start && start < bytes.length) refuse('cursor');
  return { ...base, text: bytes.subarray(start, end).toString('utf8'), offset: start, nextCursor: end < bytes.length ? String(end) : null, done: end >= bytes.length };
}

function decodeContent(content: unknown, encoding: unknown): Buffer {
  if (typeof content !== 'string') refuse('content');
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') refuse('encoding');
  if (encoding === 'base64' && !BASE64.test(content)) refuse('content');
  const bytes = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8');
  if (bytes.length > WRITE_LIMIT_BYTES) refuse('content size');
  return bytes;
}

/** Writes only under work/. Overwrites an existing regular file or creates a new one; the rename keeps the target all-or-nothing. */
export async function writeWorkspace(root: string, args: Record<string, unknown>) {
  const segments = splitWorkspacePath(args.path);
  if (segments[0] !== 'work' || segments.length < 2) refuse('write target');
  const bytes = decodeContent(args.content, args.encoding);
  const realRoot = await realRootOf(root);
  const { abs, details } = await walk(realRoot, segments, true);
  if (details && !details.isFile()) refuse('write target');
  await assertInside(join(realRoot, 'work'), dirname(abs));

  const temp = join(dirname(abs), `.${basename(abs)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, abs);
  } catch {
    await rm(temp, { force: true });
    refuse('write failed');
  }
  return { path: segments.join('/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Recurses into directories, never follows symbolic links, and returns files in name order. */
async function collectFiles(path: string, out: string[]): Promise<void> {
  const details = await lstat(path);
  if (details.isFile()) { out.push(path); return; }
  if (!details.isDirectory()) return;
  for (const dirent of (await readdir(path, { withFileTypes: true })).sort(byName)) await collectFiles(join(path, dirent.name), out);
}

/** Valid UTF-8 without NUL bytes, or undefined for a binary file. */
function decodeText(bytes: Buffer): string | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? undefined : text;
  } catch { return undefined; }
}

/** Literal, line-based matching: `needle` never becomes a regular expression. A needle containing a newline cannot match. */
export async function searchWorkspace(root: string, args: Record<string, unknown>) {
  if (typeof args.needle !== 'string' || args.needle === '') refuse('needle');
  const needle = args.needle;
  const realRoot = await realRootOf(root);
  const files: string[] = [];
  let scope: string;
  if (args.path === undefined || args.path === null) {
    scope = '';
    const roots = (await readdir(realRoot, { withFileTypes: true })).filter(d => WORKSPACE_ROOTS.includes(d.name) && d.isDirectory());
    for (const dirent of roots.sort(byName)) await collectFiles(join(realRoot, dirent.name), files);
  } else {
    const segments = splitWorkspacePath(args.path);
    const { abs, details } = await walk(realRoot, segments, false);
    if (!details) refuse('workspace path');
    await assertInside(join(realRoot, segments[0]!), abs);
    scope = segments.join('/');
    await collectFiles(abs, files);
  }

  const matches: { path: string; line: number; snippet: string }[] = [];
  let outputBytes = 0;
  let truncated = false;
  search: for (const file of files) {
    if ((await lstat(file)).size > SEARCH_FILE_LIMIT) continue;
    const text = decodeText(await readFile(file));
    if (text === undefined) continue;
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.includes(needle)) continue;
      const match = {
        path: relative(realRoot, file).split(sep).join('/'),
        line: index + 1,
        snippet: Array.from(line.replace(/\r$/, '')).slice(0, SEARCH_SNIPPET_CHARS).join('')
      };
      const size = Buffer.byteLength(JSON.stringify(match));
      if (matches.length >= SEARCH_MATCH_LIMIT || outputBytes + size > SEARCH_OUTPUT_BYTES) { truncated = true; break search; }
      matches.push(match);
      outputBytes += size;
    }
  }
  return { path: scope, needle, matches, truncated };
}
