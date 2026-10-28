import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool } from '@opencode-ai/plugin';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';
import {
  WorkspaceRefused, listWorkspace, readWorkspace, searchWorkspace, writeWorkspace
} from '../../apps/launcher/src/workspace-tools.js';

// One fixture tree per run: <base>/ws is the challenge root, <base>/outside holds a file the root must never reach.
let base: string;
let root: string;
let roots: import('../../apps/launcher/src/workspace-tools.js').WorkspaceRoots;
let outside: string;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const refusedWith = (code: string) => expect.objectContaining({ code });

beforeAll(async () => {
  base = realpathSync(await mkdtemp(join(tmpdir(), 'workspace-tools-')));
  root = join(base, 'ws');
  outside = join(base, 'outside');
  roots = { materialsDir: join(root,'materials'), workDir: join(root,'work'), publishedDir: join(root,'published') };
  for (const dir of ['materials', 'work', 'published']) await mkdir(join(root, dir), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'SECRET\n');
  await writeFile(join(root, 'materials', 'brief.txt'), 'hello 世界\n');
  await chmod(join(root, 'materials', 'brief.txt'), 0o444);
  await writeFile(join(root, 'published', 'p.txt'), 'published\n');
  await writeFile(join(root, 'work', 'real.txt'), 'real\n');
  await mkdir(join(root, 'work', 'sub'));
  await writeFile(join(root, 'work', 'sub', 'f.txt'), 'sub\n');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('workspace tools (G-V3)', () => {
  it('1 rejects `..`, `./x`, empty segments, absolute paths, backslashes, NUL, and a first segment that is not a root', async () => {
    const cases = ['../materials/brief.txt', 'materials/../brief.txt', './materials/brief.txt', 'materials//brief.txt',
      '/materials/brief.txt', 'materials\\brief.txt', 'materials/brief\0.txt', 'etc/passwd', 'brief.txt', 'work/', ''];
    for (const path of cases) {
      await expect(readWorkspace(roots, { path })).rejects.toBeInstanceOf(WorkspaceRefused);
      await expect(writeWorkspace(roots, { path, content: 'x' })).rejects.toBeInstanceOf(WorkspaceRefused);
    }
    await expect(readWorkspace(roots, { path: 'materials/brief.txt' })).resolves.toMatchObject({ text: 'hello 世界\n' });
  });

  it('2 rejects a symbolic link in the middle or at the end of a path, even when its target is inside the root', async () => {
    await symlink(join(root, 'work', 'real.txt'), join(root, 'work', 'link.txt'));
    await symlink(join(root, 'work', 'sub'), join(root, 'work', 'dirlink'));
    await expect(readWorkspace(roots, { path: 'work/link.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(roots, { path: 'work/dirlink/f.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(listWorkspace(roots, { path: 'work/dirlink' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(roots, { path: 'work/sub/f.txt' })).resolves.toMatchObject({ text: 'sub\n' });
  });

  it('3 rejects a symbolic link whose target lies outside the root, for reads, lists, and writes', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'work', 'escape.txt'));
    await symlink(outside, join(root, 'work', 'escape-dir'));
    await expect(readWorkspace(roots, { path: 'work/escape.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(roots, { path: 'work/escape-dir/secret.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(listWorkspace(roots, { path: 'work/escape-dir' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(roots, { path: 'work/escape.txt', content: 'changed' })).rejects.toBeInstanceOf(WorkspaceRefused);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('SECRET\n');
  });

  it('4 refuses writes to materials/ and published/ and leaves those files unchanged in content and sha256', async () => {
    await expect(writeWorkspace(roots, { path: 'work/ok.txt', content: 'ok' })).resolves.toMatchObject({ path: 'work/ok.txt', size: 2 });
    const materials = join(root, 'materials', 'brief.txt');
    const published = join(root, 'published', 'p.txt');
    const before = [sha(await readFile(materials)), sha(await readFile(published))];
    await expect(writeWorkspace(roots, { path: 'materials/brief.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(roots, { path: 'published/p.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(roots, { path: 'published/new.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
    expect([sha(await readFile(materials)), sha(await readFile(published))]).toEqual(before);
  });

  it('5 gives materials/ files mode 0444 in the fixture built here, without the intake run preparation', async () => {
    expect((await stat(join(root, 'materials', 'brief.txt'))).mode & 0o777).toBe(0o444);
  });

  it('6 pages reads without splitting a UTF-8 character, and a continuation cursor matches the intake rule', async () => {
    const text = 'a'.repeat(32767) + '界'.repeat(40000);
    await writeFile(join(root, 'work', 'pages.txt'), text);
    let cursor: string | undefined;
    let joined = '';
    let page;
    do {
      page = await readWorkspace(roots, { path: 'work/pages.txt', cursor }) as { text: string; nextCursor: string | null; done: boolean };
      expect(page.text).not.toContain('�');
      joined += page.text;
      cursor = page.nextCursor ?? undefined;
    } while (!page.done);
    expect(joined).toBe(text);
    // Byte 32768 is a continuation byte of the first `界`, so a cursor there must be refused.
    await expect(readWorkspace(roots, { path: 'work/pages.txt', cursor: '32768' })).rejects.toBeInstanceOf(WorkspaceRefused);
  });

  it('7 matches needles literally, so regular-expression metacharacters match only themselves', async () => {
    await writeFile(join(root, 'work', 'regex.txt'), 'a.b*(c\naxb*(c\naaa\n');
    const literal = await searchWorkspace(roots, { path: 'work/regex.txt', needle: 'a.b*(' });
    expect(literal.matches).toEqual([expect.objectContaining({ path: 'work/regex.txt', line: 1 })]);
    const metaOnly = await searchWorkspace(roots, { path: 'work/regex.txt', needle: '.*' });
    expect(metaOnly.matches).toEqual([]);
  });

  it('centers bounded snippets on late hits and reports Unicode character offsets', async () => {
    const lines = [
      '😀'.repeat(250) + 'TARGET' + '界'.repeat(250),
      'TARGET' + 'x'.repeat(300),
      'x'.repeat(300) + 'TARGET\r',
      'x'.repeat(250) + 'TARGET'.repeat(25) + 'x'.repeat(300)
    ];
    await writeFile(join(root, 'work', 'centered.txt'), lines.join('\n'));
    const result = await searchWorkspace(roots, { path: 'work/centered.txt', needle: 'TARGET' });
    expect(result).toMatchObject({ path: 'work/centered.txt', needle: 'TARGET', truncated: false });
    expect(result.matches).toHaveLength(4);
    for (const [index, offset] of [250, 0, 300, 250].entries()) {
      const match = result.matches[index]!;
      expect(match.snippet).toContain('TARGET');
      expect(match).toMatchObject({ line: index + 1, offset, needle: 'TARGET' });
      expect(Array.from(match.snippet)).toHaveLength(200);
      expect(match.snippet).not.toContain('�');
    }
    expect(result.matches[0]!.snippet).toBe('😀'.repeat(97) + 'TARGET' + '界'.repeat(97));
    expect(result.matches[1]!.snippet.startsWith('TARGET')).toBe(true);
    expect(result.matches[2]!.snippet.endsWith('TARGET')).toBe(true);
    const wide = await searchWorkspace(roots, { path: 'work/centered.txt', needle: 'TARGET'.repeat(25) });
    expect(wide.matches[0]!.snippet).toContain('TARGET'.repeat(25));
  });

  it('matches any literal needle and labels one hit per line in needle order', async () => {
    await writeFile(join(root, 'work', 'multi.txt'), 'alpha\nbeta\nbeta alpha\na.b*(\naxb*(\n');
    const result = await searchWorkspace(roots, { path: 'work/multi.txt', needles: ['alpha', 'beta', 'a.b*('] });
    expect(result).toMatchObject({ needles: ['alpha', 'beta', 'a.b*('], truncated: false });
    expect(result.matches).toEqual([
      { path: 'work/multi.txt', line: 1, snippet: 'alpha', offset: 0, needle: 'alpha' },
      { path: 'work/multi.txt', line: 2, snippet: 'beta', offset: 0, needle: 'beta' },
      { path: 'work/multi.txt', line: 3, snippet: 'beta alpha', offset: 5, needle: 'alpha' },
      { path: 'work/multi.txt', line: 4, snippet: 'a.b*(', offset: 0, needle: 'a.b*(' }
    ]);
    const both = await searchWorkspace(roots, { path: 'work/multi.txt', needle: 'missing', needles: ['beta'] });
    expect(both.matches.map(match => match.line)).toEqual([2, 3]);
  });

  it('rejects absent or empty needles and malformed multi-needle inputs', async () => {
    for (const args of [{}, { needle: '' }, { needles: [] }, { needles: [''] }, { needles: ['ok', 1] }, { needles: 'ok' }, { needles: null }]) {
      await expect(searchWorkspace(roots, args)).rejects.toBeInstanceOf(WorkspaceRefused);
    }
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control', controlToken: 'x'.repeat(40), tools: ['workspace.search'] });
    const schema = tool.schema.object(hooks.tool!['ctf_workspace_search']!.args);
    expect(schema.safeParse({ needle: 'ok' }).success).toBe(true);
    expect(schema.safeParse({ needle: '' }).success).toBe(false);
    expect(schema.safeParse({ needles: ['alpha', 'beta'] }).success).toBe(true);
    for (const needles of [[], [''], ['ok', 1], 'ok', null]) expect(schema.safeParse({ needles }).success).toBe(false);
  });

  it('keeps search match and output-byte limits with truthful truncation', async () => {
    await writeFile(join(root, 'work', 'match-limit.txt'), 'hit\n'.repeat(201));
    const capped = await searchWorkspace(roots, { path: 'work/match-limit.txt', needles: ['hit'] });
    expect(capped.matches).toHaveLength(200);
    expect(capped.truncated).toBe(true);
    await writeFile(join(root, 'work', 'match-limit.txt'), 'hit\n'.repeat(200));
    expect((await searchWorkspace(roots, { path: 'work/match-limit.txt', needle: 'hit' })).truncated).toBe(false);
    await writeFile(join(root, 'work', 'byte-limit.txt'), ('界'.repeat(250) + 'hit' + '界'.repeat(250) + '\n').repeat(200));
    const bytes = await searchWorkspace(roots, { path: 'work/byte-limit.txt', needles: ['hit'] });
    expect(bytes.truncated).toBe(true);
    expect(bytes.matches.length).toBeGreaterThan(0);
    expect(bytes.matches.length).toBeLessThan(200);
    expect(bytes.matches.every(match => match.snippet.includes('hit'))).toBe(true);
    const outputBytes = bytes.matches.reduce((sum, match) => sum + Buffer.byteLength(JSON.stringify(match)), 0);
    expect(outputBytes).toBeLessThanOrEqual(32768);
    expect(outputBytes + Buffer.byteLength(JSON.stringify(bytes.matches.at(-1)))).toBeGreaterThan(32768);
  });

  it('preserves root and path scopes, published snapshots, file skipping and symlink refusal', async () => {
    const needle = 'search-scope-marker';
    await mkdir(join(root, 'work', 'search-scope'));
    await writeFile(join(root, 'materials', 'search-scope.txt'), needle);
    await writeFile(join(root, 'published', 'search-scope.txt'), needle);
    await writeFile(join(root, 'work', 'search-scope', 'ok.txt'), needle);
    await writeFile(join(root, 'work', 'search-scope', 'binary.txt'), needle + '\0');
    await writeFile(join(root, 'work', 'search-scope', 'invalid.txt'), Buffer.concat([Buffer.from(needle), Buffer.from([255])]));
    await writeFile(join(root, 'work', 'search-scope', 'large.txt'), needle + 'x'.repeat(1024 * 1024));
    await writeFile(join(root, 'work', 'search-scope', 'boundary.txt'), needle + 'x'.repeat(1024 * 1024 - needle.length));
    await symlink(join(outside, 'secret.txt'), join(root, 'work', 'search-scope', 'link.txt'));
    const scoped = await searchWorkspace(roots, { path: 'work/search-scope', needles: [needle, 'SECRET'] });
    expect(scoped.matches.map(match => match.path)).toEqual(['work/search-scope/boundary.txt', 'work/search-scope/ok.txt']);
    expect(scoped.truncated).toBe(false);
    for (const path of ['materials', 'work', 'published', 'work/search-scope/ok.txt']) {
      const single = await searchWorkspace(roots, { path, needle });
      const multi = await searchWorkspace(roots, { path, needles: [needle] });
      expect(multi.matches).toEqual(single.matches);
      expect(multi.matches.length).toBeGreaterThan(0);
      expect(multi.matches.every(match => match.path.startsWith(path))).toBe(true);
    }
    const all = await searchWorkspace(roots, { needles: [needle] });
    expect(all.matches.map(match => match.path)).toEqual(['materials/search-scope.txt', 'published/search-scope.txt', 'work/search-scope/boundary.txt', 'work/search-scope/ok.txt']);
    const published = [{ path: 'published/snapshot.bin', bytes: Buffer.from(needle) }];
    for (const path of ['published', 'published/snapshot.bin']) {
      expect((await searchWorkspace(roots, { path, needles: [needle] }, published)).matches.map(match => match.path)).toEqual(['published/snapshot.bin']);
    }
    for (const path of ['.', '../outside', 'work/../materials', 'search-scope.txt', outside, 'work/search-scope/link.txt']) {
      await expect(searchWorkspace(roots, { path, needles: [needle] })).rejects.toBeInstanceOf(WorkspaceRefused);
    }
  });

  it('8 marks a list of more than 500 entries as truncated and returns exactly 500 of them', async () => {
    await mkdir(join(root, 'work', 'many'));
    await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(root, 'work', 'many', `f${String(i).padStart(3, '0')}.txt`), '')));
    const listed = await listWorkspace(roots, { path: 'work/many' });
    expect({ count: listed.entries.length, truncated: listed.truncated }).toEqual({ count: 500, truncated: true });
  });

  it('9 refuses a write over 1 MiB and leaves no file or temporary file behind', async () => {
    await expect(writeWorkspace(roots, { path: 'work/big.txt', content: 'a'.repeat(1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'content size' });
    expect((await readdir(join(root, 'work'))).filter(name => name.startsWith('big') || name.endsWith('.tmp'))).toEqual([]);
  });
});
