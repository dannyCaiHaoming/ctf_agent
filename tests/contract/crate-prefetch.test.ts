import { createHash } from 'node:crypto';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargoConfig, CRATES_MOUNT, parseCargoLock, prefetchCrates, selectRegistryCrates } from '../../apps/launcher/src/crate-prefetch.js';
import { parseLaunchArgs } from '../../apps/launcher/src/launch.js';

// Tool image design §7: crates pinned by a challenge Cargo.lock, checked against the lockfile before any mount.
const IO = 'registry+https://github.com/rust-lang/crates.io-index';
const sum = (s: string) => createHash('sha256').update(s).digest('hex');
const lock = (version: number | null, body: string) => `# generated\n${version === null ? '' : `version = ${version}\n`}\n${body}`;
const pkg = (name: string, v: string, extra = '') => `[[package]]\nname = "${name}"\nversion = "${v}"\n${extra}\n`;

describe('Cargo.lock reading', () => {
  it('reads v4 packages and skips dependency arrays', () => {
    const text = lock(4, pkg('app', '0.1.0', 'dependencies = [\n "itoa",\n "serde 1.0.1",\n]') +
      pkg('itoa', '1.0.0', `source = "${IO}"\nchecksum = "${sum('itoa')}"`));
    const parsed = parseCargoLock(text);
    expect(parsed.version).toBe(4);
    expect(parsed.packages).toEqual([{ name: 'app', version: '0.1.0' }, { name: 'itoa', version: '1.0.0', source: IO, checksum: sum('itoa') }]);
  });

  it('treats a lockfile without a version line as v1 and an empty text as nothing', () => {
    expect(parseCargoLock(lock(null, pkg('a', '1.0.0'))).version).toBe(1);
    expect(parseCargoLock('')).toEqual({ version: null, packages: [] });
  });

  it('keeps only crates.io packages with a checksum and counts the rest', () => {
    const { crates, skipped } = selectRegistryCrates([
      { name: 'app', version: '0.1.0' },
      { name: 'g', version: '0.1.0', source: 'git+https://example.invalid/g#abc' },
      { name: 'o', version: '1.0.0', source: 'registry+https://example.invalid/index', checksum: sum('o') },
      { name: 'n', version: '1.0.0', source: IO },
      { name: 'b', version: '2.0.0', source: IO, checksum: sum('b') },
      { name: 'b', version: '2.0.0', source: IO, checksum: sum('b') },
    ]);
    expect(crates).toEqual([{ name: 'b', version: '2.0.0', checksum: sum('b') }]);
    expect(skipped).toEqual({ path: 1, git: 1, otherRegistry: 1, missingChecksum: 1 });
  });

  it('refuses one crate version with two checksums', () => {
    expect(() => selectRegistryCrates([{ name: 'b', version: '1.0.0', source: IO, checksum: sum('x') },
      { name: 'b', version: '1.0.0', source: IO, checksum: sum('y') }])).toThrow('checksum conflict');
  });

  it('points crates.io to the read-only mount and turns cargo offline', () => {
    expect(cargoConfig()).toContain(`directory = "${CRATES_MOUNT}"`);
    expect(cargoConfig()).toContain('replace-with = "ctf-prefetched"');
    expect(cargoConfig()).toContain('offline = true');
  });
});

describe('prefetch outcome', () => {
  const base = async () => ({ image: 'unused', materials: [{ challenge: 'X', dir: '/unused' }],
    cacheDir: await mkdtemp(join(tmpdir(), 'crate-cache-')), stateDir: await mkdtemp(join(tmpdir(), 'crate-state-')) });

  it('skips without mounts when the materials have no Cargo.lock', async () => {
    const r = await prefetchCrates({ ...await base(), find: async () => ({ files: [], skipped: 0 }), fetch: async () => { throw new Error('no fetch'); } });
    expect(r).toMatchObject({ result: 'skipped', reason: 'no Cargo.lock in materials', mounts: [] });
  });

  it('fails without mounts or cached bytes when a download does not match the lockfile checksum', async () => {
    const options = await base();
    const text = lock(4, pkg('itoa', '1.0.0', `source = "${IO}"\nchecksum = "${sum('expected')}"`));
    const fetched: string[] = [];
    const r = await prefetchCrates({ ...options, find: async () => ({ files: [{ challenge: 'X', path: 'a.zip!p/Cargo.lock', content: text }], skipped: 0 }),
      fetch: async url => { fetched.push(url); return new TextEncoder().encode('tampered'); } });
    expect(fetched).toEqual(['https://static.crates.io/crates/itoa/itoa-1.0.0.crate']);
    expect(r).toMatchObject({ result: 'failed', reason: 'checksum mismatch', crates: 1, downloaded: 0, mounts: [],
      lockfiles: [{ challenge: 'X', path: 'a.zip!p/Cargo.lock', version: 4 }] });
    expect(await readdir(options.cacheDir)).toEqual([]);
  });

  it('skips when the lockfile pins only path and git packages', async () => {
    const text = lock(4, pkg('app', '0.1.0') + pkg('g', '0.1.0', 'source = "git+https://example.invalid/g#abc"'));
    const r = await prefetchCrates({ ...await base(), find: async () => ({ files: [{ challenge: 'X', path: 'Cargo.lock', content: text }], skipped: 0 }) });
    expect(r).toMatchObject({ result: 'skipped', reason: 'no crates.io packages', skipped: { path: 1, git: 1 }, mounts: [] });
  });
});

it('parses --crate-cache', () => {
  expect(parseLaunchArgs(['--crate-cache', '/tmp/c']).crateCache).toBe('/tmp/c');
  expect(parseLaunchArgs([]).crateCache).toBeUndefined();
});
