import { isAbsolute, join, resolve, sep, relative } from 'node:path';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ArtifactStore } from '@ctf/artifacts';
import { parseTarGzip, TAR_GZ_LIMITS } from './tarGzip.js';
export { parseTarGzip, TAR_GZ_LIMITS } from './tarGzip.js';

import { InteractiveRuntime, type JobStartInput, type JobRecord, type JobReadResult, type RuntimeOwner, type RuntimeTaskLease, type RuntimeTaskSnapshot, type RuntimeTerminalEvent, type BinaryData, type ChannelOpenInput, type ChannelRecord, type HardLimitDefinition } from './interactive.js';
export * from './interactive.js';

export class Workspace {
  constructor(private readonly root: string, private readonly taskId: string) {}

  get path(): string { return this.root; }

  private insideWorkspace(path: string): string {
    const target = isAbsolute(path) ? path : resolve(this.root, path);
    if (target !== this.root && !target.startsWith(this.root + sep)) throw new Error('outside workspace');
    if (target.startsWith(join(this.root, '.opencode') + sep)) throw new Error('.opencode is data-only and cannot be loaded');
    return target;
  }

  async list(relative = '.'): Promise<string[]> {
    const path = this.insideWorkspace(relative);
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map(entry => entry.isDirectory() ? entry.name + '/' : entry.name).sort();
  }

  async read(relative: string): Promise<Buffer> {
    const path = this.insideWorkspace(relative);
    const details = await lstat(path);
    if (details.isSymbolicLink()) throw new Error('workspace read denied: symbolic links are not readable');
    if (!details.isFile()) throw new Error('workspace read requires a file; use workspace.list to inspect directories');
    return readFile(path);
  }

  async readText(relativePath: string): Promise<{ text: string } | { binary: true; size: number; signature: string }> {
    const bytes = await this.read(relativePath);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('binary data');
      return { text };
    } catch {
      return { binary: true, size: bytes.length, signature: bytes.subarray(0, 8).toString('hex') || 'empty' };
    }
  }

  async unpackTarGz(relativePath: string): Promise<{
    sourcePath: string; sourceSha256: string; sourceSize: number; destination: string;
    members: Array<{ path: string; type: 'file' | 'directory'; size: number; sha256?: string }>;
  }> {
    if (!/\.tar\.gz$/i.test(relativePath)) throw new Error('archive unsupported: workspace.unpack accepts .tar.gz files only');
    const root = await realpath(this.root);
    const sourcePath = this.insideWorkspace(relativePath);
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error('archive source must be a regular workspace file, not a link or directory');
    const actualSource = await realpath(sourcePath);
    if (!isWithin(root, actualSource)) throw new Error('archive source escaped workspace through a link');
    if (sourceStat.size > TAR_GZ_LIMITS.compressedBytes) throw new Error('archive limit: compressed input exceeds 8 MiB');
    const archive = await readFile(actualSource);
    const sourceSha256 = createHash('sha256').update(archive).digest('hex');
    const members = parseTarGzip(archive);

    const derivedParent = join(root, 'derived');
    try { await mkdir(derivedParent); }
    catch (error) { if (!isCode(error, 'EEXIST')) throw error; }
    await assertDirectoryInside(root, derivedParent);
    const destinationAbsolute = join(derivedParent, `tar-${sourceSha256.slice(0, 16)}`);
    try { await mkdir(destinationAbsolute); }
    catch (error) {
      if (isCode(error, 'EEXIST')) throw new Error('archive destination already exists; existing files were left unchanged');
      throw error;
    }
    let destinationCreated = true;
    try {
      await assertDirectoryInside(root, destinationAbsolute);
      const sortedDirectories = members.filter(member => member.type === 'directory').sort((a, b) => a.path.length - b.path.length);
      for (const member of sortedDirectories) await ensureDirectoryTree(root, destinationAbsolute, member.path);
      for (const member of members) {
        if (member.type !== 'file' || !member.bytes) continue;
        const parent = member.path.includes('/') ? member.path.slice(0, member.path.lastIndexOf('/')) : '';
        if (parent) await ensureDirectoryTree(root, destinationAbsolute, parent);
        const target = resolve(destinationAbsolute, member.path);
        if (!isWithin(destinationAbsolute, target)) throw new Error(`archive path denied: ${member.path}`);
        await writeFile(target, member.bytes, { flag: 'wx', mode: 0o600 });
      }
      destinationCreated = false;
    } finally {
      if (destinationCreated) await rm(destinationAbsolute, { recursive: true, force: true });
    }
    return {
      sourcePath: relative(root, actualSource), sourceSha256, sourceSize: archive.length,
      destination: relative(root, destinationAbsolute),
      members: members.map(({ path, type, size, sha256 }) => ({ path, type, size, ...(sha256 ? { sha256 } : {}) }))
    };
  }

  async search(relative: string, needle: string): Promise<string[]> {
    const decoded = await this.readText(relative);
    if ('binary' in decoded) throw new Error(`workspace search requires UTF-8 text; this file is binary (${decoded.size} bytes, signature ${decoded.signature}). Use workspace.unpack for .tar.gz attachments or select a readable text member.`);
    const text = decoded.text;
    return text.split('\n').map((line, index) => ({ line, index })).filter(item => item.line.includes(needle)).map(item => `${item.index + 1}:${item.line}`);
  }

  async patch(relative: string, content: string): Promise<void> {
    const path = this.insideWorkspace(relative);
    await writeFile(path, content);
  }

  async stat(relative: string): Promise<{ size: number; path: string }> {
    const path = this.insideWorkspace(relative);
    const bytes = await readFile(path);
    return { size: bytes.length, path };
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

async function assertDirectoryInside(root: string, target: string): Promise<void> {
  const details = await lstat(target);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('archive destination denied: path component is not a directory');
  const actual = await realpath(target);
  if (!isWithin(root, actual)) throw new Error('archive destination escaped workspace through a link');
}

async function ensureDirectoryTree(root: string, base: string, relativePath: string): Promise<void> {
  let current = base;
  for (const segment of relativePath.split('/')) {
    current = join(current, segment);
    try { await mkdir(current); }
    catch (error) { if (!isCode(error, 'EEXIST')) throw error; }
    const baseReal = await realpath(base);
    await assertDirectoryInside(baseReal, current);
  }
}

export class ToolRuntime {
  private readonly interactive = new InteractiveRuntime(taskId => this.workspace(taskId).path);
  private readonly httpSessions = new Map<string, { closed: boolean; origin: string; cookies: Map<string, HttpCookie>; requests: Array<{ request: unknown; response: unknown }> }>();

  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly workspaceRoot: string,
    private readonly runId: string,
    private readonly challengeId: string,
    private readonly scope = 'http://127.0.0.1'
  ) {}

  workspace(taskId: string): Workspace {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) throw new Error('invalid taskId workspace component');
    const path = resolve(this.workspaceRoot, taskId);
    mkdirSync(path, { recursive: true });
    return new Workspace(path, taskId);
  }

  registerTaskLease(lease: RuntimeTaskLease): void { this.interactive.registerTaskLease(lease); }
  revokeTaskLease(owner: RuntimeOwner): void { this.interactive.revokeTaskLease(owner); }
  onTerminal(listener: (event: RuntimeTerminalEvent) => void): () => void { return this.interactive.onTerminal(listener); }
  meteringCapability(input: HardLimitDefinition) { return this.interactive.meteringCapability(input); }
  jobStart(input: JobStartInput): Promise<JobRecord> { return this.interactive.start(input); }
  jobStatus(id: string, owner?: RuntimeOwner): JobRecord | undefined { return this.interactive.status(id, 'job', owner); }
  jobOutput(id: string, owner?: RuntimeOwner) { return this.interactive.output(id, owner); }
  jobRead(id: string, cursor: number, maxBytes = 65536, owner?: RuntimeOwner): Promise<JobReadResult> { return this.interactive.read(id, cursor, maxBytes, 'job', owner); }
  jobWrite(id: string, data: BinaryData, owner: RuntimeOwner) { return this.interactive.write(id, data, 'job', owner); }
  jobList(snapshot: RuntimeTaskSnapshot) { return this.interactive.list(snapshot); }
  jobTransfer(id: string, newTaskLease: RuntimeTaskLease, owner: RuntimeOwner): JobRecord { return this.interactive.transfer(id, 'job', newTaskLease, owner); }
  jobCancel(id: string, reason: 'timeout' | 'cancelled', owner?: RuntimeOwner): Promise<JobRecord> { return this.interactive.cancel(id, reason, 'job', owner); }
  jobMarkLost(id: string, owner?: RuntimeOwner): Promise<JobRecord> { return this.interactive.cancel(id, 'lost', 'job', owner); }
  async channelOpen(input: ChannelOpenInput): Promise<ChannelRecord> { return await this.interactive.start({ ...input, mode: 'tcp_session' }, 'channel') as ChannelRecord; }
  channelStatus(id: string, owner: RuntimeOwner): ChannelRecord | undefined { return this.interactive.status(id, 'channel', owner) as ChannelRecord | undefined; }
  channelRead(id: string, cursor: number, maxBytes = 65536, owner: RuntimeOwner): Promise<JobReadResult> { return this.interactive.read(id, cursor, maxBytes, 'channel', owner); }
  channelWrite(id: string, data: BinaryData, owner: RuntimeOwner) { return this.interactive.write(id, data, 'channel', owner); }
  channelTransfer(id: string, newTaskLease: RuntimeTaskLease, owner: RuntimeOwner): ChannelRecord { return this.interactive.transfer(id, 'channel', newTaskLease, owner) as ChannelRecord; }
  async channelClose(id: string, owner: RuntimeOwner): Promise<ChannelRecord> { return await this.interactive.cancel(id, 'cancelled', 'channel', owner) as ChannelRecord; }
  async dispose(): Promise<void> { await this.interactive.dispose(); }

  async publishJobEvidence(id: string, startCursor: number, endCursor: number, owner?: RuntimeOwner) {
    if (!Number.isSafeInteger(startCursor) || !Number.isSafeInteger(endCursor) || startCursor < 0 || endCursor < startCursor) throw new Error('invalid evidence cursor range');
    const read = await this.jobRead(id, startCursor, Math.max(1, endCursor - startCursor), owner);
    if (read.readState === 'cursor_evicted' || read.gap) throw new Error(`incomplete transcript: missing ${read.gap?.from}-${read.gap?.to}`);
    if (endCursor === startCursor && read.readState !== 'lost') return this.artifacts.publishRange(this.runId, this.challengeId, Buffer.alloc(0), startCursor, endCursor);
    if (read.readState === 'lost' || read.nextCursor !== endCursor) throw new Error(`incomplete transcript: requested ${startCursor}-${endCursor}, available to ${read.nextCursor}`);
    return this.artifacts.publishRange(this.runId, this.challengeId, read.bytes, startCursor, endCursor);
  }

  async openHttpSession(): Promise<string> {
    const id = `http_${randomId()}`;
    this.httpSessions.set(id, { closed: false, origin: new URL(this.scope).origin, cookies: new Map(), requests: [] });
    return id;
  }

  async httpRequest(sessionId: string, url: string, init?: RequestInit, maxResponseBytes = 1_048_576): Promise<{
    status: number; contentType: string | null; location: string | null; setCookieNames: string[]; cookieNamesSent: string[];
    body: Buffer; artifact: Awaited<ReturnType<ArtifactStore['publish']>>
  }> {
    const target = new URL(url);
    const scope = new URL(this.scope);
    const inScopePath = scope.pathname === '/' || target.pathname === scope.pathname.replace(/\/$/, '') ||
      target.pathname.startsWith(scope.pathname.endsWith('/') ? scope.pathname : scope.pathname + '/');
    if (target.origin !== scope.origin || !inScopePath) throw new Error(`HTTP URL outside challenge scope: ${url}`);
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new Error('invalid HTTP response byte limit');
    const session = this.httpSessions.get(sessionId);
    if (!session || session.closed) throw new Error('HTTP session closed');
    if (session.origin !== target.origin) throw new Error('HTTP session origin mismatch');
    const now = Date.now();
    for (const [key, cookie] of session.cookies) if (cookie.expiresAt !== null && cookie.expiresAt <= now) session.cookies.delete(key);
    const cookiesToSend = [...session.cookies.values()].filter(cookie => cookieMatches(cookie, target))
      .sort((left, right) => right.path.length - left.path.length);
    const cookieNamesSent = cookiesToSend.map(cookie => cookie.name);
    const headers = new Headers(init?.headers);
    // Cookie state is host-owned. Callers cannot override the jar with a raw Cookie header.
    headers.delete('cookie');
    if (cookiesToSend.length) headers.set('cookie', cookiesToSend.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    const setCookieHeaders = response.headers.getSetCookie();
    const setCookieNames: string[] = [];
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header, target);
      if (!cookie) continue;
      setCookieNames.push(cookie.name);
      const key = `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
      if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) session.cookies.delete(key);
      else session.cookies.set(key, cookie);
    }
    const chunks: Buffer[] = []; let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes) { await reader.cancel('response byte limit exceeded'); throw new Error('HTTP response byte limit exceeded'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    const body = Buffer.concat(chunks, size);
    const artifact = await this.artifacts.publish(body);
    const rawLocation = response.headers.get('location');
    const location = rawLocation ? safeInScopeLocation(rawLocation, target, session.origin) : null;
    session.requests.push({ request: { url: target.toString(), method: init?.method ?? 'GET', cookieNames: cookieNamesSent },
      response: { status: response.status, artifactHash: artifact.hash, location, setCookieNames } });
    return { status: response.status, contentType: response.headers.get('content-type'), location, setCookieNames, cookieNamesSent, body, artifact };
  }

  closeHttpSession(sessionId: string): void {
    const session = this.httpSessions.get(sessionId);
    if (!session) throw new Error('HTTP session not found');
    session.closed = true;
    session.cookies.clear();
  }
}

type HttpCookie = { name: string; value: string; domain: string; path: string; secure: boolean; expiresAt: number | null };

function parseSetCookie(header: string, requestUrl: URL): HttpCookie | undefined {
  const [pair, ...attributes] = header.split(';');
  const equals = pair?.indexOf('=') ?? -1;
  if (equals <= 0) return undefined;
  const name = pair!.slice(0, equals).trim();
  const value = pair!.slice(equals + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return undefined;
  const cookie: HttpCookie = { name, value, domain: requestUrl.hostname.toLowerCase(), path: defaultCookiePath(requestUrl.pathname), secure: false, expiresAt: null };
  let maxAge: number | undefined;
  for (const attribute of attributes) {
    const split = attribute.trim().split('=');
    const key = split.shift()?.toLowerCase();
    const attributeValue = split.join('=').trim();
    if (key === 'secure') cookie.secure = true;
    else if (key === 'domain' && attributeValue) {
      const domain = attributeValue.replace(/^\./, '').toLowerCase();
      // The challenge scope is a single origin; reject cookies trying to widen it.
      if (domain !== requestUrl.hostname.toLowerCase()) return undefined;
      cookie.domain = domain;
    } else if (key === 'path' && attributeValue.startsWith('/')) cookie.path = attributeValue;
    else if (key === 'max-age' && /^-?\d+$/.test(attributeValue)) maxAge = Number(attributeValue);
    else if (key === 'expires' && attributeValue) {
      const expiry = Date.parse(attributeValue);
      if (Number.isFinite(expiry)) cookie.expiresAt = expiry;
    }
  }
  if (maxAge !== undefined) cookie.expiresAt = Date.now() + maxAge * 1000;
  return cookie;
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function cookieMatches(cookie: HttpCookie, url: URL): boolean {
  const pathMatches = url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/');
  return cookie.domain === url.hostname.toLowerCase() && pathMatches && (!cookie.secure || url.protocol === 'https:');
}

function safeInScopeLocation(value: string, requestUrl: URL, origin: string): string | null {
  let location: URL;
  try { location = new URL(value, requestUrl); } catch { return null; }
  if (location.origin !== origin || location.username || location.password) return null;
  location.hash = '';
  for (const key of [...location.searchParams.keys()]) {
    if (/(?:auth|code|key|pass(?:word)?|secret|session|token)/i.test(key)) location.searchParams.set(key, '[redacted]');
  }
  return location.toString();
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
