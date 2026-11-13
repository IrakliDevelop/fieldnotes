const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ChunkHeader {
  offset: number;
  length: number;
  type: string;
}

function* chunks(png: Uint8Array): Generator<ChunkHeader> {
  if (png.length < 8 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) return;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > png.length) return;
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    yield { offset, length, type };
    offset += 12 + length;
  }
}

export function appendItxtChunk(
  png: Uint8Array,
  keyword: string,
  text: string,
): Uint8Array<ArrayBuffer> {
  let iend: number | undefined;
  for (const chunk of chunks(png)) {
    if (chunk.type !== 'IEND') continue;
    iend = chunk.offset;
    break;
  }
  if (iend === undefined) throw new Error('Not a PNG with an IEND chunk');

  const encoder = new TextEncoder();
  const key = encoder.encode(keyword);
  const body = encoder.encode(text);
  // Five zeros: keyword separator, compression flag and method, empty language and translated keyword.
  const length = key.length + 5 + body.length;
  const chunk = new Uint8Array(12 + length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(key, 8);
  chunk.set(body, 8 + key.length + 5);
  view.setUint32(8 + length, crc32(chunk.subarray(4, 8 + length)));

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend));
  out.set(chunk, iend);
  out.set(png.subarray(iend), iend + chunk.length);
  return out;
}

export function findItxtChunk(png: Uint8Array, keyword: string, maxLength: number): string | null {
  const key = new TextEncoder().encode(keyword);
  for (const { offset, length, type } of chunks(png)) {
    const start = offset + 8;
    if (type !== 'iTXt' || length <= key.length || png[start + key.length] !== 0) continue;
    if (key.some((byte, i) => png[start + i] !== byte)) continue;
    if (length > maxLength) return null;
    const end = start + length;
    let cursor = start + key.length + 1;
    if (png[cursor] !== 0) return null;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (view.getUint32(end) !== crc32(png.subarray(offset + 4, end))) return null;
    cursor += 2;
    for (let skip = 0; skip < 2; skip++) {
      const nul = png.indexOf(0, cursor);
      if (nul === -1 || nul >= end) return null;
      cursor = nul + 1;
    }
    return new TextDecoder().decode(png.subarray(cursor, end));
  }
  return null;
}
