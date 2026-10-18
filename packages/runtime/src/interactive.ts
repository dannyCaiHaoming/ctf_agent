import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { EffectLevel } from '@ctf/contracts';
import { safeEnvironment } from '@ctf/policy';

export interface RuntimeOwner { sessionId: string; leaseId: string }
export interface RuntimeTaskLease extends RuntimeOwner { taskId: string; expiresAt: string }
export interface RuntimeTaskSnapshot extends RuntimeOwner { taskId: string }
export type BinaryData = { encoding: 'bytes'; data: Uint8Array } | { encoding: 'base64'; data: string };
export type JobMode = 'batch' | 'pty' | 'tcp_session';
export type ResourceStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'lost';
export interface TcpEndpoint { host: string; port: number }
export interface JobRecord {
  id: string; command: readonly string[]; cwd: string; timeoutMs: number; effect: EffectLevel;
  status: ResourceStatus; exitCode: number | null; retainedStartCursor: number; endCursor: number;
  mode: JobMode; taskId: string; error?: string; owner?: Readonly<RuntimeOwner>; endpoint?: Readonly<TcpEndpoint>; connected: boolean;
}
export interface ChannelRecord extends JobRecord { mode: 'tcp_session' }
export interface JobReadResult {
  jobId: string; status: ResourceStatus; readStart: number; nextCursor: number; retainedStartCursor: number;
  bytes: Buffer; encoding: 'bytes'; readState: 'running' | 'waiting' | 'eof' | 'lost' | 'cursor_evicted';
  gap?: { from: number; to: number };
}
export interface RuntimeTerminalEvent {
  resourceId: string; kind: 'job' | 'channel'; state: 'completed' | 'error' | 'cancelled' | 'lost'; record: Readonly<JobRecord>;
}
const text = z.string().min(1);
export const HardLimitDefinitionSchema = z.object({
  unit_definition: text, hard_limit: z.number().int().positive(), budget_scope: text,
  counting_point: text, reset_rule: text, authority_ref: text, managed_transport: text,
  retry_redirect_batch_policy: z.literal('disabled'), confirmation_condition: text, quarantine_scope: text
}).strict();
export type HardLimitDefinition = z.infer<typeof HardLimitDefinitionSchema>;
export const HardLimitCapabilitySchema = HardLimitDefinitionSchema.extend({
  status: z.literal('metering_unavailable'), reason: text
}).strict();
export type HardLimitCapability = Readonly<z.infer<typeof HardLimitCapabilitySchema>>;
export interface JobStartInput {
  taskId: string; command?: string[]; mode?: JobMode; endpoint?: TcpEndpoint; owner?: RuntimeOwner;
  cwd?: string; timeoutMs?: number; effect?: EffectLevel; maxRetainedBytes?: number;
  env?: Record<string, string>; hardLimit?: HardLimitDefinition | HardLimitCapability;
}
export interface ChannelOpenInput extends Omit<JobStartInput, 'mode' | 'command'> { endpoint: TcpEndpoint; owner: RuntimeOwner }
interface Resource {
  kind: 'job' | 'channel'; record: JobRecord; buffer: Buffer; maxRetained: number;
  child?: ChildProcess; socket?: Socket; timer?: ReturnType<typeof setTimeout>;
  closed: Promise<void>; resolveClosed: () => void; terminalEmitted: boolean;
}
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

// Embedded so tsc output remains self-contained. Node starts the bridge as a new
// session/process group. The command inherits that group and a real controlling
// terminal; killing the managed group also kills ordinary forked descendants.
const PTY_BRIDGE = String.raw`
import os, sys, select, subprocess, termios, fcntl, errno
master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
# Both directions must keep making progress when either PTY queue is full.
# Stop reading a producer at the bound; select writable readiness and retain
# every unwritten byte instead of blocking inside an entire-chunk write loop.
QUEUE_LIMIT = 65536
IO_CHUNK = 16384
for fd in (master, 0, 1): os.set_blocking(fd, False)
stdin_open = True
master_open = True
pending_input = bytearray()
pending_output = bytearray()
try:
    while master_open or pending_output:
        readers = ([master] if master_open and len(pending_output) < QUEUE_LIMIT else [])
        if stdin_open and master_open and len(pending_input) < QUEUE_LIMIT: readers.append(0)
        writers = ([master] if master_open and pending_input else [])
        if pending_output: writers.append(1)
        ready_read, ready_write, _ = select.select(readers, writers, [], 0.05)
        if master in ready_read:
            try: data = os.read(master, min(IO_CHUNK, QUEUE_LIMIT - len(pending_output)))
            except BlockingIOError: data = None
            except OSError as exc:
                if exc.errno != errno.EIO: raise
                data = b''
            if data: pending_output.extend(data)
            elif data == b'':
                master_open = False
                pending_input.clear()
        if 0 in ready_read:
            try: data = os.read(0, min(IO_CHUNK, QUEUE_LIMIT - len(pending_input)))
            except BlockingIOError: data = None
            if data: pending_input.extend(data)
            elif data == b'': stdin_open = False
        if master_open and master in ready_write:
            try: written = os.write(master, pending_input[:IO_CHUNK])
            except BlockingIOError: written = 0
            except OSError as exc:
                if exc.errno != errno.EIO: raise
                written = 0
                master_open = False
                pending_input.clear()
            if written: del pending_input[:written]
        if 1 in ready_write:
            try: written = os.write(1, pending_output[:IO_CHUNK])
            except BlockingIOError: written = 0
            if written: del pending_output[:written]
        if child.poll() is not None and not ready_read and not ready_write and not pending_output: break
finally:
    os.close(master)
code = child.wait()
sys.exit(code if code >= 0 else 128 - code)
`;

export class InteractiveRuntime {
  private readonly resources = new Map<string, Resource>();
  private readonly leases = new Map<string, RuntimeTaskLease>();
  private readonly terminalListeners = new Set<(event: RuntimeTerminalEvent) => void>();
  private disposed = false;
  constructor(private readonly workspacePath: (taskId: string) => string) {}

  // Host control API. Never expose registration/revocation as model tool arguments.
  registerTaskLease(input: RuntimeTaskLease): void {
    const lease = z.object({ taskId: text, sessionId: text, leaseId: text, expiresAt: z.string().datetime() }).strict().parse(input);
    if (Date.parse(lease.expiresAt) <= Date.now()) throw new Error('lease expired');
    const existing = this.leases.get(lease.sessionId);
    if (existing && (existing.taskId !== lease.taskId || existing.leaseId !== lease.leaseId)) throw new Error('session binding immutable');
    this.leases.set(lease.sessionId, Object.freeze({ ...lease }));
  }
  revokeTaskLease(owner: RuntimeOwner): void {
    this.activeLease(owner); this.leases.delete(owner.sessionId);
  }
  onTerminal(listener: (event: RuntimeTerminalEvent) => void): () => void {
    this.terminalListeners.add(listener); return () => { this.terminalListeners.delete(listener); };
  }
  meteringCapability(input: HardLimitDefinition): HardLimitCapability {
    return Object.freeze(HardLimitCapabilitySchema.parse({ ...HardLimitDefinitionSchema.parse(input), status: 'metering_unavailable',
      reason: 'host-dev has no enforceable framing/counting and no proven raw-endpoint egress isolation' }));
  }
  private activeLease(owner: RuntimeOwner, taskId?: string): RuntimeTaskLease {
    const lease = this.leases.get(owner.sessionId);
    if (!lease || lease.leaseId !== owner.leaseId || (taskId !== undefined && taskId !== lease.taskId)) throw new Error('owner/task lease mismatch');
    if (Date.parse(lease.expiresAt) <= Date.now()) throw new Error('lease expired');
    return lease;
  }
  private authorize(resource: Resource, owner?: RuntimeOwner): void {
    const bound = resource.record.owner;
    if (!bound) { if (owner) throw new Error('legacy job has no owner binding'); return; }
    if (!owner || bound.sessionId !== owner.sessionId || bound.leaseId !== owner.leaseId) throw new Error('owner/task lease mismatch');
    this.activeLease(owner, resource.record.taskId);
  }
  private snapshot(record: JobRecord): JobRecord {
    return Object.freeze({ ...record, command: Object.freeze([...record.command]),
      ...(record.owner ? { owner: Object.freeze({ ...record.owner }) } : {}),
      ...(record.endpoint ? { endpoint: Object.freeze({ ...record.endpoint }) } : {}) });
  }
  private get(id: string, kind: Resource['kind'], owner?: RuntimeOwner): Resource | undefined {
    const resource = this.resources.get(id);
    if (resource && resource.kind !== kind) throw new Error('resource kind mismatch');
    if (resource) this.authorize(resource, owner);
    else if (owner) this.activeLease(owner);
    return resource;
  }
  private append(resource: Resource, bytes: Buffer): void {
    const buffer = Buffer.concat([resource.buffer, bytes]);
    const remove = Math.max(0, buffer.length - resource.maxRetained);
    resource.buffer = Buffer.from(buffer.subarray(remove));
    resource.record.retainedStartCursor += remove; resource.record.endCursor += bytes.length;
  }
  private terminal(resource: Resource, status: ResourceStatus, exitCode: number | null = null, emit = true): void {
    if (resource.record.status === 'running') {
      resource.record.status = status; resource.record.exitCode = exitCode;
      resource.record.connected = false;
      if (resource.timer) clearTimeout(resource.timer);
    }
    if (!emit || resource.terminalEmitted) return;
    status = resource.record.status;
    resource.terminalEmitted = true;
    const state = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : status === 'lost' ? 'lost' : 'error';
    const event = Object.freeze({ resourceId: resource.record.id, kind: resource.kind, state, record: this.snapshot(resource.record) });
    for (const listener of this.terminalListeners) { try { listener(event); } catch { /* observer cannot alter cleanup */ } }
  }
  async start(input: JobStartInput, kind: Resource['kind'] = 'job'): Promise<JobRecord> {
    if (this.disposed) throw new Error('runtime disposed');
    if (this.resources.size >= 1000) throw new Error('runtime resource record limit');
    if (input.hardLimit !== undefined) {
      // No unavailable capability can be opted into by changing its status or URL.
      HardLimitDefinitionSchema.parse(Object.fromEntries(Object.entries(input.hardLimit).filter(([key]) => key !== 'status' && key !== 'reason')));
      throw new Error('metering_unavailable: hard-limit transport requires proven isolation and enforceable framing');
    }
    const mode = input.mode ?? 'batch';
    if (!['batch', 'pty', 'tcp_session'].includes(mode)) throw new Error('invalid job mode');
    if (mode !== 'batch' && !input.owner) throw new Error('interactive owner/task lease required');
    if (input.owner) this.activeLease(input.owner, input.taskId);
    else if ([...this.leases.values()].some(lease => lease.taskId === input.taskId)) throw new Error('owner/task lease required');
    const timeoutMs = positiveInteger(input.timeoutMs ?? 30000, MAX_LIFETIME_MS, 'timeoutMs');
    const maxRetained = positiveInteger(input.maxRetainedBytes ?? 1024 * 1024, MAX_BUFFER_BYTES, 'maxRetainedBytes');
    const command = input.command ? [...input.command] : [];
    if (mode !== 'tcp_session' && (!command.length || command.some(item => typeof item !== 'string' || item.includes('\0')) || !command[0])) throw new Error('command required');
    if (mode === 'pty' && process.platform === 'win32') throw new Error('PTY unavailable on win32');
    const endpoint = mode === 'tcp_session' ? z.object({ host: text, port: z.number().int().min(1).max(65535) }).strict().parse(input.endpoint) : undefined;
    const env = safeEnvironment(input.env);
    const workspace = this.workspacePath(input.taskId);
    const cwd = resolve(workspace, input.cwd ?? '.');
    if (cwd !== workspace && !cwd.startsWith(workspace + sep)) throw new Error('cwd outside workspace');
    const record: JobRecord = { id: `${kind === 'job' ? 'job' : 'channel'}_${randomBytes(12).toString('hex')}`, command, cwd, timeoutMs,
      effect: input.effect ?? (mode === 'tcp_session' ? 'protected_effect' : 'retryable_observation'), status: 'running', exitCode: null, retainedStartCursor: 0, endCursor: 0,
      mode, taskId: input.taskId, owner: input.owner ? { ...input.owner } : undefined, endpoint, connected: false };
    let resolveClosed!: () => void;
    const resource: Resource = { kind, record, buffer: Buffer.alloc(0), maxRetained, terminalEmitted: false,
      closed: new Promise<void>(resolve => { resolveClosed = resolve; }), resolveClosed: () => resolveClosed() };
    // Allocate identity and record before creating any process/connection.
    this.resources.set(record.id, resource);
    resource.timer = setTimeout(() => { void this.stop(resource, 'timeout'); }, timeoutMs);
    if (mode === 'tcp_session') {
      const socket = new Socket(); resource.socket = socket;
      socket.on('data', bytes => this.append(resource, bytes));
      socket.on('error', error => { record.error = error.message; this.terminal(resource, 'failed', null, false); });
      socket.on('close', () => { this.terminal(resource, 'completed', 0); resource.resolveClosed(); });
      await new Promise<void>(resolve => {
        const connected = () => { record.connected = true; finish(); };
        const finish = () => { socket.off('connect', connected); socket.off('close', finish); resolve(); };
        socket.once('connect', connected); socket.once('close', finish);
        socket.connect(endpoint!.port, endpoint!.host);
      });
    } else {
      const args = mode === 'pty' ? ['-u', '-c', PTY_BRIDGE, ...command] : command.slice(1);
      try {
        const child = spawn(mode === 'pty' ? 'python3' : command[0]!, args, { cwd, env,
          stdio: [mode === 'pty' ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        resource.child = child; record.connected = mode === 'pty';
        child.stdin?.on('error', error => { record.error = error.message; });
        child.stdout?.on('data', bytes => this.append(resource, bytes));
        child.stderr?.on('data', bytes => this.append(resource, bytes));
        // Keep the spawn-error handler: missing executables must never crash the host.
        child.on('error', error => { record.error = error.message; this.append(resource, Buffer.from(error.stack ?? error.message)); this.terminal(resource, 'failed', null, false); });
        child.on('exit', () => this.killGroup(child));
        child.on('close', (code, signal) => {
          this.killGroup(child); this.terminal(resource, signal ? 'failed' : code === 0 ? 'completed' : 'failed', code);
          resource.resolveClosed();
        });
      } catch (error) {
        this.append(resource, Buffer.from(String(error))); this.terminal(resource, 'failed'); resource.resolveClosed();
      }
    }
    return this.snapshot(record);
  }
  status(id: string, kind: Resource['kind'], owner?: RuntimeOwner): JobRecord | undefined {
    const resource = this.get(id, kind, owner); return resource ? this.snapshot(resource.record) : undefined;
  }
  list(snapshot: RuntimeTaskSnapshot): readonly JobRecord[] {
    this.activeLease(snapshot, snapshot.taskId);
    return Object.freeze([...this.resources.values()].filter(resource => resource.kind === 'job' && resource.record.taskId === snapshot.taskId &&
      resource.record.owner?.sessionId === snapshot.sessionId && resource.record.owner.leaseId === snapshot.leaseId).map(resource => this.snapshot(resource.record)));
  }
  transfer(id: string, kind: Resource['kind'], newTaskLease: RuntimeTaskLease, owner: RuntimeOwner): JobRecord {
    const resource = this.get(id, kind, owner); if (!resource) throw new Error('resource lost');
    if (!resource.record.owner) throw new Error('legacy job cannot transfer');
    const next = this.activeLease(newTaskLease, newTaskLease.taskId);
    if (next.expiresAt !== newTaskLease.expiresAt) throw new Error('task lease snapshot mismatch');
    resource.record.owner = { sessionId: next.sessionId, leaseId: next.leaseId }; resource.record.taskId = next.taskId;
    return this.snapshot(resource.record);
  }
  async read(id: string, cursor: number, maxBytes: number, kind: Resource['kind'], owner?: RuntimeOwner): Promise<JobReadResult> {
    nonnegativeInteger(cursor, 'cursor'); positiveInteger(maxBytes, MAX_BUFFER_BYTES, 'maxBytes');
    const resource = this.get(id, kind, owner);
    if (!resource || resource.record.status === 'lost') return { jobId: id, status: 'lost', readStart: cursor, nextCursor: cursor, retainedStartCursor: 0, bytes: Buffer.alloc(0), encoding: 'bytes', readState: 'lost' };
    const record = resource.record;
    if (record.owner && cursor > record.endCursor) throw new Error('cursor beyond stream end');
    if (cursor < record.retainedStartCursor) return { jobId: id, status: record.status, readStart: cursor, nextCursor: record.retainedStartCursor,
      retainedStartCursor: record.retainedStartCursor, bytes: Buffer.alloc(0), encoding: 'bytes', readState: 'cursor_evicted', gap: { from: cursor, to: record.retainedStartCursor } };
    const bytes = Buffer.from(resource.buffer.subarray(cursor - record.retainedStartCursor, cursor - record.retainedStartCursor + maxBytes));
    const nextCursor = cursor + bytes.length;
    return { jobId: id, status: record.status, readStart: cursor, nextCursor, retainedStartCursor: record.retainedStartCursor, bytes, encoding: 'bytes',
      readState: record.status === 'running' ? 'running' : nextCursor < record.endCursor ? 'waiting' : 'eof' };
  }
  async write(id: string, data: BinaryData, kind: Resource['kind'], owner: RuntimeOwner): Promise<{ bytesWritten: number; encoding: 'bytes' }> {
    const resource = this.get(id, kind, owner); if (!resource || resource.record.status !== 'running') throw new Error('resource not running or closed');
    const bytes = decode(data);
    const stream = resource.socket ?? (resource.record.mode === 'pty' ? resource.child?.stdin : undefined);
    if (!stream || !resource.record.connected) throw new Error('resource has no connected interactive input');
    // Single write, no automatic retry/reconnect. This is an ordinary unmetered stream.
    await new Promise<void>((resolve, reject) => stream.write(bytes, error => error ? reject(error) : resolve()));
    return { bytesWritten: bytes.length, encoding: 'bytes' };
  }
  private killGroup(child: ChildProcess): void {
    if (!child.pid) return;
    try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
  }
  private async stop(resource: Resource, status: 'timeout' | 'cancelled' | 'lost'): Promise<JobRecord> {
    if (resource.record.status === 'running') {
      this.terminal(resource, status, null, false);
      if (resource.child) this.killGroup(resource.child);
      if (resource.socket) resource.socket.destroy();
    }
    await resource.closed;
    return this.snapshot(resource.record);
  }
  async cancel(id: string, reason: 'timeout' | 'cancelled' | 'lost', kind: Resource['kind'], owner?: RuntimeOwner): Promise<JobRecord> {
    const resource = this.get(id, kind, owner); if (!resource) throw new Error('resource lost'); return this.stop(resource, reason);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.resources.values()].map(resource => this.stop(resource, 'cancelled')));
    this.terminalListeners.clear();
  }
}
function positiveInteger(value: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`invalid ${name}`); return value;
}
function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${name}`);
}
function decode(input: BinaryData): Buffer {
  let bytes: Buffer;
  if (input.encoding === 'bytes' && input.data instanceof Uint8Array) bytes = Buffer.from(input.data);
  else if (input.encoding === 'base64' && typeof input.data === 'string') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error('invalid base64');
    bytes = Buffer.from(input.data, 'base64'); if (bytes.toString('base64') !== input.data) throw new Error('invalid base64');
  } else throw new Error('explicit bytes/base64 encoding required');
  if (bytes.length > MAX_WRITE_BYTES) throw new Error('write byte limit'); return bytes;
}
