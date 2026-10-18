import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';

export interface MiscLimits { maxDepth: number; maxProducts: number; maxExpandedBytes: number; maxInputBytes?: number }
export interface MiscIngestion {
  id: string; hash: string; size: number; magic: string; structure: string;
  metadata: Record<string, string>; outputRef: ArtifactReference; provenanceRef: ArtifactReference;
}
export interface MiscHypothesis {
  category: 'container' | 'media' | 'traffic' | 'encoding' | 'unclassified';
  hypothesis: string;
  status: 'candidate' | 'supported' | 'inconclusive';
  basis: 'signature' | 'structural_validation' | 'canonical_roundtrip' | 'no_recognized_signal';
  evidenceRefs: readonly ArtifactReference[];
  details: Readonly<Record<string, string | number>>;
}
interface Node {
  id: string; bytes: Buffer; depth: number; parent?: string; entryName?: string; recipe: 'original' | 'base64' | 'hex' | 'gzip' | 'zip_entry';
  outputRef?: ArtifactReference; provenanceRef?: ArtifactReference;
}
export interface ZipEntryInfo { name: string; method: 0 | 8; flags: number; compressedSize: number; uncompressedSize: number; crc32: number; localHeaderOffset: number }
export interface PngStructure { width: number; height: number; bitDepth: number; colorType: number; chunks: Array<{ type: string; length: number }> }
export interface PcapStructure { endian: 'little' | 'big'; timestampPrecision: 'microseconds' | 'nanoseconds'; snapLength: number; linkType: number; packets: Array<{ offset: number; capturedLength: number; originalLength: number; timestampSeconds: number; timestampFraction: number }> }

/** In-memory bounded transform graph; published bytes/provenance use ArtifactStore immutability. */
export class MiscMethod {
  private readonly nodes = new Map<string, Node>();
  private readonly content = new Set<string>();
  private readonly expanded = new Set<string>();
  private products = 0;
  private expandedBytes = 0;
  private busy = false;
  private readonly limits: Readonly<Required<MiscLimits>>;

  constructor(private readonly artifacts: ArtifactStore, limits: MiscLimits) {
    const snapshot = { maxDepth: limits.maxDepth, maxProducts: limits.maxProducts, maxExpandedBytes: limits.maxExpandedBytes, maxInputBytes: limits.maxInputBytes ?? 1024 * 1024 };
    for (const value of Object.values(snapshot)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('positive integer transform limits required');
    }
    this.limits = Object.freeze(snapshot);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('transform graph busy; serialize mutations');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private node(id: string): Node {
    const node = this.nodes.get(id); if (!node) throw new Error('unknown transform node'); return node;
  }

  async ingest(bytes: Uint8Array, metadata: Record<string, string>): Promise<MiscIngestion> {
    return this.exclusive(async () => {
      if (bytes.length > this.limits.maxInputBytes) throw new Error('input bytes limit');
      if (!metadata.source) throw new Error('ingestion source metadata required');
      const buffer = Buffer.from(bytes); const hash = identity(buffer);
      const copiedMetadata = Object.freeze({ ...metadata });
      if (this.content.has(hash)) throw new Error('duplicate content');
      const magic = detectMagic(buffer);
      const outputRef = fixedReference(await this.artifacts.publish(buffer));
      const id = `misc_${hash}`;
      const node: Node = { id, bytes: buffer, depth: 0, recipe: 'original', outputRef };
      this.nodes.set(id, node);
      const structure = this.describeStructure(id, magic);
      const provenanceRef = fixedReference(await this.artifacts.publish(Buffer.from(JSON.stringify({ recipe: 'original', hash, size: buffer.length, magic, structure, metadata: copiedMetadata, outputRef }))));
      node.provenanceRef = provenanceRef;
      this.content.add(hash);
      return Object.freeze({ id, hash, size: buffer.length, magic, structure, metadata: Object.freeze({ ...copiedMetadata }), outputRef: fixedReference(outputRef), provenanceRef: fixedReference(provenanceRef) });
    });
  }

  private describeStructure(id: string, magic: string): string {
    const bytes = this.node(id).bytes;
    if (magic === 'text') return `text; ${bytes.toString('utf8').split('\n').length} line(s)`;
    if (magic === 'gzip') return `gzip signature; ${bytes.length} compressed byte(s); bounded expansion available`;
    if (magic === 'png') {
      try { const image = this.inspectPng(id); return `valid PNG; ${image.width}x${image.height}; ${image.chunks.length} CRC-checked chunk(s)`; }
      catch (error) { return `PNG signature; structural validation failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
    if (magic === 'pcap') {
      try { const capture = this.inspectPcap(id); return `valid classic PCAP; ${capture.packets.length} packet(s); link type ${capture.linkType}`; }
      catch (error) { return `PCAP signature; structural validation failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
    if (magic === 'zip') {
      try { const entries = this.listZipEntries(id); return `valid ZIP central directory; ${entries.length} entry/entries; ${entries.filter(entry => !entry.name.endsWith('/')).length} regular file(s)`; }
      catch (error) { return `ZIP signature; structural validation failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
    return `opaque ${magic}; parser not available`;
  }

  /**
   * Return evidence-backed next-step hypotheses without transforming or publishing bytes.
   * A signature is only a candidate; parsers and canonical decoding provide stronger support.
   */
  hypothesize(id: string): readonly MiscHypothesis[] {
    const node = this.node(id);
    if (!node.outputRef || !node.provenanceRef) throw new Error('save or consume staged output before evidence-backed hypothesis selection');
    const refs = Object.freeze([fixedReference(node.outputRef!), fixedReference(node.provenanceRef!)]);
    const hypotheses: MiscHypothesis[] = [];
    const add = (value: MiscHypothesis) => hypotheses.push(Object.freeze({ ...value, evidenceRefs: refs,
      details: Object.freeze({ ...value.details }) }));
    const magic = detectMagic(node.bytes);
    if (magic === 'gzip') add({ category: 'container', hypothesis: 'bounded gzip expansion', status: 'candidate', basis: 'signature', evidenceRefs: refs, details: { magic: '1f8b', inputBytes: node.bytes.length } });
    if (magic === 'zip') {
      try {
        const entries = this.listZipEntries(id);
        add({ category: 'container', hypothesis: 'inspect ZIP entries and select one regular file', status: 'supported', basis: 'structural_validation', evidenceRefs: refs, details: { entryCount: entries.length, regularFiles: entries.filter(entry => !entry.name.endsWith('/')).length } });
      } catch (error) {
        add({ category: 'container', hypothesis: 'inspect ZIP entries', status: 'inconclusive', basis: 'signature', evidenceRefs: refs, details: { reason: error instanceof Error ? error.message : String(error) } });
      }
    }
    if (magic === 'png') {
      try {
        const image = this.inspectPng(id);
        add({ category: 'media', hypothesis: 'inspect PNG chunks', status: 'supported', basis: 'structural_validation', evidenceRefs: refs, details: { width: image.width, height: image.height, chunkCount: image.chunks.length } });
      } catch (error) {
        add({ category: 'media', hypothesis: 'inspect PNG chunks', status: 'inconclusive', basis: 'signature', evidenceRefs: refs, details: { reason: error instanceof Error ? error.message : String(error) } });
      }
    }
    if (magic === 'pcap') {
      try {
        const capture = this.inspectPcap(id);
        add({ category: 'traffic', hypothesis: 'inspect classic PCAP packet records', status: 'supported', basis: 'structural_validation', evidenceRefs: refs, details: { packetCount: capture.packets.length, linkType: capture.linkType } });
      } catch (error) {
        add({ category: 'traffic', hypothesis: 'inspect classic PCAP packet records', status: 'inconclusive', basis: 'signature', evidenceRefs: refs, details: { reason: error instanceof Error ? error.message : String(error) } });
      }
    }
    if (magic === 'text') {
      const text = node.bytes.toString('utf8').trim();
      if (isCanonicalHex(text)) add({ category: 'encoding', hypothesis: 'decode canonical even-length hex', status: 'supported', basis: 'canonical_roundtrip', evidenceRefs: refs, details: { encodedCharacters: text.length, decodedBytes: text.length / 2 } });
      if (isCanonicalBase64(text)) add({ category: 'encoding', hypothesis: 'decode canonical padded base64', status: 'supported', basis: 'canonical_roundtrip', evidenceRefs: refs, details: { encodedCharacters: text.length, decodedBytes: Buffer.from(text, 'base64').length } });
    }
    if (hypotheses.length === 0) add({ category: 'unclassified', hypothesis: 'inspect bytes with a task-specific method', status: 'inconclusive', basis: 'no_recognized_signal', evidenceRefs: refs, details: { magic, size: node.bytes.length } });
    return Object.freeze(hypotheses);
  }

  async transform(parentId: string, recipe: 'base64' | 'hex'): Promise<{ id: string; size: number; depth: number }> {
    return this.exclusive(async () => {
      const parent = this.node(parentId);
      if (parent.depth + 1 > this.limits.maxDepth) throw new Error('transform depth limit');
      const key = `${parentId}:${recipe}`;
      if (this.expanded.has(key)) throw new Error('content already expanded with recipe');
      if (this.products >= this.limits.maxProducts) throw new Error('transform product limit');
      // A staged parent's bytes are really consumed by this transform, so publish its provenance now.
      await this.publish(parent, 'consumed');
      const text = parent.bytes.toString('utf8').trim();
      let bytes: Buffer;
      if (recipe === 'hex') {
        if (!/^(?:[0-9a-fA-F]{2})+$/.test(text)) throw new Error('hex must be canonical even-length text');
        bytes = Buffer.from(text, 'hex');
        if (bytes.toString('hex') !== text.toLowerCase()) throw new Error('hex canonical roundtrip failed');
      } else if (recipe === 'base64') {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) || !text.length) throw new Error('base64 must be canonical padded text');
        bytes = Buffer.from(text, 'base64');
        if (bytes.toString('base64') !== text) throw new Error('base64 canonical roundtrip failed');
      } else throw new Error('unsupported transform capability');
      if (this.expandedBytes + bytes.length > this.limits.maxExpandedBytes) throw new Error('expanded bytes limit');
      const hash = identity(bytes);
      if (this.content.has(hash)) throw new Error('duplicate content');
      const node: Node = { id: `misc_${hash}`, bytes, parent: parentId, depth: parent.depth + 1, recipe };
      this.nodes.set(node.id, node); this.content.add(hash); this.expanded.add(key);
      this.products++; this.expandedBytes += bytes.length;
      return Object.freeze({ id: node.id, size: bytes.length, depth: node.depth });
    });
  }

  /** Bounded gzip container expansion; decompressed bytes remain staged until saved or consumed. */
  async decompressGzip(parentId: string): Promise<{ id: string; size: number; depth: number }> {
    return this.exclusive(async () => {
      const parent = this.node(parentId);
      if (parent.depth + 1 > this.limits.maxDepth) throw new Error('transform depth limit');
      const key = `${parentId}:gzip`;
      if (this.expanded.has(key)) throw new Error('content already expanded with recipe');
      if (this.products >= this.limits.maxProducts) throw new Error('transform product limit');
      if (parent.bytes.length < 2 || parent.bytes[0] !== 0x1f || parent.bytes[1] !== 0x8b) throw new Error('input is not gzip');
      const remaining = this.limits.maxExpandedBytes - this.expandedBytes;
      if (remaining < 1) throw new Error('expanded bytes limit');
      let bytes: Buffer;
      try { bytes = gunzipSync(parent.bytes, { maxOutputLength: remaining + 1 }); }
      catch (error) { throw new Error(`gzip expansion failed or exceeded byte limit: ${error instanceof Error ? error.message : String(error)}`); }
      if (bytes.length > remaining) throw new Error('expanded bytes limit');
      const hash = identity(bytes);
      if (this.content.has(hash)) throw new Error('duplicate content');
      await this.publish(parent, 'consumed');
      const node: Node = { id: `misc_${hash}`, bytes, parent: parentId, depth: parent.depth + 1, recipe: 'gzip' };
      this.nodes.set(node.id, node); this.content.add(hash); this.expanded.add(key);
      this.products++; this.expandedBytes += bytes.length;
      return Object.freeze({ id: node.id, size: bytes.length, depth: node.depth });
    });
  }

  listZipEntries(parentId: string): ZipEntryInfo[] {
    const parent = this.node(parentId);
    const entries = parseZipDirectory(parent.bytes, this.limits.maxProducts);
    return entries.map(entry => ({ ...entry }));
  }

  inspectPng(parentId: string): PngStructure {
    const bytes = this.node(parentId).bytes;
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('input is not PNG');
    const chunks: PngStructure['chunks'] = []; let cursor = 8; let header: Omit<PngStructure, 'chunks'> | undefined; let ended = false;
    while (cursor < bytes.length) {
      if (chunks.length >= 4096 || cursor + 12 > bytes.length) throw new Error('PNG chunk structure limit or truncation');
      const length = bytes.readUInt32BE(cursor); const typeBytes = bytes.subarray(cursor + 4, cursor + 8); const type = typeBytes.toString('ascii');
      if (!/^[A-Za-z]{4}$/.test(type) || length > this.limits.maxInputBytes || cursor + 12 + length > bytes.length) throw new Error('invalid PNG chunk bounds or type');
      const dataStart = cursor + 8; const dataEnd = dataStart + length; const expectedCrc = bytes.readUInt32BE(dataEnd);
      if (crc32(bytes.subarray(cursor + 4, dataEnd)) !== expectedCrc) throw new Error(`PNG ${type} CRC mismatch`);
      if (chunks.length === 0) {
        if (type !== 'IHDR' || length !== 13) throw new Error('PNG must start with a 13-byte IHDR');
        const width = bytes.readUInt32BE(dataStart); const height = bytes.readUInt32BE(dataStart + 4);
        const bitDepth = bytes[dataStart + 8]!; const colorType = bytes[dataStart + 9]!;
        if (!width || !height || ![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType)) throw new Error('invalid PNG image dimensions or IHDR values');
        header = { width, height, bitDepth, colorType };
      }
      chunks.push({ type, length }); cursor = dataEnd + 4;
      if (type === 'IEND') { if (length !== 0 || cursor !== bytes.length) throw new Error('invalid PNG IEND or trailing bytes'); ended = true; break; }
    }
    if (!ended || !header) throw new Error('PNG is missing terminal IEND');
    return Object.freeze({ ...header, chunks: Object.freeze(chunks.map(chunk => Object.freeze({ ...chunk }))) as unknown as PngStructure['chunks'] });
  }

  inspectPcap(parentId: string): PcapStructure {
    const bytes = this.node(parentId).bytes;
    if (bytes.length < 24) throw new Error('pcap global header truncated');
    const magic = bytes.subarray(0, 4).toString('hex');
    const formats: Record<string, { endian: 'little' | 'big'; precision: 'microseconds' | 'nanoseconds' }> = {
      'd4c3b2a1': { endian: 'little', precision: 'microseconds' }, 'a1b2c3d4': { endian: 'big', precision: 'microseconds' },
      '4d3cb2a1': { endian: 'little', precision: 'nanoseconds' }, 'a1b23c4d': { endian: 'big', precision: 'nanoseconds' }
    };
    const format = formats[magic]; if (!format) throw new Error('unsupported pcap magic');
    const read16 = (offset: number) => format.endian === 'little' ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
    const read32 = (offset: number) => format.endian === 'little' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    if (read16(4) !== 2 || read16(6) !== 4) throw new Error('unsupported pcap version');
    const snapLength = read32(16); const linkType = read32(20);
    if (!snapLength || snapLength > this.limits.maxInputBytes) throw new Error('pcap snap length outside ingestion limit');
    const packets: PcapStructure['packets'] = []; let cursor = 24; const fractionLimit = format.precision === 'microseconds' ? 1_000_000 : 1_000_000_000;
    while (cursor < bytes.length) {
      if (packets.length >= 100_000 || cursor + 16 > bytes.length) throw new Error('pcap packet count limit or record truncation');
      const seconds = read32(cursor); const fraction = read32(cursor + 4); const capturedLength = read32(cursor + 8); const originalLength = read32(cursor + 12);
      if (fraction >= fractionLimit || capturedLength > snapLength || originalLength < capturedLength || capturedLength > bytes.length - cursor - 16) throw new Error('invalid pcap packet bounds or timestamp');
      packets.push({ offset: cursor + 16, capturedLength, originalLength, timestampSeconds: seconds, timestampFraction: fraction });
      cursor += 16 + capturedLength;
    }
    return Object.freeze({ endian: format.endian, timestampPrecision: format.precision, snapLength, linkType,
      packets: Object.freeze(packets.map(packet => Object.freeze({ ...packet }))) as unknown as PcapStructure['packets'] });
  }

  /** Extract one explicitly selected regular-file entry; never writes archive paths to disk. */
  async extractZipEntry(parentId: string, name: string): Promise<{ id: string; size: number; depth: number }> {
    return this.exclusive(async () => {
      const parent = this.node(parentId);
      if (parent.depth + 1 > this.limits.maxDepth) throw new Error('transform depth limit');
      const entries = parseZipDirectory(parent.bytes, this.limits.maxProducts);
      const entry = entries.find(value => value.name === name);
      if (!entry) throw new Error('zip entry not found');
      if (entry.name.endsWith('/')) throw new Error('zip directory entries cannot be extracted as files');
      const key = `${parentId}:zip:${entry.name}`;
      if (this.expanded.has(key)) throw new Error('content already expanded with recipe');
      if (this.products >= this.limits.maxProducts) throw new Error('transform product limit');
      const remaining = this.limits.maxExpandedBytes - this.expandedBytes;
      if (remaining < 1 || entry.uncompressedSize > remaining) throw new Error('expanded bytes limit');
      const bytes = extractZipBytes(parent.bytes, entry, remaining);
      if (bytes.length !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) throw new Error('zip entry integrity check failed');
      const hash = identity(bytes);
      if (this.content.has(hash)) throw new Error('duplicate content');
      await this.publish(parent, 'consumed');
      const node: Node = { id: `misc_${hash}`, bytes, parent: parentId, entryName: entry.name, depth: parent.depth + 1, recipe: 'zip_entry' };
      this.nodes.set(node.id, node); this.content.add(hash); this.expanded.add(key);
      this.products++; this.expandedBytes += bytes.length;
      return Object.freeze({ id: node.id, size: bytes.length, depth: node.depth });
    });
  }

  private async publish(node: Node, disposition: 'saved' | 'consumed'): Promise<void> {
    if (node.outputRef && node.provenanceRef) return;
    const parent = this.node(node.parent!);
    if (!parent.outputRef || !parent.provenanceRef) throw new Error('parent provenance unavailable');
    node.outputRef = fixedReference(await this.artifacts.publish(node.bytes));
    node.provenanceRef = fixedReference(await this.artifacts.publish(Buffer.from(JSON.stringify({
      outputRef: node.outputRef, parentRefs: [parent.outputRef], parentProvenanceRefs: [parent.provenanceRef],
      recipe: node.recipe, parameters: node.recipe === 'gzip' ? { container: 'gzip', integrity: 'zlib_crc_and_size' }
        : node.recipe === 'zip_entry' ? { container: 'zip', entry: node.entryName, integrity: 'crc32_and_declared_size', archivePathsWritten: false }
          : { surroundingWhitespace: 'trim', encoding: node.recipe === 'hex' ? 'case_insensitive_hex' : 'padded_base64' },
      depth: node.depth, disposition, validation: 'canonical roundtrip'
    }))));
  }

  async save(id: string): Promise<{ outputRef: ArtifactReference; provenanceRef: ArtifactReference }> {
    return this.exclusive(async () => { const node = this.node(id); await this.publish(node, 'saved'); return Object.freeze({ outputRef: fixedReference(node.outputRef!), provenanceRef: fixedReference(node.provenanceRef!) }); });
  }
  async consume(id: string): Promise<{ bytes: Buffer; outputRef: ArtifactReference; provenanceRef: ArtifactReference }> {
    return this.exclusive(async () => { const node = this.node(id); await this.publish(node, 'consumed'); return Object.freeze({ bytes: Buffer.from(node.bytes), outputRef: fixedReference(node.outputRef!), provenanceRef: fixedReference(node.provenanceRef!) }); });
  }
}

function identity(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function isCanonicalHex(text: string): boolean { return /^(?:[0-9a-fA-F]{2})+$/.test(text) && Buffer.from(text, 'hex').toString('hex') === text.toLowerCase(); }
function isCanonicalBase64(text: string): boolean { return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) && text.length > 0 && Buffer.from(text, 'base64').toString('base64') === text; }
// ArtifactReference contains scalar fields only; copying + freezing makes every reference immutable.
function fixedReference(ref: ArtifactReference): ArtifactReference { return Object.freeze({ hash: ref.hash, size: ref.size, path: ref.path }); }
function detectMagic(bytes: Buffer): string {
  const hex = bytes.subarray(0, 8).toString('hex');
  if (hex === '89504e470d0a1a0a') return 'png';
  if (hex.startsWith('504b0304')) return 'zip';
  if (hex.startsWith('1f8b')) return 'gzip';
  if (['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(bytes.subarray(0, 4).toString('hex'))) return 'pcap';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) && !/[\x00-\x08\x0e-\x1f]/.test(text) ? 'text' : 'binary';
}

function parseZipDirectory(bytes: Buffer, maxEntries: number): ZipEntryInfo[] {
  const min = Math.max(0, bytes.length - 65_557); let eocd = -1;
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('zip end-of-central-directory missing');
  const disk = bytes.readUInt16LE(eocd + 4); const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8); const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12); const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== bytes.length) throw new Error('zip trailing bytes or invalid comment length');
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new Error('multi-disk zip is unsupported');
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('zip64 is unsupported');
  if (totalEntries > maxEntries) throw new Error('zip entry count limit');
  if (centralOffset + centralSize !== eocd || centralOffset > bytes.length) throw new Error('zip central directory bounds invalid');
  const entries: ZipEntryInfo[] = []; let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('invalid zip central entry');
    const creator = bytes.readUInt16LE(cursor + 4); const flags = bytes.readUInt16LE(cursor + 8); const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16); const compressedSize = bytes.readUInt32LE(cursor + 20); const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28); const extraLength = bytes.readUInt16LE(cursor + 30); const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const startDisk = bytes.readUInt16LE(cursor + 34); const externalAttributes = bytes.readUInt32LE(cursor + 38); const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > eocd) throw new Error('zip central entry extends past directory');
    if (flags & 1) throw new Error('encrypted zip entries are unsupported');
    if (method !== 0 && method !== 8) throw new Error('zip compression method unsupported');
    if (startDisk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error('multi-disk or zip64 entry unsupported');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    validateZipName(name);
    const unixMode = creator >>> 8 === 3 ? externalAttributes >>> 16 : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error('zip symlink entries are unsupported');
    if (compressedSize > bytes.length || uncompressedSize > bytes.length + 1_073_741_824) throw new Error('zip entry declared size outside supported bounds');
    if (localHeaderOffset + 30 > centralOffset || bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('invalid zip local header offset');
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6); const localMethod = bytes.readUInt16LE(localHeaderOffset + 8);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26); const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localNameEnd = localHeaderOffset + 30 + localNameLength;
    const localDataEnd = localNameEnd + localExtraLength + compressedSize;
    if (localFlags !== flags || localMethod !== method || localDataEnd > centralOffset) throw new Error('zip local header disagrees with central directory');
    const localName = bytes.subarray(localHeaderOffset + 30, localNameEnd).toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (localName !== name) throw new Error('zip local filename disagrees with central directory');
    entries.push({ name, method: method as 0 | 8, flags, compressedSize, uncompressedSize, crc32: crc, localHeaderOffset });
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('zip central directory size mismatch');
  return entries;
}

function validateZipName(name: string): void {
  if (!name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new Error('unsafe zip entry path');
  const normalized = name.replace(/\\/g, '/');
  if (normalized.split('/').some(segment => segment === '..' || segment === '.')) throw new Error('unsafe zip entry path');
}

function extractZipBytes(archive: Buffer, entry: ZipEntryInfo, maxOutput: number): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) throw new Error('invalid zip local header');
  const flags = archive.readUInt16LE(offset + 6); const method = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26); const extraLength = archive.readUInt16LE(offset + 28);
  if (flags !== entry.flags || flags & 1 || method !== entry.method) throw new Error('zip local header disagrees with central directory');
  const dataStart = offset + 30 + nameLength + extraLength; const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length || dataStart > archive.length) throw new Error('zip entry data outside archive bounds');
  const input = archive.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(input);
  try { return inflateRawSync(input, { maxOutputLength: Math.min(maxOutput, entry.uncompressedSize) + 1 }); }
  catch (error) { throw new Error(`zip entry expansion failed or exceeded byte limit: ${error instanceof Error ? error.message : String(error)}`); }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let value = i; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[i] = value >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
