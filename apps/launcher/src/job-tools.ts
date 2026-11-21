// Managed jobs (G design section 5), executed host-side or in a per-session tool container. argv runs directly with no shell, each job in its own process
// group, with a whitelisted environment and /dev/null on stdin. Every handle is checked against the caller's binding.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
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
/** Maximum JSON-encoded excerpt data per stream (excluding its surrounding quotes and metadata). */
const EXCERPT_DATA_BYTES = 2048;

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

interface Stream {
  path: string;
  fd: number;
  bytes: number;
  // Count the bytes accepted by the file write separately from the in-memory capture.
  storedBytes: number;
  droppedBytes: number;
  inputComplete: boolean;
  truncated: boolean;
  chunks: Buffer[];
}
interface Deferred { promise: Promise<void>; resolve: () => void }

/**
 * Optional per-session tool container (tool image design, section 4). When `container` yields a container for a
 * binding, the job runs there through `docker exec`; a small shell prologue starts it in a new session, so its process
 * group id is recorded inside the container and signals reach only that group. Paths are mounted at the same absolute
 * paths.
 */
export interface JobContainers {
  container(binding: JobBinding): Promise<string | undefined>;
  /** The image's fixed PATH (G design 5.3); the host PATH is never passed into the container. */
  path: string;
  docker?: string;
}

/** The tool image's fixed PATH (docker/tool-image/Dockerfile). */
export const TOOL_IMAGE_PATH = '/opt/ctf-venv/bin:/usr/local/bin:/usr/bin:/bin';
/** Machine-generated tool inventory inside the tool image. */
export const TOOL_INVENTORY_PATH = '/opt/ctf-tools/inventory.json';

/**
 * One container per solving session, created at its first job and reused until `removeAll` at the end of the run.
 * `--init` reaps orphans, so a cancelled group leaves no zombie members; materials and published are read-only.
 * Network defaults to none: job network scope is still open (G design 5.5).
 */
export class ToolContainers implements JobContainers {
  readonly path: string;
  readonly docker: string;
  private readonly started = new Map<string, Promise<string>>();
  constructor(private readonly options: { image: string; prefix: string; network?: string; user?: string; path?: string; docker?: string;
    /** Extra read-only mounts shared by every session container, e.g. prefetched crates (design §7). */
    mounts?: ReadonlyArray<{ source: string; target: string }> }) {
    this.path = options.path ?? TOOL_IMAGE_PATH;
    this.docker = options.docker ?? 'docker';
  }

  container(binding: JobBinding): Promise<string> {
    let started = this.started.get(binding.sessionId);
    if (!started) {
      started = this.start(binding);
      this.started.set(binding.sessionId, started);
      started.catch(() => this.started.delete(binding.sessionId));
    }
    return started;
  }

  async removeAll(): Promise<void> {
    const names = (await Promise.allSettled(this.started.values())).flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    this.started.clear();
    if (names.length) await new Promise<void>(resolve => execFile(this.docker, ['rm', '-f', ...names], () => resolve()));
  }

  private start(b: JobBinding): Promise<string> {
    const name = `${this.options.prefix}-${b.sessionId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120);
    const user = this.options.user ?? `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    const args = ['run', '-d', '--init', '--name', name, '--network', this.options.network ?? 'none', '--user', user,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', `${b.workDir}:${b.workDir}`,
      '-v', `${b.materialsDir}:${b.materialsDir}:ro`, '-v', `${b.publishedDir}:${b.publishedDir}:ro`,
      ...(this.options.mounts ?? []).flatMap(m => ['-v', `${m.source}:${m.target}:ro`]), this.options.image, 'sleep', 'infinity'];
    return new Promise((resolve, reject) => execFile(this.docker, args, error => error ? reject(new JobRefused('tool container')) : resolve(name)));
  }
}

// $0 is the job id; "$@" is argv. A missing program leaves a marker so the host reports failed_to_start, not the
// program's own exit 127. setsid makes the inner shell a group leader, so $$ is the group id to signal.
const CONTAINER_PROLOGUE = 'mkdir -p /tmp/ctf-jobs && { command -v -- "$1" >/dev/null 2>&1 || { : > "/tmp/ctf-jobs/$0.missing"; exit 127; }; } && ' +
  'exec /usr/bin/setsid -w /bin/sh -c \'echo $$ > "/tmp/ctf-jobs/$0" && exec "$@"\' "$0" "$@"';

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
  container?: string;
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly pathEnv: string;

  constructor(private readonly options: { jobsRoot: string; pathEnv?: string; containers?: JobContainers }) {
    this.pathEnv = options.pathEnv ?? process.env.PATH ?? '/usr/bin:/bin';
  }

  /** Starts a job; returns its handle, and its exit code if it ends within `wait_ms`. */
  async run(binding: JobBinding, args: Record<string, unknown>, operation?: { signal: AbortSignal; deadline: number; onRegistered: (id: string) => void }) {
    operation?.signal.throwIfAborted();
    const argv = checkArgv(args.argv);
    const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, 'timeout');
    const waitMs = boundedInt(args.wait_ms, DEFAULT_WAIT_MS, 0, MAX_WAIT_MS, 'wait');
    if (!isDirectory(binding.workDir)) throw new JobRefused('workdir');
    // Await the container before the capacity check, so the check and the registration below stay synchronous.
    const container = await this.options.containers?.container(binding);
    operation?.signal.throwIfAborted();
    this.assertCapacity(binding);

    const id = randomUUID();
    const dir = join(this.options.jobsRoot, binding.sessionId, id);
    mkdirSync(dir, { recursive: true });
    const stdout = openStream(join(dir, 'stdout.bin'));
    let stderr: Stream;
    try { stderr = openStream(join(dir, 'stderr.bin')); } catch (error) { closeStream(stdout); throw error; }
    let child: ChildProcess;
    try { child = container
      ? spawn(this.docker, ['exec', '-w', binding.workDir, container, '/usr/bin/env', '-i',
          ...Object.entries(this.childEnv(binding, this.options.containers!.path)).map(([k, v]) => `${k}=${v}`),
          '/bin/sh', '-c', CONTAINER_PROLOGUE, id, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      : spawn(argv[0]!, argv.slice(1), {
      cwd: binding.workDir,
      env: this.childEnv(binding),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    }); } catch (error) { closeStream(stdout); closeStream(stderr); throw error; }
    const job: Job = {
      id, sessionId: binding.sessionId, challengeId: binding.challengeId, state: 'running',
      exitCode: null, signal: null, child, reapIncomplete: false, settled: false, container,
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
    return job.state === 'running' ? snapshot(job) : terminalSnapshot(job);
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

  /** Fixed host-memory output from the real stream, never an editable work file. D prototype. */
  outputSnapshot(binding: JobBinding, handle: unknown, which: unknown) {
    const job=this.own(binding,handle);
    if(!job.settled || job.reapIncomplete) throw new JobRefused('job not settled');
    const stream=which==='stdout'?job.stdout:which==='stderr'?job.stderr:undefined;
    if(!stream) throw new JobRefused('stream');
    return {bytes:Buffer.concat(stream.chunks),complete:!stream.truncated && job.state==='exited',state:job.state};
  }

  /** Ends the job's process group and returns the final state once the job has settled. */
  async cancel(binding: JobBinding, handle: unknown) {
    const job = this.own(binding, handle);
    this.stop(job, 'cancelled');
    await job.done.promise;
    return snapshot(job);
  }

  async waitSettled(binding: JobBinding, handle: string) { const job = this.own(binding, handle); await job.done.promise; return terminalSnapshot(job); }

  /** Audit counters for closed streams, independent of the output snapshot or preview. */
  terminalStreams(binding: JobBinding, handle: string) {
    const job = this.own(binding, handle);
    if (!job.settled) return undefined;
    return { stdout: streamMetadata(job.stdout), stderr: streamMetadata(job.stderr) };
  }

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
  private childEnv(binding: JobBinding, path = this.pathEnv): Record<string, string> {
    return {
      PATH: path,
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
    if (job.container) return this.killContainerGroup(job, job.container);
    const pid = job.child.pid!;
    signalGroup(pid, 'SIGTERM');
    const escalate = setTimeout(() => signalGroup(pid, 'SIGKILL'), JOB_KILL_GRACE_MS);
    const gone = await waitFor(() => !groupAlive(pid), JOB_KILL_GRACE_MS + 1000);
    clearTimeout(escalate);
    job.reapIncomplete = !gone;
  }

  private get docker() { return this.options.containers?.docker ?? 'docker'; }

  /** Same escalation inside the container; the local `docker exec` client ending is not taken as the group ending. */
  private async killContainerGroup(job: Job, container: string) {
    const pidFile = `/tmp/ctf-jobs/${job.id}`;
    const inContainer = (script: string) => new Promise<number>(resolve => execFile(this.docker,
      ['exec', container, '/bin/sh', '-c', script], error => resolve(error ? Number((error as { code?: unknown }).code ?? 1) || 1 : 0)));
    const signal = (name: string) => inContainer(`[ -f ${pidFile} ] && kill -s ${name} -- -$(cat ${pidFile})`);
    // 0: a member is alive; 1: none; 2: the prologue has not recorded the group yet.
    const alive = async () => {
      const code = await inContainer(`[ -f ${pidFile} ] || exit 2; kill -0 -- -$(cat ${pidFile}) 2>/dev/null`);
      return code === 0 || (code === 2 && job.child.exitCode === null && job.child.signalCode === null);
    };
    await signal('TERM');
    const deadline = Date.now() + JOB_KILL_GRACE_MS + 1000;
    let escalated = false;
    while (await alive()) {
      if (Date.now() >= deadline) { job.reapIncomplete = true; break; }
      if (!escalated && Date.now() >= deadline - 1000) { escalated = true; await signal('KILL'); }
      await delay(100);
    }
    signalGroup(job.child.pid!, 'SIGTERM'); // the local client, once nothing it waits for remains
    if (job.state === 'exited' && job.exitCode === 127 && await inContainer(`[ -f ${pidFile}.missing ]`) === 0) {
      job.state = 'failed_to_start';
      job.exitCode = null;
    }
    await inContainer(`rm -f ${pidFile} ${pidFile}.missing`);
  }

  private async finish(job: Job) {
    await Promise.race([job.closed.promise, delay(500)]);
    clearTimeout(job.timer);
    if (job.abort) job.signalOwner?.removeEventListener('abort', job.abort);
    const failedToStart = job.state === 'failed_to_start';
    job.stdout.inputComplete = failedToStart || job.child.stdout!.readableEnded;
    job.stderr.inputComplete = failedToStart || job.child.stderr!.readableEnded;
    closeStream(job.stdout);
    closeStream(job.stderr);
    job.settled = true;
    job.done.resolve();
  }
}

function snapshot(job: Job) {
  return { job: job.id, state: job.state, exitCode: job.exitCode, signal: job.signal, reapIncomplete: job.reapIncomplete };
}

/** A quick look at captured bytes only; neither this preview nor a null cursor proves complete evidence. */
function terminalSnapshot(job: Job) {
  return { ...snapshot(job), excerpts: {
    stdout: streamExcerpt(job.stdout, 'stdout', job.settled),
    stderr: streamExcerpt(job.stderr, 'stderr', job.settled)
  } };
}

function streamExcerpt(stream: Stream, name: 'stdout' | 'stderr', settled: boolean) {
  // Copy only the bounded prefix from host memory, never an editable output file or the entire stream.
  const prefix = Buffer.concat(stream.chunks, Math.min(stream.bytes, EXCERPT_DATA_BYTES));
  let text: string | undefined;
  try {
    // Streaming decoding leaves a partial final codepoint for job.read instead of inventing a replacement.
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(prefix, { stream: prefix.length < stream.bytes });
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(decoded)) text = decoded;
  } catch { /* Invalid UTF-8 is returned byte-exactly as base64. */ }
  let encoding: 'utf8' | 'base64';
  let data: string;
  let length: number;
  if (text === undefined) {
    encoding = 'base64';
    const bytes = prefix.subarray(0, Math.floor(EXCERPT_DATA_BYTES / 4) * 3);
    data = bytes.toString('base64');
    length = bytes.length;
  } else {
    encoding = 'utf8';
    data = '';
    length = 0;
    let encodedBytes = 0;
    for (const character of text) {
      const cost = Buffer.byteLength(JSON.stringify(character)) - 2;
      if (encodedBytes + cost > EXCERPT_DATA_BYTES) break;
      data += character;
      length += Buffer.byteLength(character);
      encodedBytes += cost;
    }
  }
  return { stream: name, offset: 0, encoding, data, capturedLength: stream.bytes,
    previewOmitted: length < stream.bytes, truncated: stream.truncated,
    nextCursor: settled && length >= stream.bytes ? null : String(length) };
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
  return { path, fd: openSync(path, 'w'), bytes: 0, storedBytes: 0, droppedBytes: 0,
    inputComplete: false, truncated: false, chunks: [] };
}

function writeStream(stream: Stream, chunk: Buffer) {
  if (stream.fd < 0) return;
  const room = JOB_OUTPUT_LIMIT - stream.bytes;
  if (chunk.length > room) {
    stream.truncated = true;
    stream.droppedBytes += chunk.length - room;
  }
  const part = chunk.subarray(0, Math.min(room, chunk.length));
  if (part.length > 0) {
    stream.storedBytes += writeSync(stream.fd, part);
    stream.chunks.push(Buffer.from(part));
    stream.bytes += part.length;
  }
}

function streamMetadata(stream: Stream) {
  return {
    stored_bytes: stream.storedBytes,
    truncated: stream.truncated,
    ...(stream.inputComplete ? { dropped_bytes: stream.droppedBytes } : {})
  };
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
