import { filePage } from './file-page.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
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

/** Deliver one saved image's bytes; signature detection only, no decoding or semantic judgment. */
export async function viewWorkspace(root: WorkspaceRoots, args: Record<string, unknown>, published?: Array<{ path: string; bytes: Buffer }>) {
  if (Object.keys(args).some(key => key !== 'path')) refuse('view arguments');
  const segments = splitWorkspacePath(args.path);
  if (segments.length < 2) refuse('workspace path');
  const path = segments.join('/');
  let bytes: Buffer;
  if (segments[0] === 'published' && published) {
    const fixed = published.find(file => file.path === path);
    if (!fixed) refuse('workspace path');
    bytes = fixed.bytes;
  } else {
    const realRoot = await realRootOf(root, segments[0]!);
    const { abs, details } = await walk(realRoot, segments.slice(1), false);
    if (!details?.isFile()) refuse('workspace path');
    await assertInside(realRoot, abs);
    if (details.size > SEARCH_FILE_LIMIT) refuse('image size');
    const handle = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (!current.isFile()) refuse('workspace path');
      if (current.size > SEARCH_FILE_LIMIT) refuse('image size');
      // Read at most limit+1 even if the file grows after stat; the extra byte detects overflow.
      const buffer = Buffer.alloc(SEARCH_FILE_LIMIT + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      bytes = buffer.subarray(0, size);
    } finally { await handle.close(); }
  }
  if (bytes.length > SEARCH_FILE_LIMIT) refuse('image size');
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' :
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : undefined;
  if (!mime) refuse('image type');
  return { mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
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

interface DiffLine { line: number; text: string }
interface LineDifference { type: 'added' | 'removed' | 'changed'; a: DiffLine | null; b: DiffLine | null }

/** Keep terminators: CRLF and a missing final newline are literal differences, not normalization. */
function diffLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push(text.slice(start, end));
    start = end;
  }
  return lines;
}

/**
 * Patience alignment: equal unique lines anchor an increasing sequence; unmatched runs are
 * paired as literal replacements. This need not be a minimum edit script. Limit alignment
 * depth so repeated/pathological lines cannot cause quadratic work or recursive stack growth.
 */
function* lineDifferences(a: string[], b: string[]): Generator<LineDifference> {
  const pending = [{ aStart: 0, aEnd: a.length, bStart: 0, bEnd: b.length, depth: 0 }];
  while (pending.length) {
    let { aStart, aEnd, bStart, bEnd, depth } = pending.pop()!;
    while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) { aStart++; bStart++; }
    while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
    const anchors: { a: number; b: number }[] = [];
    if (depth < 32 && aStart < aEnd && bStart < bEnd) {
      const unique = (lines: string[], start: number, end: number) => {
        const positions = new Map<string, number>();
        for (let i = start; i < end; i++) positions.set(lines[i]!, positions.has(lines[i]!) ? -1 : i);
        return positions;
      };
      const aPositions = unique(a, aStart, aEnd);
      const bPositions = unique(b, bStart, bEnd);
      const candidates: { a: number; b: number; previous: number }[] = [];
      const tails: number[] = [];
      for (const [text, ai] of aPositions) {
        const bi = bPositions.get(text);
        if (ai < 0 || bi === undefined || bi < 0) continue;
        let low = 0, high = tails.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (candidates[tails[mid]!]!.b < bi) low = mid + 1; else high = mid;
        }
        candidates.push({ a: ai, b: bi, previous: low === 0 ? -1 : tails[low - 1]! });
        tails[low] = candidates.length - 1;
      }
      let index = tails.at(-1) ?? -1;
      while (index !== -1) {
        const match = candidates[index]!;
        anchors.push(match);
        index = match.previous;
      }
      anchors.reverse();
    }
    if (anchors.length) {
      const gaps = [];
      for (const anchor of anchors) {
        gaps.push({ aStart, aEnd: anchor.a, bStart, bEnd: anchor.b, depth: depth + 1 });
        aStart = anchor.a + 1; bStart = anchor.b + 1;
      }
      gaps.push({ aStart, aEnd, bStart, bEnd, depth: depth + 1 });
      // LIFO keeps the emitted differences in source order without recursive calls.
      for (let i = gaps.length - 1; i >= 0; i--) pending.push(gaps[i]!);
      continue;
    }
    while (aStart < aEnd || bStart < bEnd) {
      const left = aStart < aEnd ? { line: aStart + 1, text: a[aStart++]! } : null;
      const right = bStart < bEnd ? { line: bStart + 1, text: b[bStart++]! } : null;
      if (left && right && left.text === right.text) continue;
      yield { type: left ? right ? 'changed' : 'removed' : 'added', a: left, b: right };
    }
  }
}

/** Compare two already-saved files, never fetching their sources or assigning a semantic verdict. */
export async function diffWorkspace(root: WorkspaceRoots, args: Record<string, unknown>, published?: Array<{ path: string; bytes: Buffer }>) {
  const paths = [splitWorkspacePath(args.a), splitWorkspacePath(args.b)];
  const skipped: { path: string; reason: 'binary' | 'oversized' }[] = [];
  async function read(segments: string[]): Promise<string[] | undefined> {
    const path = segments.join('/');
    let bytes: Buffer;
    if (segments[0] === 'published' && published) {
      const fixed = published.find(file => file.path === path);
      if (!fixed) refuse('workspace path');
      bytes = fixed.bytes;
    } else {
      const realRoot = await realRootOf(root, segments[0]!);
      const { abs, details } = await walk(realRoot, segments.slice(1), false);
      if (!details?.isFile()) refuse('workspace path');
      await assertInside(realRoot, abs);
      if (details.size > SEARCH_FILE_LIMIT) { skipped.push({ path, reason: 'oversized' }); return; }
      bytes = await readFile(abs);
    }
    if (bytes.length > SEARCH_FILE_LIMIT) { skipped.push({ path, reason: 'oversized' }); return; }
    const text = decodeText(bytes);
    if (text === undefined) { skipped.push({ path, reason: 'binary' }); return; }
    return diffLines(text);
  }
  const a = await read(paths[0]!);
  const b = await read(paths[1]!);
  const result = { a: paths[0]!.join('/'), b: paths[1]!.join('/'), differences: [] as LineDifference[], skipped, truncated: false };
  let outputBytes = Buffer.byteLength(JSON.stringify(result));
  if (outputBytes > SEARCH_OUTPUT_BYTES) refuse('diff output size');
  if (a && b) for (const difference of lineDifferences(a, b)) {
    const size = Buffer.byteLength(JSON.stringify(difference)) + (result.differences.length ? 1 : 0);
    if (outputBytes + size > SEARCH_OUTPUT_BYTES) { result.truncated = true; break; }
    result.differences.push(difference);
    outputBytes += size;
  }
  return result;
}

/** Literal, line-based matching: needles never become regular expressions. A needle containing a newline cannot match. */
export async function searchWorkspace(root: WorkspaceRoots, args: Record<string, unknown>, published?: Array<{path:string;bytes:Buffer}>) {
  let needles: string[];
  if (args.needles === undefined) {
    if (typeof args.needle !== 'string' || args.needle === '') refuse('needle');
    needles = [args.needle];
  } else {
    if (!Array.isArray(args.needles) || args.needles.length === 0 ||
      !Array.from(args.needles).every(needle => typeof needle === 'string' && needle !== '')) refuse('needles');
    needles = args.needles;
  }
  const files: string[] = [];
  const virtualFiles = new Map<string, string>();
  const fixedBytes = new Map<string, Buffer>();
  function collectPublished(scope: string) {
    for(const p of published ?? []) if(scope==='published' || p.path===scope) { files.push(p.path); virtualFiles.set(p.path,p.path); fixedBytes.set(p.path,p.bytes); }
  }
  async function collectRoot(name: string, abs: string, realRoot: string) {
    const found: string[] = []; await collectFiles(abs, found);
    for (const file of found) { files.push(file); virtualFiles.set(file, [name, relative(realRoot, file).split(sep).join('/')].filter(Boolean).join('/')); }
  }
  let scope: string;
  if (args.path === undefined || args.path === null) {
    scope = '';
    for (const name of [...WORKSPACE_ROOTS].sort()) { if(name==='published' && published) {collectPublished('published');continue;} const realRoot = await realRootOf(root, name); await collectRoot(name, realRoot, realRoot); }
  } else {
    const segments = splitWorkspacePath(args.path);
    scope = segments.join('/');
    if(segments[0]==='published' && published) { collectPublished(scope); }
    else {
      const realRoot = await realRootOf(root, segments[0]!);
      const { abs, details } = await walk(realRoot, segments.slice(1), false);
      if (!details) refuse('workspace path');
      await assertInside(realRoot, abs);
      await collectRoot(segments[0]!, abs, realRoot);
    }
  }

  const matches: { path: string; line: number; snippet: string; offset: number; needle: string }[] = [];
  const coverage = {
    // Text files entered by the search loop, including a partially scanned current file.
    filesExamined: 0,
    skippedByReason: { binary: 0, oversized: 0 },
    stoppedEarly: false,
    skipped: [] as { path: string; reason: 'binary' | 'oversized' }[],
    skippedPathsOmitted: false
  };
  // Bound metadata separately so reporting never changes the existing match/output limits.
  const skippedPathLimit = 20;
  const skippedPathBytesLimit = 2048;
  let skippedPathBytes = 2; // JSON array brackets, plus entries and separators below.
  function recordSkip(file: string, reason: 'binary' | 'oversized') {
    coverage.skippedByReason[reason]++;
    const entry = { path: virtualFiles.get(file)!, reason };
    const size = Buffer.byteLength(JSON.stringify(entry)) + (coverage.skipped.length ? 1 : 0);
    if (coverage.skipped.length >= skippedPathLimit || skippedPathBytes + size > skippedPathBytesLimit) {
      coverage.skippedPathsOmitted = true;
      return;
    }
    coverage.skipped.push(entry);
    skippedPathBytes += size;
  }
  let outputBytes = 0;
  let truncated = false;
  search: for (const file of files) {
    const bytes=fixedBytes.get(file);
    if ((bytes?.length ?? (await lstat(file)).size) > SEARCH_FILE_LIMIT) { recordSkip(file, 'oversized'); continue; }
    const text = decodeText(bytes ?? await readFile(file));
    if (text === undefined) { recordSkip(file, 'binary'); continue; }
    coverage.filesExamined++;
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      const needle = needles.find(needle => line.includes(needle));
      if (needle === undefined) continue;
      // Offsets and snippet lengths count Unicode code points, not UTF-16 code units.
      const offset = Array.from(line.slice(0, line.indexOf(needle))).length;
      const chars = Array.from(needle.endsWith('\r') ? line : line.replace(/\r$/, ''));
      const before = Math.floor(Math.max(0, SEARCH_SNIPPET_CHARS - Array.from(needle).length) / 2);
      const start = Math.max(0, Math.min(offset - before, chars.length - SEARCH_SNIPPET_CHARS));
      const match = {
        path: virtualFiles.get(file)!,
        line: index + 1,
        snippet: chars.slice(start, start + SEARCH_SNIPPET_CHARS).join(''),
        offset,
        needle
      };
      const size = Buffer.byteLength(JSON.stringify(match));
      if (matches.length >= SEARCH_MATCH_LIMIT || outputBytes + size > SEARCH_OUTPUT_BYTES) { truncated = true; coverage.stoppedEarly = true; break search; }
      matches.push(match);
      outputBytes += size;
    }
  }
  return { path: scope, ...(args.needles === undefined ? { needle: needles[0]! } : { needles }), matches, truncated, coverage };
}
