import { filePage } from './file-page.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export interface WorkspaceRoots { materialsDir: string; workDir: string; publishedDir: string }
const rootKeys = { materials: 'materialsDir', work: 'workDir', published: 'publishedDir' } as const;
export const WORKSPACE_ROOTS = ['materials', 'work', 'published'];
/** Public page size retained for adapter consumers; pagination is shared with Intake. */
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

async function realRootOf(roots: WorkspaceRoots, name: string): Promise<string> {
  const key = rootKeys[name as keyof typeof rootKeys];
  if (!key || !roots || typeof roots[key] !== 'string') refuse('workspace path');
  const path = roots[key];
  if ((await lstat(path).catch(() => refuse('workspace path'))).isSymbolicLink()) refuse('workspace path');
  if (!(await lstat(path)).isDirectory()) refuse('workspace path');
  return realpath(path).catch(() => refuse('workspace path'));
}

/**
 * Walks the segments from the real root with lstat; any symbolic link refuses, as does a non-directory in the middle.
 * With `creating`, a missing trailing segment is allowed (returned without details), and a missing middle directory is
 * created within the already existing mapped root.
 */
async function walk(realRoot: string, segments: string[], creating: boolean): Promise<{ abs: string; details?: Stats }> {
  let current = realRoot;
  let details: Stats | undefined = await lstat(realRoot);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const last = index === segments.length - 1;
    details = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (creating && error.code === 'ENOENT') return undefined;
      return refuse('workspace path');
    });
    if (!details) {
      if (last) break;
      await mkdir(current).catch(() => refuse('workspace path'));
      continue;
    }
    if (details.isSymbolicLink() || (!last && !details.isDirectory())) refuse('workspace path');
  }
  return { abs: current, details };
}

/** The resolved path must remain within the selected mapped root. */
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

export async function listWorkspace(root: WorkspaceRoots, args: Record<string, unknown>) {
  if (args.path === undefined || args.path === null) {
    for (const name of WORKSPACE_ROOTS) await realRootOf(root, name);
    return { path: '', entries: [...WORKSPACE_ROOTS].sort().map(name => ({ name, type: 'dir' as const })), truncated: false };
  }
  const segments = splitWorkspacePath(args.path);
  const realRoot = await realRootOf(root, segments[0]!);
  const { abs, details } = await walk(realRoot, segments.slice(1), false);
  if (!details?.isDirectory()) refuse('workspace path');
  await assertInside(realRoot, abs);
  const dirents = (await readdir(abs, { withFileTypes: true })).sort(byName);
  const entries = await Promise.all(dirents.slice(0, LIST_LIMIT).map(d => describeEntry(abs, d.name, d)));
  return { path: segments.join('/'), entries, truncated: dirents.length > LIST_LIMIT };
}

export async function readWorkspace(root: WorkspaceRoots, args: Record<string, unknown>) {
  const segments = splitWorkspacePath(args.path);
  const realRoot = await realRootOf(root, segments[0]!);
  const { abs, details } = await walk(realRoot, segments.slice(1), false);
  if (!details?.isFile()) refuse('workspace path');
  await assertInside(realRoot, abs);

  const bytes = await readFile(abs);
  const base = { path: segments.join('/'), size: bytes.length };
  return { ...base, ...filePage(bytes, args.cursor, refuse) };
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
export async function writeWorkspace(root: WorkspaceRoots, args: Record<string, unknown>) {
  const segments = splitWorkspacePath(args.path);
  if (segments[0] !== 'work' || segments.length < 2) refuse('write target');
  const bytes = decodeContent(args.content, args.encoding);
  const realRoot = await realRootOf(root, segments[0]!);
  const { abs, details } = await walk(realRoot, segments.slice(1), true);
  if (details && !details.isFile()) refuse('write target');
  await assertInside(realRoot, dirname(abs));

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
export async function searchWorkspace(root: WorkspaceRoots, args: Record<string, unknown>) {
  if (typeof args.needle !== 'string' || args.needle === '') refuse('needle');
  const needle = args.needle;
  const files: string[] = [];
  const virtualFiles = new Map<string, string>();
  async function collectRoot(name: string, abs: string, realRoot: string) {
    const found: string[] = []; await collectFiles(abs, found);
    for (const file of found) { files.push(file); virtualFiles.set(file, [name, relative(realRoot, file).split(sep).join('/')].filter(Boolean).join('/')); }
  }
  let scope: string;
  if (args.path === undefined || args.path === null) {
    scope = '';
    for (const name of [...WORKSPACE_ROOTS].sort()) { const realRoot = await realRootOf(root, name); await collectRoot(name, realRoot, realRoot); }
  } else {
    const segments = splitWorkspacePath(args.path);
    const realRoot = await realRootOf(root, segments[0]!);
  const { abs, details } = await walk(realRoot, segments.slice(1), false);
    if (!details) refuse('workspace path');
    await assertInside(realRoot, abs);
    scope = segments.join('/');
    await collectRoot(segments[0]!, abs, realRoot);
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
        path: virtualFiles.get(file)!,
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
