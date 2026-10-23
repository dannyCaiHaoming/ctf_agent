// Managed jobs (G design section 5), executed host-side. argv runs directly with no shell, each job in its own process
// group, with a whitelisted environment and /dev/null on stdin. Every handle is checked against the caller's binding.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const JOB_TOOLS = ['job.run', 'job.read', 'job.cancel'];
/** Bytes per `job.read` page; well below the 262144-byte `tool_output.max_bytes` of product/opencode/opencode.json. */
export const JOB_PAGE_BYTES = 32768;
/** Stored bytes per output stream; anything past this is dropped and the stream is marked truncated. */
export const JOB_OUTPUT_LIMIT = 1048576;
/** Grace between SIGTERM and SIGKILL for a job's process group. */
export const JOB_KILL_GRACE_MS = 2000;
export const SESSION_JOB_LIMIT = 2;
export const CHALLENGE_JOB_LIMIT = 8;

const ARGV_MAX_ITEMS = 32;
const ARG_MAX_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_WAIT_MS = 5000;
const MAX_WAIT_MS = 30000;

export type JobState = 'running' | 'exited' | 'timed_out' | 'cancelled' | 'failed_to_start';

/** The caller's binding (C design section 3, G design section 2.2). A handle is valid only for the same session and challenge. */
export interface JobBinding {
  sessionId: string;
  challengeId: string;
  workDir: string;
  materialsDir: string;
  publishedDir: string;
}

/** Thrown for any refusal; the control service turns `code` into a fixed denial message. */
export class JobRefused extends Error { constructor(readonly code: string) { super(code); } }

interface Stream { path: string; fd: number; bytes: number; truncated: boolean }
interface Deferred { promise: Promise<void>; resolve: () => void }

interface Job {
  id: string;
  sessionId: string;
  challengeId: string;
  state: JobState;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Stream;
  stderr: Stream;
  child: ChildProcess;
  timer?: NodeJS.Timeout;
  reaping?: Promise<void>;
  reapIncomplete: boolean;
  settled: boolean;
  exited: Deferred;
  closed: Deferred;
  done: Deferred;
  abort?: () => void;
  signalOwner?: AbortSignal;
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly pathEnv: string;

  constructor(private readonly options: { jobsRoot: string; pathEnv?: string }) {
    this.pathEnv = options.pathEnv ?? process.env.PATH ?? '/usr/bin:/bin';
  }

  /** Starts a job; returns its handle, and its exit code if it ends within `wait_ms`. */
  async run(binding: JobBinding, args: Record<string, unknown>, operation?: { signal: AbortSignal; deadline: number; onRegistered: (id: string) => void }) {
    operation?.signal.throwIfAborted();
    const argv = checkArgv(args.argv);
    const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, 'timeout');
    const waitMs = boundedInt(args.wait_ms, DEFAULT_WAIT_MS, 0, MAX_WAIT_MS, 'wait');
    if (!isDirectory(binding.workDir)) throw new JobRefused('workdir');
    this.assertCapacity(binding);

    const id = randomUUID();
    const dir = join(this.options.jobsRoot, binding.sessionId, id);
    mkdirSync(dir, { recursive: true });
    const stdout = openStream(join(dir, 'stdout.bin'));
    let stderr: Stream;
    try { stderr = openStream(join(dir, 'stderr.bin')); } catch (error) { closeStream(stdout); throw error; }
    let child: ChildProcess;
    try { child = spawn(argv[0]!, argv.slice(1), {
      cwd: binding.workDir,
      env: this.childEnv(binding),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    }); } catch (error) { closeStream(stdout); closeStream(stderr); throw error; }
    const job: Job = {
      id, sessionId: binding.sessionId, challengeId: binding.challengeId, state: 'running',
      exitCode: null, signal: null, child, reapIncomplete: false, settled: false,
      stdout, stderr,
      exited: deferred(), closed: deferred(), done: deferred()
    };
    this.jobs.set(id, job);
    operation?.onRegistered(id);
    if (operation) {
      job.signalOwner = operation.signal; job.abort = () => this.stop(job, operation.signal.reason === 'deadline' ? 'timed_out' : 'cancelled');
      operation.signal.addEventListener('abort', job.abort, { once: true });
    }

    child.stdout!.on('data', (chunk: Buffer) => writeStream(job.stdout, chunk));
    child.stderr!.on('data', (chunk: Buffer) => writeStream(job.stderr, chunk));
    child.once('close', () => job.closed.resolve());
    child.once('error', () => {
      // No pid means the spawn itself failed (for example a missing program); there is no process group to end.
      if (child.pid !== undefined) return;
      job.state = 'failed_to_start';
      job.exited.resolve();
      void this.finish(job);
    });
    child.once('exit', (code, signal) => this.exit(job, code, signal));
    job.timer = setTimeout(() => this.stop(job, 'timed_out'), Math.min(timeoutMs, operation ? Math.max(0, operation.deadline - Date.now()) : timeoutMs));
    if (operation?.signal.aborted) this.stop(job, 'cancelled');

    await Promise.race([job.exited.promise, delay(waitMs)]);
    return snapshot(job);
  }

  /** One page of stdout or stderr, base64 so that concatenated pages are byte-exact. */
  read(binding: JobBinding, args: Record<string, unknown>) {
    const job = this.own(binding, args.job);
    const stream = args.stream === 'stdout' ? job.stdout : args.stream === 'stderr' ? job.stderr : undefined;
    if (!stream) throw new JobRefused('stream');
    const start = parseCursor(args.cursor, stream.bytes);
    const end = Math.min(start + JOB_PAGE_BYTES, stream.bytes);
    const done = job.settled && end >= stream.bytes;
    return {
      ...snapshot(job),
      stream: args.stream,
      encoding: 'base64' as const,
      data: readRange(stream.path, start, end - start).toString('base64'),
      offset: start,
      truncated: stream.truncated,
      nextCursor: done ? null : String(end),
      done
    };
  }

  /** Ends the job's process group and returns the final state once the job has settled. */
  async cancel(binding: JobBinding, handle: unknown) {
    const job = this.own(binding, handle);
    this.stop(job, 'cancelled');
    await job.done.promise;
    return snapshot(job);
  }

  async waitSettled(binding: JobBinding, handle: string) { const job = this.own(binding, handle); await job.done.promise; return snapshot(job); }

  async cancelAll(sessionId?: string): Promise<void> {
    const jobs = [...this.jobs.values()].filter(j => (!sessionId || j.sessionId === sessionId) && !j.settled);
    for (const job of jobs) this.stop(job, 'cancelled');
    await Promise.all(jobs.map(j => j.done.promise));
  }

  private own(binding: JobBinding, handle: unknown): Job {
    const job = typeof handle === 'string' ? this.jobs.get(handle) : undefined;
    if (!job || job.sessionId !== binding.sessionId || job.challengeId !== binding.challengeId) throw new JobRefused('job handle');
    return job;
  }

  private assertCapacity(binding: JobBinding) {
    const active = [...this.jobs.values()].filter(job => !job.settled || job.reapIncomplete);
    if (active.filter(job => job.sessionId === binding.sessionId).length >= SESSION_JOB_LIMIT) throw new JobRefused('session job limit');
    if (active.filter(job => job.challengeId === binding.challengeId).length >= CHALLENGE_JOB_LIMIT) throw new JobRefused('challenge job limit');
  }

  /** Whitelist only: no provider, RPC or platform credential is ever passed to a job. */
  private childEnv(binding: JobBinding): Record<string, string> {
    return {
      PATH: this.pathEnv,
      HOME: binding.workDir,
      TMPDIR: binding.workDir,
      LANG: 'C.UTF-8',
      CTF_WORK: binding.workDir,
      CTF_MATERIALS: binding.materialsDir,
      CTF_PUBLISHED: binding.publishedDir
    };
  }

  private exit(job: Job, code: number | null, signal: NodeJS.Signals | null) {
    job.exitCode = code;
    job.signal = signal;
    if (job.state === 'running') job.state = 'exited';
    job.exited.resolve();
    void this.reap(job);
  }

  private stop(job: Job, state: 'timed_out' | 'cancelled') {
    if (job.state !== 'running') return;
    job.state = state;
    void this.reap(job);
  }

  private reap(job: Job): Promise<void> {
    job.reaping ??= this.killGroup(job).then(() => this.finish(job));
    return job.reaping;
  }

  /** SIGTERM to the whole group, SIGKILL after the grace period, then wait until no member remains. */
  private async killGroup(job: Job) {
    const pid = job.child.pid!;
    signalGroup(pid, 'SIGTERM');
    const escalate = setTimeout(() => signalGroup(pid, 'SIGKILL'), JOB_KILL_GRACE_MS);
    const gone = await waitFor(() => !groupAlive(pid), JOB_KILL_GRACE_MS + 1000);
    clearTimeout(escalate);
    job.reapIncomplete = !gone;
  }

  private async finish(job: Job) {
    await Promise.race([job.closed.promise, delay(500)]);
    clearTimeout(job.timer);
    if (job.abort) job.signalOwner?.removeEventListener('abort', job.abort);
    closeStream(job.stdout);
    closeStream(job.stderr);
    job.settled = true;
    job.done.resolve();
  }
}

function snapshot(job: Job) {
  return { job: job.id, state: job.state, exitCode: job.exitCode, signal: job.signal, reapIncomplete: job.reapIncomplete };
}

/** Shape check only: 1–32 items, each a string of at most 4 KiB without `\0`. */
function checkArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ARGV_MAX_ITEMS) throw new JobRefused('argv');
  for (const item of value) {
    if (typeof item !== 'string' || item.includes('\0') || Buffer.byteLength(item) > ARG_MAX_BYTES) throw new JobRefused('argv');
  }
  return value as string[];
}

function boundedInt(value: unknown, fallback: number, min: number, max: number, code: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new JobRefused(code);
  return value;
}

function parseCursor(cursor: unknown, size: number): number {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  if (typeof cursor !== 'string' || !/^\d{1,15}$/.test(cursor)) throw new JobRefused('cursor');
  const offset = Number(cursor);
  if (offset > size) throw new JobRefused('cursor');
  return offset;
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(ready: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() >= deadline) return false;
    await delay(20);
  }
  return true;
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try { process.kill(-pid, signal); } catch { /* the group is already gone */ }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function openStream(path: string): Stream {
  return { path, fd: openSync(path, 'w'), bytes: 0, truncated: false };
}

function writeStream(stream: Stream, chunk: Buffer) {
  if (stream.fd < 0) return;
  const room = JOB_OUTPUT_LIMIT - stream.bytes;
  if (chunk.length > room) stream.truncated = true;
  const part = chunk.subarray(0, Math.min(room, chunk.length));
  if (part.length > 0) {
    writeSync(stream.fd, part);
    stream.bytes += part.length;
  }
}

function closeStream(stream: Stream) {
  if (stream.fd < 0) return;
  closeSync(stream.fd);
  stream.fd = -1;
}

function readRange(path: string, offset: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}
