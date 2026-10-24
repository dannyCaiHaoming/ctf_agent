import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JOB_OUTPUT_LIMIT, JOB_PAGE_BYTES, JobManager, JobRefused, type JobBinding
} from '../../apps/launcher/src/job-tools.js';

// Criteria are G-V5 in docs/superpowers/plans/2026-10-23-g-solver-verification.md section 2.
const SENTINEL_NAME = 'CTF_PROBE_SENTINEL';
const SENTINEL_VALUE = 'probe-sentinel-7f3a9c';

let root: string;
let jobsRoot: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'job-tools-'));
  jobsRoot = join(root, 'jobs');
  process.env[SENTINEL_NAME] = SENTINEL_VALUE;
});

afterAll(() => {
  delete process.env[SENTINEL_NAME];
  rmSync(root, { recursive: true, force: true });
});

function binding(sessionId: string, challengeId = 'ch-x'): JobBinding {
  const base = join(root, challengeId);
  const workDir = join(base, sessionId, 'work');
  const materialsDir = join(base, 'materials');
  const publishedDir = join(base, 'published');
  for (const dir of [workDir, materialsDir, publishedDir]) mkdirSync(dir, { recursive: true });
  return { sessionId, challengeId, workDir, materialsDir, publishedDir };
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(ready: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await delay(20);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls until the process no longer exists (a reaped process is required; a zombie still counts as alive). */
async function waitGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await delay(20);
  }
  return true;
}

/** Reads a stream until its last page (`done`), returning the concatenated bytes and the final job snapshot. */
async function readAll(manager: JobManager, b: JobBinding, job: string, stream: 'stdout' | 'stderr') {
  const chunks: Buffer[] = [];
  const pageSizes: number[] = [];
  let cursor = '0';
  for (let i = 0; i < 10000; i++) {
    const page = manager.read(b, { job, stream, cursor });
    const bytes = Buffer.from(page.data, 'base64');
    if (bytes.length > 0) {
      chunks.push(bytes);
      pageSizes.push(bytes.length);
    }
    if (page.done) return { bytes: Buffer.concat(chunks), pageSizes, last: page };
    if (page.nextCursor !== null) cursor = page.nextCursor;
    if (bytes.length === 0) await delay(20);
  }
  throw new Error('stream did not finish');
}

describe('G-V5 managed jobs', () => {
  // 1. 環境白名單：哨兵變數不可見，白名單變數存在。
  it('passes only the whitelisted environment, never the sentinel', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-env');
    const started = await manager.run(b, { argv: ['env'], wait_ms: 5000 });
    expect(started.state).toBe('exited');
    const { bytes } = await readAll(manager, b, started.job, 'stdout');
    const text = bytes.toString('utf8');
    expect(text).not.toContain(SENTINEL_NAME);
    expect(text).not.toContain(SENTINEL_VALUE);
    expect(text).toMatch(/^PATH=/m);
    expect(text).toMatch(/^HOME=/m);
    expect(text).toMatch(/^TMPDIR=/m);
    expect(text).toMatch(/^CTF_WORK=/m);
  });

  // 2. stdin 接 /dev/null：cat 讀到 EOF 立即返回。
  it('connects stdin to /dev/null so cat returns at once', async () => {
    const manager = new JobManager({ jobsRoot });
    const started = await manager.run(binding('s-stdin'), { argv: ['cat'], wait_ms: 5000 });
    expect(started.state).toBe('exited');
    expect(started.exitCode).toBe(0);
  });

  // 3. 超時：整個程序組（含孫程序）在超時後結束。
  it('kills the grandchild with the process group on timeout', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-timeout');
    const started = await manager.run(b, {
      argv: ['sh', '-c', 'sleep 60 & echo $! > pidfile; wait'], timeout_ms: 1500, wait_ms: 0
    });
    expect(started.state).toBe('running');
    const pidfile = join(b.workDir, 'pidfile');
    await waitUntil(() => existsSync(pidfile));
    const pid = Number(readFileSync(pidfile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    const last = (await readAll(manager, b, started.job, 'stdout')).last;
    expect(last.state).toBe('timed_out');
    expect(last.reapIncomplete).toBe(false);
    expect(await waitGone(pid)).toBe(true);
  });

  // 4. 取消：job.cancel 後孫程序不存在，狀態為 cancelled。
  it('kills the grandchild with the process group on cancel', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-cancel');
    const started = await manager.run(b, {
      argv: ['sh', '-c', 'sleep 60 & echo $! > pidfile; wait'], timeout_ms: 60000, wait_ms: 0
    });
    const pidfile = join(b.workDir, 'pidfile');
    await waitUntil(() => existsSync(pidfile));
    const pid = Number(readFileSync(pidfile, 'utf8'));
    expect(alive(pid)).toBe(true);
    const cancelled = await manager.cancel(b, started.job);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.reapIncomplete).toBe(false);
    expect(await waitGone(pid)).toBe(true);
  });

  // 5. 續讀：超過 32 KiB 的輸出分頁讀完，拼接後與原輸出逐字節相等，最後一頁 done 為真。
  it('pages output by 32 KiB and reassembles it byte-exactly', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-page');
    const expected = Buffer.from(Array.from({ length: 100000 }, (_, i) => (i * 31) % 251));
    const started = await manager.run(b, {
      argv: [process.execPath, '-e', 'process.stdout.write(Buffer.from(Array.from({length:100000},(_,i)=>(i*31)%251)))'],
      wait_ms: 15000
    });
    expect(started.state).toBe('exited');
    const { bytes, pageSizes, last } = await readAll(manager, b, started.job, 'stdout');
    expect(pageSizes.length).toBeGreaterThan(1);
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(JOB_PAGE_BYTES);
    expect(bytes.equals(expected)).toBe(true);
    expect(last.done).toBe(true);
    expect(last.nextCursor).toBeNull();
    expect(last.truncated).toBe(false);
  });

  // 6. 輸出上限：超過 1 MiB 時標 truncated，保存字節數 ≤ 1 MiB（磁盤文件與續讀都核實）。
  it('caps stored output at 1 MiB and marks it truncated', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-cap');
    const started = await manager.run(b, {
      argv: [process.execPath, '-e', "process.stdout.write(Buffer.alloc(1572864, 97))"],
      wait_ms: 20000
    });
    const { bytes, last } = await readAll(manager, b, started.job, 'stdout');
    expect(last.truncated).toBe(true);
    expect(bytes.length).toBeLessThanOrEqual(JOB_OUTPUT_LIMIT);
    expect(bytes.length).toBe(JOB_OUTPUT_LIMIT);
    const onDisk = statSync(join(jobsRoot, b.sessionId, started.job, 'stdout.bin')).size;
    expect(onDisk).toBeLessThanOrEqual(JOB_OUTPUT_LIMIT);
  });

  // 7. 不存在的程序返回 failed_to_start。
  it('reports failed_to_start for a program that does not exist', async () => {
    const manager = new JobManager({ jobsRoot });
    const b = binding('s-missing');
    const started = await manager.run(b, { argv: ['ctf-probe-no-such-program'], wait_ms: 5000 });
    expect(started.state).toBe('failed_to_start');
    expect(started.exitCode).toBeNull();
  });

  // 8. 並行上限：同會話第三個被拒、另一會話仍可啟動；同題第九個被拒，另一題仍可啟動。
  it('enforces 2 jobs per session and 8 per challenge, without queueing', async () => {
    const manager = new JobManager({ jobsRoot });
    const running: Array<{ b: JobBinding; job: string }> = [];
    const start = async (b: JobBinding) => {
      const started = await manager.run(b, { argv: ['sleep', '30'], wait_ms: 0 });
      running.push({ b, job: started.job });
      return started;
    };
    try {
      const s1 = binding('cap-s1', 'cap-x');
      await start(s1);
      await start(s1);
      await expect(manager.run(s1, { argv: ['sleep', '30'], wait_ms: 0 })).rejects.toMatchObject({ code: 'session job limit' });

      const s2 = binding('cap-s2', 'cap-x');
      await start(s2);
      await start(s2);
      await start(binding('cap-s3', 'cap-x'));
      await start(binding('cap-s3', 'cap-x'));
      await start(binding('cap-s4', 'cap-x'));
      await start(binding('cap-s4', 'cap-x'));
      await expect(manager.run(binding('cap-s5', 'cap-x'), { argv: ['sleep', '30'], wait_ms: 0 }))
        .rejects.toMatchObject({ code: 'challenge job limit' });

      const other = await start(binding('cap-s6', 'cap-y'));
      expect(other.state).toBe('running');
    } finally {
      for (const { b, job } of running) await manager.cancel(b, job);
    }
  });

  // 9. 句柄隔離：另一會話或另一題讀取與取消均被拒，原會話仍可使用。
  it('refuses handles from another session or challenge', async () => {
    const manager = new JobManager({ jobsRoot });
    const owner = binding('h-owner', 'h-x');
    const started = await manager.run(owner, { argv: ['sleep', '30'], wait_ms: 0 });
    try {
      const intruder = binding('h-intruder', 'h-x');
      expect(() => manager.read(intruder, { job: started.job, stream: 'stdout' })).toThrow(JobRefused);
      await expect(manager.cancel(intruder, started.job)).rejects.toMatchObject({ code: 'job handle' });
      const otherChallenge = binding('h-owner', 'h-y');
      await expect(manager.cancel(otherChallenge, started.job)).rejects.toMatchObject({ code: 'job handle' });
      expect(manager.read(owner, { job: started.job, stream: 'stdout' }).state).toBe('running');
    } finally {
      await manager.cancel(owner, started.job);
    }
  });
});
