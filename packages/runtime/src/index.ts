import { isAbsolute, join, resolve, sep } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import type { ArtifactStore } from '@ctf/artifacts';

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
    return readFile(this.insideWorkspace(relative));
  }

  async search(relative: string, needle: string): Promise<string[]> {
    const text = (await this.read(relative)).toString('utf8');
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

export class ToolRuntime {
  private readonly interactive = new InteractiveRuntime(taskId => this.workspace(taskId).path);
  private readonly httpSessions = new Map<string, { closed: boolean; requests: Array<{ request: unknown; response: unknown }> }>();

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
    this.httpSessions.set(id, { closed: false, requests: [] });
    return id;
  }

  async httpRequest(sessionId: string, url: string, init?: RequestInit, maxResponseBytes = 1_048_576): Promise<{ status: number; body: Buffer; artifact: Awaited<ReturnType<ArtifactStore['publish']>> }> {
    const allowed = url === this.scope || url.startsWith(this.scope + '/');
    if (!allowed) throw new Error(`HTTP URL outside challenge scope: ${url}`);
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new Error('invalid HTTP response byte limit');
    const session = this.httpSessions.get(sessionId);
    if (!session || session.closed) throw new Error('HTTP session closed');
    const response = await fetch(url, init);
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
    session.requests.push({ request: { url, method: init?.method ?? 'GET' }, response: { status: response.status, artifactHash: artifact.hash } });
    return { status: response.status, body, artifact };
  }

  closeHttpSession(sessionId: string): void {
    const session = this.httpSessions.get(sessionId);
    if (!session) throw new Error('HTTP session not found');
    session.closed = true;
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
