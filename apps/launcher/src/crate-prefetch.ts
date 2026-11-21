// Tool image design §7: before the run clock starts, fetch the crates.io packages a challenge's own Cargo.lock
// pins, check each against the lockfile checksum, and hand them to jobs as a read-only offline Cargo source.
// Untrusted archives and .crate files are only read inside a no-network tool container; the host downloads and hashes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const CRATES_MOUNT = '/opt/ctf-crates';
export const CARGO_CONFIG_MOUNT = '/.cargo/config.toml';
const CRATES_IO = 'registry+https://github.com/rust-lang/crates.io-index';
const LIMITS = { lockfiles: 16, lockfileBytes: 1 << 20, lockfileTotal: 8 << 20, crates: 2000, crateBytes: 64 << 20, totalBytes: 1 << 30 };

export interface LockPackage { name: string; version: string; source?: string; checksum?: string }
export interface Crate { name: string; version: string; checksum: string }
export interface Mount { source: string; target: string }
export interface Lockfile { challenge: string; path: string; content: string }

/** Minimal Cargo.lock reader: the lockfile version and each [[package]]'s name, version, source and checksum. */
export function parseCargoLock(text: string): { version: number | null; packages: LockPackage[] } {
  let version: number | null = null, current: Partial<LockPackage> | null = null, inArray = false;
  const packages: LockPackage[] = [];
  const close = () => { if (current?.name && current.version) packages.push(current as LockPackage); current = null; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inArray) { if (line.endsWith(']')) inArray = false; continue; }
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { close(); if (line === '[[package]]') current = {}; continue; }
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m as unknown as [string, string, string];
    if (value.startsWith('[') && !value.endsWith(']')) { inArray = true; continue; }
    const str = /^"((?:[^"\\]|\\.)*)"$/.exec(value)?.[1];
    if (!current) { if (key === 'version' && /^\d+$/.test(value)) version = Number(value); continue; }
    if (str !== undefined && (key === 'name' || key === 'version' || key === 'source' || key === 'checksum')) current[key] = str;
  }
  close();
  return { version: version ?? (packages.length ? 1 : null), packages };
}

/** crates.io packages with a checksum, deduplicated across lockfiles; everything else is only counted. */
export function selectRegistryCrates(packages: LockPackage[]) {
  const crates = new Map<string, Crate>();
  const skipped = { path: 0, git: 0, otherRegistry: 0, missingChecksum: 0 };
  for (const p of packages) {
    if (!p.source) { skipped.path++; continue; }
    if (p.source.startsWith('git+')) { skipped.git++; continue; }
    if (p.source !== CRATES_IO) { skipped.otherRegistry++; continue; }
    if (!p.checksum || !/^[0-9a-f]{64}$/.test(p.checksum)) { skipped.missingChecksum++; continue; }
    if (!/^[A-Za-z0-9_-]+$/.test(p.name) || !/^[0-9A-Za-z.+-]+$/.test(p.version)) throw new PrefetchFailed('lockfile');
    const key = `${p.name}@${p.version}`, seen = crates.get(key);
    if (seen && seen.checksum !== p.checksum) throw new PrefetchFailed('checksum conflict');
    crates.set(key, { name: p.name, version: p.version, checksum: p.checksum });
  }
  return { crates: [...crates.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version)), skipped };
}

export function cargoConfig(): string {
  return `[source.crates-io]\nreplace-with = "ctf-prefetched"\n\n[source.ctf-prefetched]\ndirectory = "${CRATES_MOUNT}"\n\n[net]\noffline = true\n`;
}

export class PrefetchFailed extends Error { constructor(readonly reason: string) { super(reason); } }

// Reads Cargo.lock files, direct or inside zip/tar archives, from read-only material mounts; prints JSON.
const FIND_SCRIPT = String.raw`
import base64, json, os, sys, tarfile, zipfile
N, ONE, TOTAL = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
out, total, skipped = [], 0, 0
def add(root, path, data):
    global total, skipped
    if len(out) >= N or len(data) > ONE or total + len(data) > TOTAL:
        skipped += 1; return
    total += len(data); out.append({'root': root, 'path': path, 'content': base64.b64encode(data).decode()})
for root in sys.argv[4:]:
    for d, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(d, f); rel = os.path.relpath(p, root)
            if os.path.islink(p): continue
            try:
                if f == 'Cargo.lock':
                    if os.path.getsize(p) <= ONE:
                        with open(p, 'rb') as h: add(root, rel, h.read())
                    else: skipped += 1
                elif zipfile.is_zipfile(p):
                    with zipfile.ZipFile(p) as z:
                        for i in z.infolist()[:100000]:
                            if not i.is_dir() and i.filename.split('/')[-1] == 'Cargo.lock':
                                if i.file_size <= ONE: add(root, rel + '!' + i.filename, z.read(i))
                                else: skipped += 1
                elif tarfile.is_tarfile(p):
                    with tarfile.open(p) as t:
                        for n, m in enumerate(t):
                            if n >= 100000: break
                            if m.isfile() and m.name.split('/')[-1] == 'Cargo.lock':
                                if m.size <= ONE: add(root, rel + '!' + m.name, t.extractfile(m).read())
                                else: skipped += 1
            except Exception:
                skipped += 1
print(json.dumps({'files': out, 'skipped': skipped}))
`;

// Unpacks checksum-verified .crate files into a Cargo directory source; refuses entries outside name-version/.
const EXTRACT_SCRIPT = String.raw`
import json, os, sys, tarfile
crates = json.load(sys.stdin)
for c in crates:
    top = c['name'] + '-' + c['version']
    with tarfile.open(os.path.join('/cache', c['checksum'] + '.crate'), 'r:gz') as t:
        members = t.getmembers()
        if any(m.name != top and not m.name.startswith(top + '/') for m in members):
            sys.exit('crate layout ' + top)
        t.extractall('/vendor', members=[m for m in members if m.isfile() or m.isdir()], filter='data')
    with open(os.path.join('/vendor', top, '.cargo-checksum.json'), 'w') as h:
        json.dump({'files': {}, 'package': c['checksum']}, h)
print(len(crates))
`;

export interface PrefetchOptions {
  image: string;
  materials: Array<{ challenge: string; dir: string }>;
  cacheDir: string;
  stateDir: string;
  fetch?: (url: string) => Promise<Uint8Array>;
  docker?: string;
  /** Test seam: replaces the container-side lockfile search. */
  find?: (image: string, materials: PrefetchOptions['materials']) => Promise<{ files: Lockfile[]; skipped: number }>;
}

export interface PrefetchRecord {
  result: 'ready' | 'skipped' | 'failed';
  reason?: string;
  lockfiles: Array<{ challenge: string; path: string; version: number | null }>;
  lockfilesSkipped: number;
  crates: number;
  downloaded: number;
  cacheHits: number;
  bytes: number;
  skipped: { path: number; git: number; otherRegistry: number; missingChecksum: number };
  durationMs: number;
  mounts: Mount[];
}

const run = promisify(execFile);
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function defaultFetch(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { 'user-agent': 'ctf-agent-launcher' }, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new PrefetchFailed('download');
  return new Uint8Array(await r.arrayBuffer());
}

export async function findLockfiles(image: string, materials: PrefetchOptions['materials'], docker = 'docker'): Promise<{ files: Lockfile[]; skipped: number }> {
  const mounts = materials.flatMap((m, i) => ['-v', `${m.dir}:/m/${i}:ro`]);
  const { stdout } = await run(docker, ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...mounts,
    image, 'python3', '-I', '-c', FIND_SCRIPT, String(LIMITS.lockfiles), String(LIMITS.lockfileBytes), String(LIMITS.lockfileTotal),
    ...materials.map((_, i) => `/m/${i}`)], { maxBuffer: LIMITS.lockfileTotal * 2 + (1 << 20) });
  const parsed = JSON.parse(stdout) as { files: Array<{ root: string; path: string; content: string }>; skipped: number };
  return { skipped: parsed.skipped, files: parsed.files.map(f => ({ challenge: materials[Number(f.root.slice(3))]!.challenge, path: f.path,
    content: Buffer.from(f.content, 'base64').toString('utf8') })) };
}

/** Never throws for an ordinary failure: the run continues without the mounts and the record says why. */
export async function prefetchCrates(options: PrefetchOptions): Promise<PrefetchRecord> {
  const started = Date.now(), docker = options.docker ?? 'docker', get = options.fetch ?? defaultFetch;
  const record: PrefetchRecord = { result: 'skipped', lockfiles: [], lockfilesSkipped: 0, crates: 0, downloaded: 0, cacheHits: 0, bytes: 0,
    skipped: { path: 0, git: 0, otherRegistry: 0, missingChecksum: 0 }, durationMs: 0, mounts: [] };
  const done = (result: PrefetchRecord['result'], reason?: string) => ({ ...record, result, ...(reason ? { reason } : {}), durationMs: Date.now() - started,
    ...(result === 'ready' ? {} : { mounts: [] }) });
  try {
    const found = await (options.find ?? ((i, m) => findLockfiles(i, m, docker)))(options.image, options.materials);
    record.lockfilesSkipped = found.skipped;
    if (!found.files.length) return done('skipped', 'no Cargo.lock in materials');
    const packages: LockPackage[] = [];
    for (const f of found.files) {
      const lock = parseCargoLock(f.content);
      record.lockfiles.push({ challenge: f.challenge, path: f.path, version: lock.version });
      packages.push(...lock.packages);
    }
    const { crates, skipped } = selectRegistryCrates(packages);
    record.skipped = skipped; record.crates = crates.length;
    if (!crates.length) return done('skipped', 'no crates.io packages');
    if (crates.length > LIMITS.crates) return done('failed', 'limit');
    await mkdir(options.cacheDir, { recursive: true });
    for (const c of crates) {
      const cached = join(options.cacheDir, `${c.checksum}.crate`);
      const existing = await readFile(cached).catch(() => undefined);
      let bytes: Uint8Array;
      if (existing && sha256(existing) === c.checksum) { bytes = existing; record.cacheHits++; }
      else {
        bytes = await get(`https://static.crates.io/crates/${c.name}/${c.name}-${c.version}.crate`);
        if (bytes.length > LIMITS.crateBytes) return done('failed', 'limit');
        if (sha256(bytes) !== c.checksum) return done('failed', 'checksum mismatch');
        const temp = `${cached}.${process.pid}.tmp`;
        await writeFile(temp, bytes); await rename(temp, cached);
        record.downloaded++;
      }
      record.bytes += bytes.length;
      if (record.bytes > LIMITS.totalBytes) return done('failed', 'limit');
    }
    const root = join(options.stateDir, 'crates'), vendor = join(root, 'vendor'), config = join(root, 'config.toml');
    await rm(root, { recursive: true, force: true }); await mkdir(vendor, { recursive: true });
    const uid = process.getuid?.(), gid = process.getgid?.();
    const child = execFile(docker, ['run', '--rm', '-i', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      ...(uid !== undefined && gid !== undefined ? ['--user', `${uid}:${gid}`] : []),
      '-v', `${options.cacheDir}:/cache:ro`, '-v', `${vendor}:/vendor`, options.image, 'python3', '-I', '-c', EXTRACT_SCRIPT]);
    const exited = new Promise<number | null>(r => child.on('close', r));
    child.stdin!.end(JSON.stringify(crates));
    if (await exited !== 0) { await rm(root, { recursive: true, force: true }); return done('failed', 'unpack'); }
    await writeFile(config, cargoConfig());
    record.mounts = [{ source: vendor, target: CRATES_MOUNT }, { source: config, target: CARGO_CONFIG_MOUNT }];
    return done('ready');
  } catch (cause) {
    return done('failed', cause instanceof PrefetchFailed ? cause.reason : 'error');
  }
}
