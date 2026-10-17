import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { JobIdSchema, type EffectLevel } from '@ctf/contracts';
import type { ArtifactStore } from '@ctf/artifacts';
import { safeEnvironment } from '@ctf/policy';

export interface JobRecord {
  id: string;
  command: string[];
  cwd: string;
  timeoutMs: number;
  effect: EffectLevel;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode: number | null;
  retainedStartCursor: number;
  endCursor: number;
}

export interface JobReadResult {
  jobId: string;
  status: JobRecord['status'] | 'lost';
  readStart: number;
  nextCursor: number;
  retainedStartCursor: number;
  bytes: Buffer;
  readState: 'running' | 'waiting' | 'eof' | 'lost' | 'cursor_evicted';
  gap?: { from: number; to: number };
}

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
  private readonly jobs = new Map<string, JobRecord>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly buffers = new Map<string, Buffer>();
  private readonly httpSessions = new Map<string, { closed: boolean; requests: Array<{ request: unknown; response: unknown }> }>();

  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly workspaceRoot: string,
    private readonly runId: string,
    private readonly challengeId: string,
    private readonly scope = 'http://127.0.0.1'
  ) {}

  workspace(taskId: string): Workspace {
    if (!taskId) throw new Error('taskId required');
    const path = resolve(this.workspaceRoot, taskId);
    mkdirSync(path, { recursive: true });
    return new Workspace(path, taskId);
  }

  async jobStart(input: {
    taskId: string;
    command: string[];
    cwd?: string;
    timeoutMs?: number;
    effect?: EffectLevel;
    maxRetainedBytes?: number;
    env?: Record<string, string>;
  }): Promise<JobRecord> {
    const id = JobIdSchema.parse(`job_${createHash('sha256').update(JSON.stringify([this.runId, input.command, Date.now(), Math.random()])).digest('hex').slice(0, 24)}`);
    const workspace = this.workspace(input.taskId);
    const cwd = input.cwd ? workspace.path + '/' + input.cwd : workspace.path;
    const record: JobRecord = {
      id,
      command: input.command,
      cwd,
      timeoutMs: input.timeoutMs ?? 30000,
      effect: input.effect ?? 'retryable_observation',
      status: 'running',
      exitCode: null,
      retainedStartCursor: 0,
      endCursor: 0
    };
    // Record first, then spawn, so a lost RPC cannot create a duplicate attempt.
    this.jobs.set(id, record);
    const maxRetained = input.maxRetainedBytes ?? 1024 * 1024;
    const child = spawn(input.command[0]!, input.command.slice(1), {
      cwd,
      env: safeEnvironment(input.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    this.children.set(id, child);
    this.buffers.set(id, Buffer.alloc(0));
    const append = (bytes: Buffer) => {
      const buffer = Buffer.concat([this.buffers.get(id)!, bytes]);
      if (buffer.length > maxRetained) {
        const remove = buffer.length - maxRetained;
        this.buffers.set(id, buffer.subarray(remove));
        record.retainedStartCursor += remove;
      } else this.buffers.set(id, buffer);
      record.endCursor += bytes.length;
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code, signal) => {
      const job = this.jobs.get(id);
      if (!job || job.status === 'cancelled' || job.status === 'timeout') return;
      job.exitCode = code;
      job.status = signal ? 'failed' : code === 0 ? 'completed' : 'failed';
    });
    const timer = setTimeout(() => { void this.jobCancel(id, 'timeout'); }, record.timeoutMs);
    child.on('close', () => clearTimeout(timer));
    return { ...record };
  }

  jobStatus(id: string): JobRecord | undefined { return this.jobs.get(id); }

  async jobRead(id: string, cursor: number, maxBytes = 65536): Promise<JobReadResult> {
    const job = this.jobs.get(id);
    if (!job) return { jobId: id, status: 'lost', readStart: cursor, nextCursor: cursor, retainedStartCursor: 0, bytes: Buffer.alloc(0), readState: 'lost' };
    if (cursor < job.retainedStartCursor) {
      return {
        jobId: id,
        status: job.status,
        readStart: cursor,
        nextCursor: job.retainedStartCursor,
        retainedStartCursor: job.retainedStartCursor,
        bytes: Buffer.alloc(0),
        readState: 'cursor_evicted',
        gap: { from: cursor, to: job.retainedStartCursor }
      };
    }
    const all = this.buffers.get(id)!;
    const bytes = all.subarray(cursor - job.retainedStartCursor, cursor - job.retainedStartCursor + maxBytes);
    const next = cursor + bytes.length;
    const readState = job.status === 'running' ? 'running' : next < job.endCursor ? 'waiting' : 'eof';
    return { jobId: id, status: job.status, readStart: cursor, nextCursor: next, retainedStartCursor: job.retainedStartCursor, bytes: Buffer.from(bytes), readState };
  }

  async jobCancel(id: string, reason: 'timeout' | 'cancelled'): Promise<JobRecord> {
    const job = this.jobs.get(id);
    const child = this.children.get(id);
    if (job && child && (reason !== 'timeout' || job.status === 'running')) {
      job.status = reason;
      if (child.pid) {
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* already exited */ }
      }
    }
    return { ...job! };
  }

  async publishJobEvidence(id: string, startCursor: number, endCursor: number) {
    const read = await this.jobRead(id, startCursor, endCursor - startCursor);
    if (read.readState === 'cursor_evicted' || read.gap) throw new Error(`incomplete transcript: missing ${read.gap?.from}-${read.gap?.to}`);
    if (read.nextCursor !== endCursor) throw new Error(`incomplete transcript: requested ${startCursor}-${endCursor}, available to ${read.nextCursor}`);
    const record = this.jobs.get(id)!;
    const ref = await this.artifacts.publishRange(this.runId, this.challengeId, read.bytes, startCursor, endCursor);
    return ref;
  }

  async openHttpSession(): Promise<string> {
    const id = `http_${randomId()}`;
    this.httpSessions.set(id, { closed: false, requests: [] });
    return id;
  }

  async httpRequest(sessionId: string, url: string, init?: RequestInit): Promise<{ status: number; body: Buffer; artifact: Awaited<ReturnType<ArtifactStore['publish']>> }> {
    const allowed = url === this.scope || url.startsWith(this.scope + '/');
    if (!allowed) throw new Error(`HTTP URL outside challenge scope: ${url}`);
    const session = this.httpSessions.get(sessionId);
    if (!session || session.closed) throw new Error('HTTP session closed');
    const response = await fetch(url, init);
    const body = Buffer.from(await response.arrayBuffer());
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
