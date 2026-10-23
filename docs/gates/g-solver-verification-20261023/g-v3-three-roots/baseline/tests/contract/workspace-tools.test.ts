import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceRefused, listWorkspace, readWorkspace, searchWorkspace, writeWorkspace
} from '../../apps/launcher/src/workspace-tools.js';

// One fixture tree per run: <base>/ws is the challenge root, <base>/outside holds a file the root must never reach.
let base: string;
let root: string;
let outside: string;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const refusedWith = (code: string) => expect.objectContaining({ code });

beforeAll(async () => {
  base = realpathSync(await mkdtemp(join(tmpdir(), 'workspace-tools-')));
  root = join(base, 'ws');
  outside = join(base, 'outside');
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
      await expect(readWorkspace(root, { path })).rejects.toBeInstanceOf(WorkspaceRefused);
      await expect(writeWorkspace(root, { path, content: 'x' })).rejects.toBeInstanceOf(WorkspaceRefused);
    }
    await expect(readWorkspace(root, { path: 'materials/brief.txt' })).resolves.toMatchObject({ text: 'hello 世界\n' });
  });

  it('2 rejects a symbolic link in the middle or at the end of a path, even when its target is inside the root', async () => {
    await symlink(join(root, 'work', 'real.txt'), join(root, 'work', 'link.txt'));
    await symlink(join(root, 'work', 'sub'), join(root, 'work', 'dirlink'));
    await expect(readWorkspace(root, { path: 'work/link.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(root, { path: 'work/dirlink/f.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(listWorkspace(root, { path: 'work/dirlink' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(root, { path: 'work/sub/f.txt' })).resolves.toMatchObject({ text: 'sub\n' });
  });

  it('3 rejects a symbolic link whose target lies outside the root, for reads, lists, and writes', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'work', 'escape.txt'));
    await symlink(outside, join(root, 'work', 'escape-dir'));
    await expect(readWorkspace(root, { path: 'work/escape.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(readWorkspace(root, { path: 'work/escape-dir/secret.txt' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(listWorkspace(root, { path: 'work/escape-dir' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(root, { path: 'work/escape.txt', content: 'changed' })).rejects.toBeInstanceOf(WorkspaceRefused);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('SECRET\n');
  });

  it('4 refuses writes to materials/ and published/ and leaves those files unchanged in content and sha256', async () => {
    await expect(writeWorkspace(root, { path: 'work/ok.txt', content: 'ok' })).resolves.toMatchObject({ path: 'work/ok.txt', size: 2 });
    const materials = join(root, 'materials', 'brief.txt');
    const published = join(root, 'published', 'p.txt');
    const before = [sha(await readFile(materials)), sha(await readFile(published))];
    await expect(writeWorkspace(root, { path: 'materials/brief.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(root, { path: 'published/p.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
    await expect(writeWorkspace(root, { path: 'published/new.txt', content: 'tampered' })).rejects.toBeInstanceOf(WorkspaceRefused);
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
      page = await readWorkspace(root, { path: 'work/pages.txt', cursor }) as { text: string; nextCursor: string | null; done: boolean };
      expect(page.text).not.toContain('�');
      joined += page.text;
      cursor = page.nextCursor ?? undefined;
    } while (!page.done);
    expect(joined).toBe(text);
    // Byte 32768 is a continuation byte of the first `界`, so a cursor there must be refused.
    await expect(readWorkspace(root, { path: 'work/pages.txt', cursor: '32768' })).rejects.toBeInstanceOf(WorkspaceRefused);
  });

  it('7 matches needles literally, so regular-expression metacharacters match only themselves', async () => {
    await writeFile(join(root, 'work', 'regex.txt'), 'a.b*(c\naxb*(c\naaa\n');
    const literal = await searchWorkspace(root, { path: 'work/regex.txt', needle: 'a.b*(' });
    expect(literal.matches).toEqual([expect.objectContaining({ path: 'work/regex.txt', line: 1 })]);
    const metaOnly = await searchWorkspace(root, { path: 'work/regex.txt', needle: '.*' });
    expect(metaOnly.matches).toEqual([]);
  });

  it('8 marks a list of more than 500 entries as truncated and returns exactly 500 of them', async () => {
    await mkdir(join(root, 'work', 'many'));
    await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(root, 'work', 'many', `f${String(i).padStart(3, '0')}.txt`), '')));
    const listed = await listWorkspace(root, { path: 'work/many' });
    expect({ count: listed.entries.length, truncated: listed.truncated }).toEqual({ count: 500, truncated: true });
  });

  it('9 refuses a write over 1 MiB and leaves no file or temporary file behind', async () => {
    await expect(writeWorkspace(root, { path: 'work/big.txt', content: 'a'.repeat(1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'content size' });
    expect((await readdir(join(root, 'work'))).filter(name => name.startsWith('big') || name.endsWith('.tmp'))).toEqual([]);
  });
});
