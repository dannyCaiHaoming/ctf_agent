import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Workspace, parseTarGzip, TAR_GZ_LIMITS } from '@ctf/runtime';

function tarEntry(name: string, content = Buffer.alloc(0), type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header, padded]);
}

function tarGz(...entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

it('unpacks a tar.gz into a source-bound task directory without overwriting on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tar-'));
  try {
    const workspace = new Workspace(root, 'task_solver');
    const bytes = tarGz(tarEntry('templates/login.html', Buffer.from('<h1>Login</h1>')));
    await writeFile(join(root, 'attachment.tar.gz'), bytes);
    const result = await workspace.unpackTarGz('attachment.tar.gz');
    expect(result.sourcePath).toBe('attachment.tar.gz');
    expect(result.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.members).toEqual([expect.objectContaining({ path: 'templates/login.html', type: 'file', size: 14 })]);
    expect(await readFile(join(root, result.destination, 'templates/login.html'), 'utf8')).toBe('<h1>Login</h1>');
    await expect(workspace.unpackTarGz('attachment.tar.gz')).rejects.toThrow(/EEXIST|already exists/i);
    expect(await readFile(join(root, result.destination, 'templates/login.html'), 'utf8')).toBe('<h1>Login</h1>');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects traversal and link members before creating derived files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tar-hostile-'));
  try {
    const workspace = new Workspace(root, 'task_solver');
    await writeFile(join(root, 'traversal.tar.gz'), tarGz(tarEntry('../escaped.txt', Buffer.from('outside'))));
    await expect(workspace.unpackTarGz('traversal.tar.gz')).rejects.toThrow(/archive path denied/);
    await expect(readFile(join(root, 'escaped.txt'))).rejects.toThrow();
    await expect(readFile(join(root, 'derived'))).rejects.toThrow();
    await writeFile(join(root, 'link.tar.gz'), tarGz(tarEntry('link', Buffer.alloc(0), '2')));
    await expect(workspace.unpackTarGz('link.tar.gz')).rejects.toThrow(/archive link denied/);
    await expect(readFile(join(root, 'derived'))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects source and destination symlinks that could escape the task workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tar-links-'));
  const outside = await mkdtemp(join(tmpdir(), 'workspace-tar-outside-'));
  try {
    const workspace = new Workspace(root, 'task_solver');
    const archive = tarGz(tarEntry('nested/file.txt', Buffer.from('safe')));
    const outsideArchive = join(outside, 'outside.tar.gz');
    await writeFile(outsideArchive, archive);
    await symlink(outsideArchive, join(root, 'source.tar.gz'));
    await expect(workspace.unpackTarGz('source.tar.gz')).rejects.toThrow(/regular workspace file/);
    await expect(readFile(join(outside, 'escaped.txt'))).rejects.toThrow();

    await writeFile(join(root, 'normal.tar.gz'), archive);
    await symlink(outside, join(root, 'derived'));
    await expect(workspace.unpackTarGz('normal.tar.gz')).rejects.toThrow(/destination denied/);
    await expect(readFile(join(outside, 'nested', 'file.txt'))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it('returns useful workspace diagnostics for directories and binary reads, and enforces member-size limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tar-diagnostics-'));
  try {
    const workspace = new Workspace(root, 'task_solver');
    await mkdir(join(root, 'folder'));
    await expect(workspace.read('folder')).rejects.toThrow(/use workspace\.list/);
    await expect(workspace.search('folder', 'needle')).rejects.toThrow(/use workspace\.list/);
    await writeFile(join(root, 'image.bin'), Buffer.from([0, 1, 2, 255]));
    expect(await workspace.readText('image.bin')).toMatchObject({ binary: true, size: 4, signature: '000102ff' });
    const oversized = tarGz(tarEntry('large.txt', Buffer.alloc(TAR_GZ_LIMITS.fileBytes + 1, 0x41)));
    expect(() => parseTarGzip(oversized)).toThrow(/archive limit: .* exceeds 1 MiB/);
    expect(() => parseTarGzip(gzipSync(Buffer.alloc(TAR_GZ_LIMITS.expandedBytes + 1)))).toThrow(/expanded tar exceeds 32 MiB/);
    const tooManyFiles = tarGz(...Array.from({ length: TAR_GZ_LIMITS.entries + 1 }, (_, i) =>
      tarEntry(`file-${i}.txt`, Buffer.from('x'))));
    expect(() => parseTarGzip(tooManyFiles)).toThrow(/more than 512 files/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
