// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deflate, pdfNumber, pdfString, PdfWriter } from './pdf-writer';

const decoder = new TextDecoder();

describe('PdfWriter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes a header, objects, a 20 byte xref table and startxref', () => {
    const writer = new PdfWriter();
    const catalog = writer.addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pages = writer.addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    writer.addObject('<< /Type /Page /Parent 2 0 R >>');

    const bytes = writer.finish(catalog, pages);
    const text = decoder.decode(bytes);
    const xref = new TextDecoder('latin1').decode(bytes).indexOf('xref\n');
    const startxref = /startxref\n(\d+)\n/.exec(text);
    const entries = bytes.subarray(xref + 'xref\n0 4\n'.length, xref + 'xref\n0 4\n'.length + 80);

    expect([...bytes.subarray(0, 10)]).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25,
    ]);
    expect([...bytes.subarray(10, 14)].every((byte) => byte >= 0x80)).toBe(true);
    expect(startxref?.[1]).toBe(String(xref));
    expect(entries).toHaveLength(80);
    expect(decoder.decode(entries.subarray(0, 20))).toBe('0000000000 65535 f\r\n');
    for (let id = 1; id <= 3; id += 1) {
      const entry = decoder.decode(entries.subarray(id * 20, (id + 1) * 20));
      const offset = Number(entry.slice(0, 10));
      expect(entry).toMatch(/^\d{10} 00000 n\r\n$/);
      expect(decoder.decode(bytes.subarray(offset, offset + `${id} 0 obj`.length))).toBe(
        `${id} 0 obj`,
      );
    }
    expect(text).toContain('/Size 4');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('writes a stream with its byte length', () => {
    const writer = new PdfWriter();
    const data = new Uint8Array([0, 255, 40, 41]);
    writer.addStream('<< /Type /XObject >>', data);
    const bytes = writer.finish(1, 1);
    const start = decoder.decode(bytes).indexOf('stream\n') + 'stream\n'.length;

    expect(decoder.decode(bytes)).toContain('/Length 4');
    expect([...bytes.subarray(start, start + data.length)]).toEqual([0, 255, 40, 41]);
    expect(decoder.decode(bytes.subarray(start + data.length, start + data.length + 11))).toBe(
      '\nendstream\n',
    );
  });

  it('pdfString escapes backslash and parentheses', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('pdfNumber trims to three decimals', () => {
    expect(pdfNumber(595.28)).toBe('595.28');
    expect(pdfNumber(272.125)).toBe('272.125');
    expect(pdfNumber(1 / 3)).toBe('0.333');
    expect(pdfNumber(2)).toBe('2');
  });

  it('deflate returns zlib framed bytes when CompressionStream exists', async () => {
    const compressed = await deflate(new Uint8Array([1, 2, 3]));
    vi.stubGlobal('CompressionStream', undefined);
    const uncompressed = await deflate(new Uint8Array([1, 2, 3]));

    expect(compressed.filter).toBe('/FlateDecode');
    expect(compressed.data[0]).toBe(0x78);
    expect([...uncompressed.data]).toEqual([1, 2, 3]);
    expect(uncompressed.filter).toBeNull();
  });

  it('reserve and set fill a forward reference', () => {
    const writer = new PdfWriter();
    const id = writer.reserve();
    writer.set(id, '<< /Type /Catalog >>');
    const bytes = writer.finish(id, id);
    const text = decoder.decode(bytes);
    const offset = Number(/xref\n0 2\n\d{10} 65535 f\r\n(\d{10})/.exec(text)?.[1]);

    expect(id).toBe(1);
    expect(decoder.decode(bytes.subarray(offset, offset + 7))).toBe('1 0 obj');
  });
});
