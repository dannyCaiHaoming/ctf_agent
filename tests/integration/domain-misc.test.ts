import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ArtifactStore } from '@ctf/artifacts';
import { MiscMethod } from '../../packages/supervisor/src/domain-misc.js';
import { DomainCandidateRegistry } from '../../packages/supervisor/src/domain-candidates.js';
import { puzzleOracle } from '../../fixtures/challenges/misc/oracle.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(limits = { maxDepth: 3, maxProducts: 5, maxExpandedBytes: 1024 }) {
  const root = await mkdtemp(join(tmpdir(), 'domain-misc-')); roots.push(root);
  const store = new ArtifactStore(root);
  return { root, store, method: new MiscMethod(store, limits) };
}
async function publishedCount(root: string) {
  const folders = await readdir(root, { withFileTypes: true });
  const counts = await Promise.all(folders.filter(f => f.isDirectory() && f.name !== '.tmp').map(async f => (await readdir(join(root, f.name))).length));
  return counts.reduce((sum, n) => sum + n, 0);
}
function storedZip(name: string, data: Buffer): Buffer {
  const filename = Buffer.from(name, 'utf8'); const crc = testCrc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(0, 28);
  const localEntry = Buffer.concat([local, filename, data]);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42);
  const centralEntry = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralEntry.length, 12); end.writeUInt32LE(localEntry.length, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([localEntry, centralEntry, end]);
}
function testCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii'); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(testCrc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

describe('bounded file ingestion and benign transforms', () => {
  it('solves a real local base64/hex string puzzle, publishing consumed provenance and separate oracle acceptance', async () => {
    const { root, store, method } = await setup();
    const original = await method.ingest(await readFile(resolve('fixtures/challenges/misc/input.txt')), { source: 'input.txt', mediaType: 'text/plain' });
    expect(original.magic).toBe('text');
    expect(original.size).toBeGreaterThan(0);
    expect(original.metadata.source).toBe('input.txt');
    const initialCount = await publishedCount(root);
    const first = await method.transform(original.id, 'base64');
    expect(await publishedCount(root)).toBe(initialCount); // staged output is not published
    const final = await method.transform(first.id, 'hex'); // first output is now actually consumed
    expect(await publishedCount(root)).toBeGreaterThan(initialCount);
    const consumed = await method.consume(final.id);
    const provenance = JSON.parse((await store.read(consumed.provenanceRef)).toString());
    expect(provenance.recipe).toBe('hex');
    expect(provenance.parentRefs).toHaveLength(1);
    expect(provenance.validation).toBe('canonical roundtrip');
    await store.verify(provenance.parentRefs[0]);
    const registration = await new DomainCandidateRegistry(store).register({
      value: consumed.bytes.toString('utf8'), format: /^puzzle\{[a-z_]+\}$/, minBytes: 8, maxBytes: 64,
      evidenceRefs: [consumed.outputRef, consumed.provenanceRef]
    });
    expect(registration.status).toBe('candidate_only');
    expect(await puzzleOracle.submit(registration.value)).toMatchObject({ authoritative: true, status: 'accepted' });
  });

  it('rejects repeated content, repeated expansion, malformed encoding and bounded branches', async () => {
    const { method } = await setup({ maxDepth: 1, maxProducts: 1, maxExpandedBytes: 20 });
    const root = await method.ingest(Buffer.from('4142'), { source: 'hex.txt' });
    await expect(method.ingest(Buffer.from('4142'), { source: 'copy.txt' })).rejects.toThrow('duplicate content');
    const output = await method.transform(root.id, 'hex');
    await expect(method.transform(root.id, 'hex')).rejects.toThrow('already expanded');
    await expect(method.transform(output.id, 'base64')).rejects.toThrow('depth');
    const extra = await method.ingest(Buffer.from('Q0Q='), { source: 'extra.txt' });
    await expect(method.transform(extra.id, 'base64')).rejects.toThrow('product');
    const malformed = await setup();
    const bad = await malformed.method.ingest(Buffer.from('not base64!!'), { source: 'bad.txt' });
    await expect(malformed.method.transform(bad.id, 'base64')).rejects.toThrow('canonical');
    const bytes = await setup({ maxDepth: 3, maxProducts: 4, maxExpandedBytes: 1 });
    const two = await bytes.method.ingest(Buffer.from('4142'), { source: 'two.txt' });
    await expect(bytes.method.transform(two.id, 'hex')).rejects.toThrow('bytes');
  });

  it('records binary magic and refuses two routes that produce the same content', async () => {
    const { method } = await setup();
    const png = await method.ingest(Buffer.from('89504e470d0a1a0a0000', 'hex'), { source: 'image.bin' });
    expect(png.magic).toBe('png');
    expect(png.structure).toContain('PNG signature');
    const a = await method.ingest(Buffer.from('4142'), { source: 'hex.txt' });
    const b = await method.ingest(Buffer.from('QUI='), { source: 'base64.txt' });
    await method.transform(a.id, 'hex');
    await expect(method.transform(b.id, 'base64')).rejects.toThrow('duplicate content');
  });

  it('selects next-step hypotheses from retained evidence without transforming or publishing output', async () => {
    const { root, method } = await setup();
    const encoded = await method.ingest(Buffer.from('QUI='), { source: 'encoded.txt', mediaType: 'text/plain' });
    const before = await publishedCount(root);
    const hypotheses = method.hypothesize(encoded.id);
    expect(hypotheses).toMatchObject([{ category: 'encoding', hypothesis: 'decode canonical padded base64', status: 'supported', basis: 'canonical_roundtrip', details: { decodedBytes: 2 } }]);
    expect(hypotheses[0]!.evidenceRefs.map(ref => ref.hash)).toEqual([encoded.outputRef.hash, encoded.provenanceRef.hash]);
    expect(await publishedCount(root)).toBe(before);

    const compressed = await method.ingest(gzipSync(Buffer.from('next')), { source: 'next.gz' });
    expect(method.hypothesize(compressed.id)).toMatchObject([{ category: 'container', hypothesis: 'bounded gzip expansion', status: 'candidate', basis: 'signature' }]);
    const staged = await method.transform(encoded.id, 'base64');
    expect(() => method.hypothesize(staged.id)).toThrow('save or consume staged output');
  });

  it('publishes an explicitly saved output with immutable parent/recipe provenance', async () => {
    const { root, method, store } = await setup();
    const source = await method.ingest(Buffer.from('4142'), { source: 'saved-example.txt' });
    const before = await publishedCount(root);
    const staged = await method.transform(source.id, 'hex');
    expect(await publishedCount(root)).toBe(before);
    const saved = await method.save(staged.id);
    expect((await store.read(saved.outputRef)).toString()).toBe('AB');
    const receipt = JSON.parse((await store.read(saved.provenanceRef)).toString());
    expect(receipt).toMatchObject({ disposition: 'saved', recipe: 'hex', parentRefs: [source.outputRef] });
    expect(await method.save(staged.id)).toEqual(saved);
    expect(await publishedCount(root)).toBe(before + 2);
  });

  it('expands gzip only within the byte budget and records immutable container provenance', async () => {
    const { root, method, store } = await setup({ maxDepth: 2, maxProducts: 2, maxExpandedBytes: 128 });
    const sourceBytes = Buffer.from('puzzle{gzip_container}');
    const source = await method.ingest(gzipSync(sourceBytes), { source: 'payload.gz', mediaType: 'application/gzip' });
    expect(source.magic).toBe('gzip');
    const before = await publishedCount(root);
    const staged = await method.decompressGzip(source.id);
    expect(await publishedCount(root)).toBe(before); // transformed bytes stay staged until consumed/saved
    const result = await method.consume(staged.id);
    expect(await publishedCount(root)).toBe(before + 2);
    expect(result.bytes).toEqual(sourceBytes);
    const provenance = JSON.parse((await store.read(result.provenanceRef)).toString());
    expect(provenance).toMatchObject({ recipe: 'gzip', disposition: 'consumed', parameters: { container: 'gzip', integrity: 'zlib_crc_and_size' }, parentRefs: [source.outputRef] });

    const bounded = await setup({ maxDepth: 2, maxProducts: 2, maxExpandedBytes: 8 });
    const large = await bounded.method.ingest(gzipSync(Buffer.alloc(128, 65)), { source: 'large.gz' });
    await expect(bounded.method.decompressGzip(large.id)).rejects.toThrow(/gzip expansion failed or exceeded byte limit/);
  });

  it('lists and extracts only a selected bounded ZIP entry without writing archive paths', async () => {
    const { root, method, store } = await setup({ maxDepth: 2, maxProducts: 2, maxExpandedBytes: 64 });
    const content = Buffer.from('puzzle{zip_entry}');
    const archive = await method.ingest(storedZip('nested/result.txt', content), { source: 'bundle.zip' });
    expect(archive.magic).toBe('zip');
    expect(method.listZipEntries(archive.id)).toMatchObject([{ name: 'nested/result.txt', method: 0, uncompressedSize: content.length }]);
    const before = await publishedCount(root);
    const staged = await method.extractZipEntry(archive.id, 'nested/result.txt');
    expect(await publishedCount(root)).toBe(before);
    const result = await method.consume(staged.id);
    expect(result.bytes).toEqual(content);
    const receipt = JSON.parse((await store.read(result.provenanceRef)).toString());
    expect(receipt).toMatchObject({ recipe: 'zip_entry', disposition: 'consumed', parameters: { container: 'zip', entry: 'nested/result.txt', archivePathsWritten: false }, parentRefs: [archive.outputRef] });
    const traversal = await setup();
    const unsafe = await traversal.method.ingest(storedZip('../outside', content), { source: 'unsafe.zip' });
    expect(() => traversal.method.listZipEntries(unsafe.id)).toThrow('unsafe zip entry path');
    await expect(method.extractZipEntry(archive.id, 'missing')).rejects.toThrow('not found');
  });

  it('inspects PNG chunk integrity and classic PCAP packet boundaries without expanding payloads', async () => {
    const { method, store } = await setup();
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 6;
    const pngBytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', Buffer.from([1, 2])), pngChunk('IEND', Buffer.alloc(0))]);
    const png = await method.ingest(pngBytes, { source: 'image.png' });
    expect(png.structure).toContain('valid PNG');
    expect(JSON.parse((await store.read(png.provenanceRef)).toString()).structure).toContain('32x16');
    expect(method.inspectPng(png.id)).toMatchObject({ width: 32, height: 16, bitDepth: 8, colorType: 6,
      chunks: [{ type: 'IHDR', length: 13 }, { type: 'IDAT', length: 2 }, { type: 'IEND', length: 0 }] });
    const corrupt = Buffer.from(pngBytes); corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 1;
    const badPng = await method.ingest(corrupt, { source: 'corrupt.png' });
    expect(() => method.inspectPng(badPng.id)).toThrow('CRC mismatch');

    const pcapBytes = Buffer.alloc(24 + 16 + 4); Buffer.from('d4c3b2a1', 'hex').copy(pcapBytes, 0);
    pcapBytes.writeUInt16LE(2, 4); pcapBytes.writeUInt16LE(4, 6); pcapBytes.writeUInt32LE(64, 16); pcapBytes.writeUInt32LE(1, 20);
    pcapBytes.writeUInt32LE(123, 24); pcapBytes.writeUInt32LE(456, 28); pcapBytes.writeUInt32LE(4, 32); pcapBytes.writeUInt32LE(8, 36);
    pcapBytes.set(Buffer.from([0x45, 0, 0, 8]), 40);
    const pcap = await method.ingest(pcapBytes, { source: 'capture.pcap' });
    expect(pcap.magic).toBe('pcap');
    expect(method.inspectPcap(pcap.id)).toMatchObject({ endian: 'little', timestampPrecision: 'microseconds', snapLength: 64,
      linkType: 1, packets: [{ offset: 40, capturedLength: 4, originalLength: 8, timestampSeconds: 123, timestampFraction: 456 }] });
    pcapBytes.writeUInt32LE(1000, 32);
    const truncated = await method.ingest(pcapBytes, { source: 'truncated.pcap' });
    expect(() => method.inspectPcap(truncated.id)).toThrow('packet bounds');
  });
});
