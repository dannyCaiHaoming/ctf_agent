import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';

describe('artifacts', () => {
  it('publishes content-addressed bytes and keeps immutable ranges stable', async () => {
    const store = new ArtifactStore(await mkdtemp(join(tmpdir(), 'artifacts-')));
    const first = await store.publish(Buffer.from('hello'));
    const range = await store.publishRange('run', 'challenge', Buffer.from('hello'), 10, 15);
    const second = await store.publish(Buffer.from('more'));
    expect(range.hash).toBe(first.hash);
    expect(range.startCursor).toBe(10);
    expect(range.endCursor).toBe(15);
    await expect(store.verify(second)).resolves.toBe(true);
    await expect(store.verify({ ...second, size: 99 })).rejects.toThrow(/size/);
  });

  it('fails closed on corrupted artifacts', async () => {
    const store = new ArtifactStore(await mkdtemp(join(tmpdir(), 'artifacts-')));
    const ref = await store.publish(Buffer.from('secure evidence'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(ref.path, Buffer.from('tampered-tamper'));
    await expect(store.verify(ref)).rejects.toThrow(/hash/);
  });
});
