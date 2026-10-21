import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const TAR_GZ_LIMITS = {
  compressedBytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entries: 512,
  fileBytes: 1 * 1024 * 1024
} as const;

export interface TarGzipMember {
  path: string;
  type: 'file' | 'directory';
  size: number;
  sha256?: string;
  bytes?: Buffer;
}

function fieldText(block: Buffer, start: number, end: number): string {
  const field = block.subarray(start, end);
  const nul = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(nul < 0 ? field : field.subarray(0, nul));
}

function tarNumber(block: Buffer, start: number, end: number, label: string): number {
  const value = block.subarray(start, end);
  if (value[0]! & 0x80) throw new Error(`archive unsupported: base-256 ${label}`);
  const text = value.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`archive invalid: ${label}`);
  const number = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(number)) throw new Error(`archive invalid: ${label}`);
  return number;
}

function checkedPath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('archive path denied: expected a relative POSIX path');
  }
  const parts = value.split('/').filter((part, index, all) => !(part === '' && index === all.length - 1));
  if (parts.length === 0 || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('archive path denied: empty, dot, or parent segment');
  }
  return parts.join('/');
}

function parsePax(data: Buffer): Record<string, string> {
  const values: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw new Error('archive invalid: malformed PAX record');
    const lengthText = data.subarray(offset, space).toString('ascii');
    if (!/^\d+$/.test(lengthText)) throw new Error('archive invalid: malformed PAX length');
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || end > data.length || data[end - 1] !== 0x0a) {
      throw new Error('archive invalid: malformed PAX record length');
    }
    const record = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(space + 1, end - 1));
    const equals = record.indexOf('=');
    if (equals <= 0) throw new Error('archive invalid: malformed PAX key');
    const key = record.slice(0, equals);
    if (key.startsWith('GNU.sparse') || key === 'SCHILY.devmajor' || key === 'SCHILY.devminor') {
      throw new Error(`archive unsupported: PAX ${key}`);
    }
    values[key] = record.slice(equals + 1);
    offset = end;
  }
  return values;
}

function checksumValid(block: Buffer): boolean {
  const expected = tarNumber(block, 148, 156, 'checksum');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  return sum === expected;
}

export function parseTarGzip(archive: Buffer): TarGzipMember[] {
  if (archive.length > TAR_GZ_LIMITS.compressedBytes) throw new Error('archive limit: compressed input exceeds 8 MiB');
  let tar: Buffer;
  try { tar = gunzipSync(archive, { maxOutputLength: TAR_GZ_LIMITS.expandedBytes }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/larger than|output length|buffer too large/i.test(message)) throw new Error('archive limit: expanded tar exceeds 32 MiB');
    throw new Error(`archive invalid: gzip decompression failed (${message})`);
  }

  const members: TarGzipMember[] = [];
  const paths = new Map<string, 'file' | 'directory'>();
  let pax: Record<string, string> = {};
  let longName: string | undefined;
  let offset = 0;
  let headers = 0;
  let fileCount = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    if (!checksumValid(header)) throw new Error('archive invalid: tar header checksum mismatch');
    const baseName = fieldText(header, 0, 100);
    const prefix = fieldText(header, 345, 500);
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
    const headerSize = tarNumber(header, 124, 136, 'entry size');
    const payloadStart = offset + 512;
    const payloadEnd = payloadStart + headerSize;
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > tar.length) throw new Error('archive invalid: truncated tar member');
    const paddedEnd = payloadStart + Math.ceil(headerSize / 512) * 512;
    if (paddedEnd > tar.length) throw new Error('archive invalid: truncated tar padding');
    const payload = tar.subarray(payloadStart, payloadEnd);
    offset = paddedEnd;
    if (++headers > TAR_GZ_LIMITS.entries * 4) throw new Error('archive limit: too many tar headers');

    if (typeFlag === 'x' || typeFlag === 'g') {
      const metadata = parsePax(payload);
      if (typeFlag === 'g') {
        if (metadata.path || metadata.linkpath || metadata.size) throw new Error('archive unsupported: global PAX path/size override');
      } else pax = { ...pax, ...metadata };
      continue;
    }
    if (typeFlag === 'L') {
      longName = new TextDecoder('utf-8', { fatal: true }).decode(payload).replace(/\0.*$/s, '').replace(/\n$/, '');
      continue;
    }
    if (typeFlag === 'K' || typeFlag === '1' || typeFlag === '2') throw new Error('archive link denied: links are not extracted');
    if (typeFlag !== '0' && typeFlag !== '5') throw new Error(`archive unsupported: tar entry type ${typeFlag}`);

    let name = longName ?? (pax.path ?? [prefix, baseName].filter(Boolean).join('/'));
    if (pax.size !== undefined) {
      const paxSize = Number(pax.size);
      if (!Number.isSafeInteger(paxSize) || paxSize !== headerSize) throw new Error('archive invalid: PAX size does not match header');
    }
    longName = undefined;
    pax = {};
    if (typeFlag === '5') name = name.replace(/\/+$/, '');
    const memberPath = checkedPath(name);
    const type = typeFlag === '5' ? 'directory' : 'file';
    const size = type === 'directory' ? 0 : headerSize;
    if (type === 'directory' && headerSize !== 0) throw new Error('archive invalid: directory entry contains data');
    if (size > TAR_GZ_LIMITS.fileBytes) throw new Error(`archive limit: ${memberPath} exceeds 1 MiB`);
    if (type === 'file' && fileCount >= TAR_GZ_LIMITS.entries) throw new Error('archive limit: more than 512 files');
    if (paths.has(memberPath)) throw new Error(`archive duplicate path denied: ${memberPath}`);
    const components = memberPath.split('/');
    for (let i = 1; i < components.length; i++) {
      const parent = components.slice(0, i).join('/');
      if (paths.get(parent) === 'file') throw new Error(`archive path conflict: ${parent} is a file`);
    }
    if (type === 'file' && [...paths.keys()].some(existing => existing.startsWith(memberPath + '/'))) {
      throw new Error(`archive path conflict: ${memberPath} already has descendants`);
    }
    paths.set(memberPath, type);
    if (type === 'file') fileCount++;
    members.push(type === 'directory'
      ? { path: memberPath, type, size: 0 }
      : { path: memberPath, type, size, sha256: createHash('sha256').update(payload).digest('hex'), bytes: Buffer.from(payload) });
  }
  if (members.length === 0) throw new Error('archive invalid: no supported regular files or directories found');
  if (members.filter(member => member.type === 'file').length > TAR_GZ_LIMITS.entries) throw new Error('archive limit: more than 512 files');
  if (longName || Object.keys(pax).length) throw new Error('archive invalid: dangling path metadata');
  return members;
}
