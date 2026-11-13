import { describe, it, expect, vi, afterEach } from 'vitest';
import { appendItxtChunk, crc32, findItxtChunk } from './png-chunks';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 1x1 RGBA IHDR; its CRC 1f 15 c4 89 is the well-known value for this header.
const IHDR = [
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4,
  0x89,
];
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const KEYWORD = 'fieldnotes:scene';

function bitwiseCrc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  const crc = bitwiseCrc(typed);
  const len = data.length;
  return [
    (len >>> 24) & 255,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...typed,
    (crc >>> 24) & 255,
    (crc >>> 16) & 255,
    (crc >>> 8) & 255,
    crc & 255,
  ];
}

function png(...middle: number[][]): Uint8Array {
  return new Uint8Array([...SIGNATURE, ...IHDR, ...middle.flat(), ...IEND]);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Offset of the scene chunk's length field. */
function sceneChunkStart(bytes: Uint8Array): number {
  return indexOfBytes(bytes, new TextEncoder().encode(`iTXt${KEYWORD}`)) - 4;
}

function rewriteCrc(bytes: Uint8Array, start: number): void {
  const view = new DataView(bytes.buffer);
  const len = view.getUint32(start);
  view.setUint32(start + 8 + len, bitwiseCrc(bytes.subarray(start + 4, start + 8 + len)));
}

afterEach(() => vi.restoreAllMocks());

describe('png chunks', () => {
  it('crc32 matches the IEND chunk CRC', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('round-trips a scene text through an iTXt chunk', () => {
    const out = appendItxtChunk(png(), KEYWORD, '{"a":1}');
    expect(findItxtChunk(out, KEYWORD, 1 << 20)).toBe('{"a":1}');
  });

  it('writes an uncompressed iTXt chunk with a correct CRC right before IEND', () => {
    const out = appendItxtChunk(png(), KEYWORD, '{"a":1}');
    const expected = chunk(
      'iTXt',
      new Uint8Array([
        ...new TextEncoder().encode(KEYWORD),
        0,
        0,
        0,
        0,
        0,
        0x7b,
        0x22,
        0x61,
        0x22,
        0x3a,
        0x31,
        0x7d,
      ]),
    );
    expect([...out]).toEqual([...SIGNATURE, ...IHDR, ...expected, ...IEND]);
    expect(sceneChunkStart(out)).toBe(SIGNATURE.length + IHDR.length);
  });

  it('finds the scene after an iTXt chunk with another keyword', () => {
    const xmp = appendItxtChunk(png(), 'XML:com.adobe.xmp', '<x/>');
    expect(findItxtChunk(appendItxtChunk(xmp, KEYWORD, 'scene'), KEYWORD, 1 << 20)).toBe('scene');
  });

  it('skips unknown chunk types', () => {
    const unknown = chunk('zzZz', new Uint8Array([1, 2, 3]));
    expect(findItxtChunk(appendItxtChunk(png(unknown), KEYWORD, 'ok'), KEYWORD, 1 << 20)).toBe(
      'ok',
    );
  });

  it('rejects a compressed scene chunk', () => {
    const out = appendItxtChunk(png(), KEYWORD, '{"a":1}');
    const start = sceneChunkStart(out);
    out[start + 8 + KEYWORD.length + 1] = 1;
    rewriteCrc(out, start);
    expect(findItxtChunk(out, KEYWORD, 1 << 20)).toBeNull();
  });

  it('rejects a scene chunk with a CRC mismatch', () => {
    const out = appendItxtChunk(png(), KEYWORD, '{"a":1}');
    const crcEnd = out.length - IEND.length - 1;
    out[crcEnd] = (out[crcEnd] ?? 0) ^ 1;
    expect(findItxtChunk(out, KEYWORD, 1 << 20)).toBeNull();
  });

  it('rejects an oversized scene chunk from its header without decoding it', () => {
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const out = appendItxtChunk(png(), KEYWORD, '{"a":1}');
    expect(findItxtChunk(out, KEYWORD, 3)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('returns null without a scene chunk or for non-PNG bytes', () => {
    expect(findItxtChunk(png(), KEYWORD, 1 << 20)).toBeNull();
    expect(
      findItxtChunk(new TextEncoder().encode('not a png at all'), KEYWORD, 1 << 20),
    ).toBeNull();
  });

  it('appendItxtChunk throws on a non-PNG and on a PNG without IEND', () => {
    expect(() => appendItxtChunk(new Uint8Array([1, 2, 3]), KEYWORD, 'x')).toThrow();
    expect(() => appendItxtChunk(new Uint8Array([...SIGNATURE, ...IHDR]), KEYWORD, 'x')).toThrow();
  });
});
