// No-model check for tool image design §7 (docs/superpowers/specs/2026-11-21-design-v1-tool-image-and-architecture.md):
// a self-written sample project with a few public crates.io dependencies, never a challenge project.
// Its lockfile is generated once by the image's cargo in a networked throwaway container; everything after that is
// the launcher path: prefetchCrates, then ToolContainers (no network) + JobManager.run with the read-only mounts.
// Output: JSON with booleans, counts and timings only.
//
// Usage: npx tsx tests/manual/crate-prefetch-check.mts <image> <out-dir outside the repository>
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { JobManager, ToolContainers, type JobBinding } from '../../apps/launcher/src/job-tools.ts';
import { parseCargoLock, prefetchCrates, type PrefetchRecord } from '../../apps/launcher/src/crate-prefetch.ts';

const run = promisify(execFile);
const [image, outArg] = process.argv.slice(2);
if (!image || !outArg) throw new Error('usage: crate-prefetch-check.mts <image> <out-dir>');
const out = resolve(outArg);
if (out.startsWith(resolve('.'))) throw new Error('out-dir must be outside the repository');
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(out, 'run-'));
const uid = process.getuid!(), gid = process.getgid!();
const checks: Record<string, boolean> = {};
const results: Record<string, unknown> = { image };
const tag = `ctfcrate${Date.now().toString(36)}`;

// 1. Sample project and its lockfile (the only networked step; public crates only).
const project = join(root, 'sample');
mkdirSync(join(project, 'src'), { recursive: true });
writeFileSync(join(project, 'Cargo.toml'), '[package]\nname = "sample"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde_json = "1"\n');
writeFileSync(join(project, 'src', 'main.rs'), 'fn main() { println!("{}", serde_json::json!({"n": 6 * 7})); }\n');
const home = join(root, 'lock-home');
mkdirSync(home);
await run('docker', ['run', '--rm', '--user', `${uid}:${gid}`, '-e', `HOME=${home}`, '-v', `${root}:${root}`, '-w', project, image,
  'cargo', 'generate-lockfile'], { maxBuffer: 16 << 20 });
const lockText = readFileSync(join(project, 'Cargo.lock'), 'utf8');
const lock = parseCargoLock(lockText);
results.lockfile = { version: lock.version, packages: lock.packages.length, registry: lock.packages.filter(p => p.source).length };
checks.lockfile_v4 = lock.version === 4;

// 2. Materials: the project placed directly, the same project inside a zip, a tampered lockfile, and none.
const materials = (name: string) => { const d = join(root, 'materials', name); mkdirSync(d, { recursive: true }); return d; };
const direct = materials('direct');
cpSync(join(project, 'Cargo.toml'), join(direct, 'proj', 'Cargo.toml'));
cpSync(join(project, 'Cargo.lock'), join(direct, 'proj', 'Cargo.lock'));
cpSync(join(project, 'src'), join(direct, 'proj', 'src'), { recursive: true });
const zipped = materials('zipped');
await run('python3', ['-I', '-c', 'import sys, zipfile, os\nz = zipfile.ZipFile(sys.argv[1], "w")\nfor f in ("Cargo.toml", "Cargo.lock", "src/main.rs"): z.write(os.path.join(sys.argv[2], f), "attachment/proj/" + f)\nz.close()',
  join(zipped, 'attachment.zip'), project]);
const tampered = materials('tampered');
const firstSum = /checksum = "([0-9a-f]{64})"/.exec(lockText)![1]!;
writeFileSync(join(tampered, 'Cargo.lock'), lockText.replace(firstSum, firstSum.slice(0, -1) + (firstSum.endsWith('0') ? '1' : '0')));
const none = materials('none');
writeFileSync(join(none, 'notes.txt'), 'no lockfile here\n');

const cacheDir = join(root, 'crate-cache');
const prefetch = async (name: string, dir: string) => {
  const t = performance.now();
  const r = await prefetchCrates({ image, materials: [{ challenge: name, dir }], cacheDir, stateDir: join(root, 'state', name) });
  return { r, ms: Math.round(performance.now() - t) };
};
const summary = (x: { r: PrefetchRecord; ms: number }) => ({ result: x.r.result, reason: x.r.reason ?? null, lockfiles: x.r.lockfiles.map(l => ({ path: l.path, version: l.version })),
  crates: x.r.crates, downloaded: x.r.downloaded, cacheHits: x.r.cacheHits, bytes: x.r.bytes, skipped: x.r.skipped, mounts: x.r.mounts.length, ms: x.ms });

const pDirect = await prefetch('direct', direct);
const pZipped = await prefetch('zipped', zipped);
const pTampered = await prefetch('tampered', tampered);
const pNone = await prefetch('none', none);
results.prefetch = { direct: summary(pDirect), zipped: summary(pZipped), tampered: summary(pTampered), none: summary(pNone) };
const registry = lock.packages.filter(p => p.source).length;
checks.direct_ready = pDirect.r.result === 'ready' && pDirect.r.crates === registry && pDirect.r.downloaded === registry && pDirect.r.mounts.length === 2;
checks.zip_found_and_cached = pZipped.r.result === 'ready' && pZipped.r.lockfiles[0]?.path === 'attachment.zip!attachment/proj/Cargo.lock'
  && pZipped.r.downloaded === 0 && pZipped.r.cacheHits === registry;
checks.tampered_fails_without_mounts = pTampered.r.result === 'failed' && pTampered.r.reason === 'checksum mismatch' && pTampered.r.mounts.length === 0;
checks.no_lockfile_skips = pNone.r.result === 'skipped' && pNone.r.mounts.length === 0;

// 3. Jobs: the same project builds offline with the mounts (plain `cargo build`, no --offline) and not without them.
function session(name: string): JobBinding {
  const base = join(root, 'sessions', name);
  for (const d of ['work', 'materials', 'published']) mkdirSync(join(base, d), { recursive: true });
  cpSync(project, join(base, 'work', 'proj'), { recursive: true, filter: s => !s.includes('/target') });
  return { sessionId: name, challengeId: 'crate-check', workDir: join(base, 'work'), materialsDir: join(base, 'materials'), publishedDir: join(base, 'published') };
}
async function build(name: string, mounts: PrefetchRecord['mounts']) {
  const tool = new ToolContainers({ image, prefix: `${tag}-${name}`, mounts });
  const jobs = new JobManager({ jobsRoot: join(root, 'jobs', name), containers: tool });
  const b = session(name);
  try {
    const t = performance.now();
    const started = await jobs.run(b, { argv: ['/bin/sh', '-c', 'cd proj && cargo build --quiet && ./target/debug/sample'], timeout_ms: 300000, wait_ms: 0 });
    const done = await jobs.waitSettled(b, started.job);
    const page = jobs.read(b, { job: started.job, stream: 'stdout', cursor: '' });
    return { state: done.state, exitCode: done.exitCode, stdoutMatches: Buffer.from(page.data, 'base64').toString().trim() === '{"n":42}', ms: Math.round(performance.now() - t) };
  } finally { await tool.removeAll(); }
}
const withMounts = await build('mounted', pDirect.r.mounts);
const without = await build('plain', []);
results.build = { withMounts, withoutMounts: { state: without.state, exitCode: without.exitCode } };
checks.builds_offline_with_mounts = withMounts.state === 'exited' && withMounts.exitCode === 0 && withMounts.stdoutMatches;
checks.fails_without_mounts = without.exitCode !== 0;
const left = (await run('docker', ['ps', '-aq', '--filter', `name=${tag}`])).stdout.trim();
checks.no_containers_left = left === '';

const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
const report = { ...results, checks, passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, failed };
writeFileSync(join(out, 'crate-prefetch-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
