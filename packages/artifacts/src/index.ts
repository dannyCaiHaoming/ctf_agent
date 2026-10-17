import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { ArtifactHashSchema, CursorSchema, type ImmutableRange } from '@ctf/contracts';

export interface ArtifactReference {
  hash: string;
  size: number;
  path: string;
}

export interface RangeArtifactReference extends ArtifactReference {
  startCursor: number;
  endCursor: number;
  immutableRange: ImmutableRange;
}

export class ArtifactStore {
  constructor(private readonly root: string) {}

  private hashBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private tempPath(): string {
    return join(this.root, '.tmp', randomUUID());
  }

  private async atomicWrite(hash: string, bytes: Uint8Array): Promise<string> {
    const path = join(this.root, hash.slice(0, 2), hash);
    await mkdir(dirname(path), { recursive: true });
    if (!(await exists(path))) {
      const temp = this.tempPath();
      await mkdir(dirname(temp), { recursive: true });
      await writeFile(temp, bytes);
      await rename(temp, path);
    }
    return path;
  }

  async publish(bytes: Uint8Array): Promise<ArtifactReference> {
    const hash = this.hashBytes(bytes);
    const path = await this.atomicWrite(hash, bytes);
    return { hash, size: bytes.length, path };
  }

  async publishRange(
    runId: string,
    challengeId: string,
    bytes: Uint8Array,
    startCursor: number,
    endCursor: number
  ): Promise<RangeArtifactReference> {
    if (endCursor < startCursor) throw new Error('invalid range');
    const parsedStart = CursorSchema.parse(startCursor);
    const parsedEnd = CursorSchema.parse(endCursor);
    const artifact = await this.publish(bytes);
    const immutableRange: ImmutableRange = {
      startCursor: parsedStart,
      endCursor: parsedEnd,
      complete: true,
      publishedAt: new Date().toISOString()
    };
    return { ...artifact, startCursor: parsedStart, endCursor: parsedEnd, immutableRange };
  }

  async verify(reference: ArtifactReference): Promise<true> {
    const bytes = await readFile(reference.path);
    if (bytes.length !== reference.size) throw new Error('artifact size mismatch');
    if (this.hashBytes(bytes) !== reference.hash) throw new Error('artifact hash mismatch');
    return true;
  }

  async read(reference: ArtifactReference): Promise<Buffer> {
    await this.verify(reference);
    return readFile(reference.path);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
