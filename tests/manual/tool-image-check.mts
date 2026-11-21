// No-model checks for the tool image design (docs/superpowers/specs/2026-11-21-design-v1-tool-image-and-architecture.md),
// questions Q1-Q4. Every check goes through JobManager.run with per-session tool containers (no network, non-root).
// Only self-written harmless samples are used. Output: JSON with booleans, counts and timings, no tool output text.
//
// Usage: npx tsx tests/manual/tool-image-check.mts <image> <out-dir outside the repo>
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { JobManager, ToolContainers, TOOL_INVENTORY_PATH, type JobBinding } from '../../apps/launcher/src/job-tools.ts';
import { inspectToolImage } from '../../apps/launcher/src/launch.ts';

const run = promisify(execFile);
const [image, outArg] = process.argv.slice(2);
if (!image || !outArg) throw new Error('usage: tool-image-check.mts <image> <out-dir>');
const out = resolve(outArg);
if (out.startsWith(resolve('.'))) throw new Error('out-dir must be outside the repository');
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(out, 'run-'));
import { TOOL_IMAGE_PATH as IMAGE_PATH } from '../../apps/launcher/src/job-tools.ts';
const tag = `ctfchk${Date.now().toString(36)}`;
const uid = process.getuid!(), gid = process.getgid!();
const results: Record<string, unknown> = { image };
const checks: Record<string, boolean> = {};
const ms = (t: number) => Math.round(performance.now() - t);
const docker = async (...args: string[]) => (await run('docker', args, { maxBuffer: 64 << 20 })).stdout.trim();

function session(name: string): JobBinding {
  const base = join(root, name);
  for (const d of ['work', 'materials', 'published']) mkdirSync(join(base, d), { recursive: true });
  writeFileSync(join(base, 'materials', 'm.txt'), 'material\n');
  writeFileSync(join(base, 'published', 'p.txt'), 'published\n');
  return { sessionId: name, challengeId: 'tool-image-check', workDir: join(base, 'work'),
    materialsDir: join(base, 'materials'), publishedDir: join(base, 'published') };
}
const s1 = session('s1'), s2 = session('s2');
// The launcher's own container path: one container per session, created at its first job (--init, no network).
const tool = new ToolContainers({ image, prefix: tag });
const containers = new Map<string, string>();
async function startContainer(b: JobBinding) {
  const t = performance.now();
  containers.set(b.sessionId, await tool.container(b));
  return ms(t);
}

const jobs = new JobManager({ jobsRoot: join(root, 'jobs'), containers: tool });
const host = new JobManager({ jobsRoot: join(root, 'host-jobs') });

/** Only for settled jobs: a running job's cursor never becomes null. */
async function readAll(m: JobManager, b: JobBinding, job: string, stream: 'stdout' | 'stderr') {
  let cursor: string | null = '', data = Buffer.alloc(0);
  while (cursor !== null) {
    const page = m.read(b, { job, stream, cursor });
    data = Buffer.concat([data, Buffer.from(page.data, 'base64')]);
    cursor = page.nextCursor;
  }
  return data.toString('utf8');
}

async function job(b: JobBinding, argv: string[], timeout_ms = 120000, m: JobManager = jobs) {
  const t = performance.now();
  const started = await m.run(b, { argv, timeout_ms, wait_ms: 0 });
  const done = await m.waitSettled(b, started.job);
  return { ...done, ms: ms(t), stdout: await readAll(m, b, started.job, 'stdout'), stderr: await readAll(m, b, started.job, 'stderr'),
    streams: m.terminalStreams(b, started.job) };
}
const sh = (script: string) => ['/bin/sh', '-c', script];
const ok = (r: { state: string; exitCode: number | null }) => r.state === 'exited' && r.exitCode === 0;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function q1() {
  const w = s1.workDir;
  writeFileSync(join(w, 'hello.rs'), 'fn main() { let v: u64 = (1..=10).sum(); println!("rust {}", v); }\n');
  writeFileSync(join(w, 'hello.c'), '#include <stdio.h>\nint main(void){int s=0;for(int i=1;i<=10;i++)s+=i;printf("c %d\\n",s);return 0;}\n');
  writeFileSync(join(w, 'hello.go'), 'package main\nimport "fmt"\nfunc main(){s:=0;for i:=1;i<=10;i++{s+=i};fmt.Println("go",s)}\n');
  writeFileSync(join(w, 'hello.py'), 'print("python", sum(range(1, 11)))\n');
  const compile: Record<string, { ok: boolean; ms: number }> = {};
  const step = async (name: string, argv: string[], expect: string) => {
    const r = await job(s1, argv);
    compile[name] = { ok: ok(r) && r.stdout.includes(expect), ms: r.ms };
  };
  await step('rust', sh('rustc -O hello.rs -o hello_rs && ./hello_rs'), 'rust 55');
  await step('cargo_offline', sh('cargo new --vcs none --quiet crate1 && cd crate1 && cargo build --offline --quiet && ./target/debug/crate1'), 'Hello, world!');
  await step('c', sh('gcc -O2 hello.c -o hello_c && ./hello_c'), 'c 55');
  await step('go', sh('GOTOOLCHAIN=local go build -o hello_go hello.go && ./hello_go'), 'go 55');
  await step('python', ['python3', 'hello.py'], 'python 55');
  results.q1_compile = compile;

  // Every installed inventory entry is probed again through job.run, then a few functional checks per capability.
  const inv = JSON.parse((await job(s1, ['cat', '/opt/ctf-tools/inventory.json'])).stdout);
  const status: Record<string, number> = {};
  for (const t of inv.tools) status[t.status] = (status[t.status] ?? 0) + 1;
  results.q1_inventory = { arch: inv.arch, status };
  const functional: Record<string, boolean> = {};
  const f = async (name: string, script: string, expect: string) => {
    const r = await job(s1, sh(script));
    functional[name] = ok(r) && r.stdout.includes(expect);
  };
  await f('crypto_sympy_gmpy2_z3', `python3 -c "import sympy,gmpy2,z3; x=z3.Int('x'); s=z3.Solver(); s.add(x*3==21); s.check(); print(sympy.factorint(91), gmpy2.invert(3,7), s.model()[x])"`, '{7: 1, 13: 1} 5 7');
  await f('crypto_pycryptodome', `python3 -c "from Crypto.Hash import SHA256; print(SHA256.new(b'abc').hexdigest()[:8])"`, 'ba7816bf');
  await f('crypto_gp', `echo 'print(factor(91))' | gp -q`, '[7, 1; 13, 1]');
  await f('web_parse', `python3 -c "import bs4; print(bs4.BeautifulSoup('<a href=x>t</a>','lxml').a['href'])"`, 'x');
  await f('misc_image_metadata', `python3 -c "from PIL import Image; Image.new('RGB',(4,4)).save('i.png')" && exiftool -s -ImageWidth i.png && pngcheck i.png`, 'ImageWidth');
  await f('misc_archive', `echo data > a.txt && 7z a -bd -y a.7z a.txt >/dev/null && 7z l a.7z | grep -c a.txt`, '1');
  await f('misc_binwalk', `binwalk i.png | grep -ci png`, '1');
  await f('reverse_r2', `r2 -q -c 'aaa; afl~main' hello_c 2>/dev/null | grep -q main && echo found`, 'found');
  await f('reverse_checksec', `/usr/bin/checksec --file=hello_c --output=csv | grep -q hello_c && echo found`, 'found');
  await f('pwn_pwntools', `python3 -c "from pwn import ELF, context; context.log_level='error'; print(ELF('hello_c', checksec=False).arch)"`, 'aarch64');
  await f('mobile_apktool', `apktool --version`, '2.7');
  results.q1_functional = functional;
  checks.q1_compile_all = Object.values(compile).every(c => c.ok);
  checks.q1_functional_all = Object.values(functional).every(Boolean);
  checks.q1_no_missing = !status.missing;
}

async function q2() {
  const w = s1.workDir;
  writeFileSync(join(w, 'add.c'), '#include <stdio.h>\n#include <gnu/libc-version.h>\nint add(int a,int b){return a+b;}\n' +
    'int main(void){printf("%d %s\\n", add(2,3), gnu_get_libc_version());return 0;}\n');
  writeFileSync(join(w, 'loop.c'), '#include <stdio.h>\nint main(void){unsigned long s=0;for(unsigned long i=0;i<300000000UL;i++)s+=i^(i>>3);printf("%lu\\n",s);return 0;}\n');
  const build = await job(s1, sh('x86_64-linux-gnu-gcc -static -g -O0 add.c -o add64s && x86_64-linux-gnu-gcc -g -O0 add.c -o add64d && ' +
    'i686-linux-gnu-gcc -g -O0 add.c -o add32d && x86_64-linux-gnu-gcc -O1 loop.c -o loop64 && gcc -O1 loop.c -o loop_native && ' +
    'file add64s add64d add32d | grep -c "statically linked" && file add64d add32d | grep -c "dynamically linked"'));
  checks.q2_cross_build = ok(build) && build.stdout.split('\n')[0] === '1' && build.stdout.split('\n')[1] === '2';
  const libc = (await job(s1, sh('ls /usr/x86_64-linux-gnu/lib/libc.so.6 /usr/i686-linux-gnu/lib/libc.so.6 >/dev/null && echo yes'))).stdout.trim();
  const runs: Record<string, { ok: boolean; ms: number }> = {};
  for (const [name, argv] of [
    ['amd64_static', ['qemu-x86_64', './add64s']],
    ['amd64_dynamic', ['qemu-x86_64', '-L', '/usr/x86_64-linux-gnu', './add64d']],
    ['i386_dynamic', ['qemu-i386', '-L', '/usr/i686-linux-gnu', './add32d']],
  ] as const) {
    const r = await job(s1, [...argv]);
    runs[name] = { ok: ok(r) && r.stdout.startsWith('5 2.39'), ms: r.ms };
  }
  results.q2_run = runs;
  checks.q2_sysroot_present = libc === 'yes';
  checks.q2_run_all = Object.values(runs).every(r => r.ok);

  // Debugging: QEMU's gdb stub on one job, gdb-multiarch in a second job of the same session.
  const debug: Record<string, unknown> = {};
  for (const [name, qemu, sysroot, bin, gdbArch] of [
    ['amd64', 'qemu-x86_64', '/usr/x86_64-linux-gnu', 'add64d', 'i386:x86-64'],
    ['i386', 'qemu-i386', '/usr/i686-linux-gnu', 'add32d', 'i386'],
  ] as const) {
    const port = name === 'amd64' ? '12345' : '12346';
    const t = performance.now();
    const stub = await jobs.run(s1, { argv: [qemu, '-g', port, '-L', sysroot, `./${bin}`], timeout_ms: 60000, wait_ms: 0 });
    const g = await job(s1, ['gdb-multiarch', '-q', '-batch', '-ex', `set architecture ${gdbArch}`, '-ex', `set sysroot ${sysroot}`,
      '-ex', `file ${bin}`, '-ex', `target remote :${port}`, '-ex', 'break add', '-ex', 'continue',
      '-ex', 'print a', '-ex', 'print b', '-ex', 'next', '-ex', 'continue'], 60000);
    const stubDone = await jobs.waitSettled(s1, stub.job);
    debug[name] = { breakpoint_hit: /Breakpoint 1, add/.test(g.stdout), args_read: /\$1 = 2/.test(g.stdout) && /\$2 = 3/.test(g.stdout),
      program_exit_ok: stubDone.state === 'exited' && stubDone.exitCode === 0, ms: ms(t) };
  }
  results.q2_debug = debug;
  checks.q2_debug_all = Object.values(debug).every((d: any) => d.breakpoint_hit && d.args_read);

  const native = await job(s1, ['./loop_native']);
  const emulated = await job(s1, ['qemu-x86_64', '-L', '/usr/x86_64-linux-gnu', './loop64']);
  results.q4_cpu_loop = { native_ms: native.ms, qemu_amd64_ms: emulated.ms, same_result: native.stdout === emulated.stdout,
    ratio: Math.round(emulated.ms / native.ms * 10) / 10 };
}

async function groupOf(container: string, jobId: string) {
  return (await docker('exec', container, 'cat', `/tmp/ctf-jobs/${jobId}`)).trim();
}
async function groupMembers(container: string, pgid: string) {
  const ps = await docker('exec', container, 'ps', '-eo', 'pgid=,stat=');
  return ps.split('\n').map(l => l.trim().split(/\s+/)).filter(([g, st]) => g === pgid && !st?.startsWith('Z')).length;
}

async function q3() {
  const c1 = containers.get('s1')!;
  const env = await job(s1, ['/usr/bin/env']);
  const keys = env.stdout.trim().split('\n').map(l => l.split('=')[0]!).sort();
  const expected = ['CTF_MATERIALS', 'CTF_PUBLISHED', 'CTF_WORK', 'HOME', 'LANG', 'PATH', 'TMPDIR'];
  results.q3_env_extra_keys = keys.filter(k => !expected.includes(k));
  checks.q3_env_whitelist = expected.every(k => keys.includes(k)) && keys.every(k => expected.includes(k) || k === 'PWD');
  checks.q3_path_fixed = env.stdout.includes(`PATH=${IMAGE_PATH}\n`);
  checks.q3_cwd = (await job(s1, ['pwd'])).stdout.trim() === s1.workDir;
  checks.q3_non_root = (await job(s1, ['id', '-u'])).stdout.trim() !== '0';
  checks.q3_work_writable = ok(await job(s1, sh('echo ok > "$CTF_WORK/w.txt" && cat "$CTF_WORK/w.txt"')));
  checks.q3_materials_readonly = ok(await job(s1, sh('cat "$CTF_MATERIALS/m.txt"'))) && !ok(await job(s1, sh('echo x > "$CTF_MATERIALS/m.txt"')))
    && !ok(await job(s1, sh('rm -f "$CTF_MATERIALS/m.txt"')));
  checks.q3_published_readonly = ok(await job(s1, sh('cat "$CTF_PUBLISHED/p.txt"'))) && !ok(await job(s1, sh('echo x > "$CTF_PUBLISHED/p.txt"')));
  checks.q3_sessions_files_isolated = !ok(await job(s2, ['test', '-e', join(s1.workDir, 'w.txt')]))
    && !ok(await job(s2, ['test', '-e', s1.materialsDir]));
  const exit7 = await job(s1, sh('exit 7'));
  checks.q3_exit_code = exit7.state === 'exited' && exit7.exitCode === 7;
  const missing = await job(s1, ['no-such-program-xyz']);
  results.q3_missing_program = { state: missing.state, exitCode: missing.exitCode };
  checks.q3_missing_program_failed_to_start = missing.state === 'failed_to_start' && missing.exitCode === null;
  const own127 = await job(s1, sh('exit 127'));
  checks.q3_program_exit_127_kept = own127.state === 'exited' && own127.exitCode === 127;
  checks.q3_relative_program_runs = ok(await job(s1, ['./hello_c']));

  // Incremental output: the first line is readable while the job still runs.
  const inc = await jobs.run(s1, { argv: sh('echo first; sleep 3; echo second'), timeout_ms: 30000, wait_ms: 1500 });
  const earlyPage = jobs.read(s1, { job: inc.job, stream: 'stdout', cursor: '' });
  const early = Buffer.from(earlyPage.data, 'base64').toString('utf8');
  const incDone = await jobs.waitSettled(s1, inc.job);
  checks.q3_incremental_output = inc.state === 'running' && early.includes('first') && !early.includes('second') && ok(incDone);
  const big = await job(s1, sh('head -c 2097152 /dev/zero'));
  checks.q3_truncation_recorded = ok(big) && big.streams?.stdout.truncated === true;
  results.q3_truncation_streams = big.streams;

  // Cancel and timeout end only the target group; another job in the same container keeps running.
  const keep = await jobs.run(s1, { argv: sh('sleep 300 & sleep 300'), timeout_ms: 600000, wait_ms: 500 });
  const target = await jobs.run(s1, { argv: sh('sleep 300 & sleep 300'), timeout_ms: 600000, wait_ms: 500 });
  const keepGroup = await groupOf(c1, keep.job), targetGroup = await groupOf(c1, target.job);
  const before = await groupMembers(c1, targetGroup);
  const t = performance.now();
  const cancelled = await jobs.cancel(s1, target.job);
  const cancelMs = ms(t);
  const after = await groupMembers(c1, targetGroup);
  const keepAlive = await groupMembers(c1, keepGroup);
  checks.q3_sessions_processes_isolated = !(await job(s2, ['ps', '-eo', 'args='])).stdout.includes('sleep 300');
  // Session limit is 2, so the timeout case reuses the freed slot.
  const timed = await jobs.run(s1, { argv: sh('sleep 300 & sleep 300'), timeout_ms: 1500, wait_ms: 500 });
  const timedGroup = await groupOf(c1, timed.job);
  const timedDone = await jobs.waitSettled(s1, timed.job);
  const timedAfter = await groupMembers(c1, timedGroup);
  const keepAlive2 = await groupMembers(c1, keepGroup);
  await jobs.cancel(s1, keep.job);
  const keepAfter = await groupMembers(c1, keepGroup);
  const reuse = await job(s1, ['echo', 'again']);
  results.q3_cancel = { before, after, cancel_ms: cancelMs, state: cancelled.state, reapIncomplete: cancelled.reapIncomplete,
    keep_members_during: keepAlive, timeout_state: timedDone.state, timeout_after: timedAfter, keep_members_after_timeout: keepAlive2,
    keep_after_cancel: keepAfter };
  checks.q3_cancel_target_only = before >= 2 && after === 0 && cancelled.state === 'cancelled' && !cancelled.reapIncomplete && keepAlive >= 2;
  checks.q3_timeout_target_only = timedDone.state === 'timed_out' && timedAfter === 0 && keepAlive2 >= 2;
  checks.q3_container_reusable = keepAfter === 0 && ok(reuse) && reuse.stdout.trim() === 'again';
}

async function q4(coldMs: number[]) {
  const inspect = JSON.parse(await docker('image', 'inspect', image));
  const history = (await docker('history', '--no-trunc', '--format', '{{.Size}}\t{{.CreatedBy}}', image)).split('\n')
    .map(l => { const [size, by] = l.split('\t'); return { size, step: (by ?? '').replace(/\s+/g, ' ').slice(0, 90) }; })
    .filter(l => l.size !== '0B');
  const warm: number[] = [], hostWarm: number[] = [];
  for (let i = 0; i < 5; i++) warm.push((await job(s1, ['true'])).ms);
  for (let i = 0; i < 5; i++) hostWarm.push((await job(s1, ['true'], 120000, host)).ms);
  results.q4 = { image_bytes: inspect[0].Size, layers: history, cold_container_ms: coldMs,
    warm_job_ms_median: median(warm), host_job_ms_median: median(hostWarm) };
}

async function q4Service() {
  // An emulated amd64 service versus the same service natively, measured from the host.
  const out: Record<string, unknown> = {};
  for (const platform of ['linux/arm64', 'linux/amd64']) {
    const name = `${tag}-svc-${platform.split('/')[1]}`;
    const port = platform.endsWith('arm64') ? '18081' : '18082';
    const t = performance.now();
    await docker('run', '-d', '--name', name, '--platform', platform, '-p', `127.0.0.1:${port}:80`, 'busybox:1.37',
      'sh', '-c', 'mkdir -p /w && echo ok > /w/index.html && httpd -f -p 80 -h /w');
    let ready = -1;
    for (let i = 0; i < 300; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { ready = ms(t); break; } } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 50));
    }
    const lat: number[] = [];
    for (let i = 0; i < 20; i++) { const s = performance.now(); await (await fetch(`http://127.0.0.1:${port}/`)).text(); lat.push(performance.now() - s); }
    const arch = await docker('exec', name, 'uname', '-m');
    out[platform] = { uname: arch, ready_ms: ready, request_ms_median: Math.round(median(lat) * 10) / 10 };
    await docker('rm', '-f', name);
  }
  results.q4_service = out;
}

async function q5() {
  // No-model part of Q5: the launcher's evidence hash equals the inventory a job reads in the container.
  const evidence = await inspectToolImage(image);
  const read = await job(s1, ['cat', TOOL_INVENTORY_PATH]);
  checks.q5_inventory_hash_matches = ok(read) && createHash('sha256').update(read.stdout).digest('hex') === evidence.inventorySha256;
  checks.q5_evidence_uses_image_id = evidence.id.startsWith('sha256:');
}

try {
  const cold = [await startContainer(s1), await startContainer(s2)];
  await q1();
  await q2();
  await q3();
  await q4(cold);
  await q4Service();
  await q5();
  // End of run: the launcher cancels every job and removes every session container.
  await jobs.cancelAll();
  await tool.removeAll();
  const left = await docker('ps', '-aq', '--filter', `name=${tag}`);
  checks.q3_containers_removed_at_end = left === '';
} finally {
  await jobs.cancelAll();
  await tool.removeAll();
  for (const name of containers.values()) await docker('rm', '-f', name).catch(() => undefined);
}
results.checks = checks;
results.failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
writeFileSync(join(out, 'summary.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ checks: Object.keys(checks).length, failed: results.failed }));
