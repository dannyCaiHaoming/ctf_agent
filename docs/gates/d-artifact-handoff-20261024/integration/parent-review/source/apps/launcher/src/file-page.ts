/** Shared byte/text pagination for pinned Intake materials and the three G roots. */
export function filePage(bytes: Buffer, cursor: unknown, refuse: (code: string) => never) {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary data');
  } catch { return { binary: true, signature: bytes.subarray(0, 8).toString('hex') || 'empty' }; }

  // Cursor is the decimal byte offset of the next page; a page never splits a UTF-8 character.
  let start = 0;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || !/^\d{1,15}$/.test(cursor)) refuse('cursor');
    start = Number(cursor);
    if (start > bytes.length || (start < bytes.length && (bytes[start]! & 0xc0) === 0x80)) refuse('cursor');
  }
  let end = Math.min(start + 32768, bytes.length);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  if (end <= start && start < bytes.length) refuse('cursor');
  return { text: bytes.subarray(start, end).toString('utf8'), offset: start, nextCursor: end < bytes.length ? String(end) : null, done: end >= bytes.length };
}
