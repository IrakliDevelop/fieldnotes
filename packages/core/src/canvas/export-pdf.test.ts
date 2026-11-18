// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementStore } from '../elements/element-store';
import { createImage, createShape } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import { elementLink } from '../elements/link';
import { exportPdf } from './export-pdf';

let rgba = new Uint8ClampedArray([255, 255, 255, 255]);
let contexts = 0;

beforeEach(() => {
  contexts = 0;
  rgba = new Uint8ClampedArray([255, 255, 255, 255]);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    contexts++;
    return new Proxy(
      {
        canvas: this,
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4).map((_, index) => rgba[index % 4] ?? 0),
        }),
      },
      { get: (target, key) => (key in target ? Reflect.get(target, key) : () => undefined) },
    ) as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const store = new ElementStore();
  const wide = createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 74 } });
  wide.id = 'wide';
  const tall = createFrame({ position: { x: 200, y: 0 }, size: { w: 80, h: 184 } });
  tall.id = 'tall';
  const wideChild = createShape({
    parentId: wide.id,
    position: { x: 0, y: 24 },
    size: { w: 100, h: 50 },
  });
  const tallChild = createShape({
    parentId: tall.id,
    position: { x: 200, y: 24 },
    size: { w: 80, h: 160 },
  });
  store.add(wide);
  store.add(tall);
  store.add(wideChild);
  store.add(tallChild);
  return { store, wide, tall, wideChild, tallChild };
}
async function text(pdf: Blob | null): Promise<string> {
  if (!pdf) throw new Error('PDF missing');
  return new TextDecoder('latin1').decode(await pdf.arrayBuffer());
}

describe('exportPdf', () => {
  it('writes one PDF page for a board shape and null for an empty board', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 20, h: 10 } }));
    const pdf = await exportPdf(store, { dpi: 18 });
    const value = await text(pdf);
    expect([
      pdf?.type,
      value.startsWith('%PDF-1.4'),
      value.match(/\/Type\s*\/Page(?!s)/g)?.length,
    ]).toEqual(['application/pdf', true, 1]);
    await expect(exportPdf(new ElementStore(), { dpi: 18 })).resolves.toBeNull();
  });
  it('orders auto pages and uses Letter landscape', async () => {
    const { store, wide, tall } = fixture();
    const ordered = await text(await exportPdf(store, { frameIds: [tall.id, wide.id], dpi: 18 }));
    expect(ordered.indexOf('/MediaBox [0 0 595.28 841.89]')).toBeLessThan(
      ordered.indexOf('/MediaBox [0 0 841.89 595.28]'),
    );
    expect(
      await text(await exportPdf(store, { frameIds: [wide.id], pageSize: 'letter', dpi: 18 })),
    ).toContain('/MediaBox [0 0 792 612]');
  });
  it('fits portrait pages at default and requested densities', async () => {
    const { store, wide } = fixture();
    const base = { frameIds: [wide.id], orientation: 'portrait' as const, margin: 0 };
    const defaultDpi = await text(await exportPdf(store, base));
    expect(defaultDpi).toContain('q 595.28 0 0 297.64 0 272.125 cm /Im0 Do Q');
    expect(defaultDpi).toContain('/Width 1191 /Height 596');
    expect(await text(await exportPdf(store, { ...base, dpi: 72 }))).toContain(
      '/Width 596 /Height 298',
    );
    expect(
      Number(
        (await text(await exportPdf(store, { ...base, maxDimension: 600 }))).match(
          /\/Width (\d+)/,
        )?.[1],
      ),
    ).toBeLessThanOrEqual(600);
  });
  it('writes external, escaped, and clipped link annotations', async () => {
    const { store, wide } = fixture();
    const linked = createShape({
      parentId: wide.id,
      position: { x: 10, y: 34 },
      size: { w: 20, h: 10 },
    });
    linked.link = 'http://example.com/ä';
    store.add(linked);
    const options = { frameIds: [wide.id], orientation: 'portrait' as const, margin: 0, dpi: 18 };
    let value = await text(await exportPdf(store, options));
    expect(value).toContain('/Subtype /Link');
    expect(value).toContain('/Rect [59.528 450.709 178.584 510.237]');
    expect(value).toContain('/URI (http://example.com/%C3%A4)');
    store.update(linked.id, { link: 'http://example.com/a)b' });
    expect(await text(await exportPdf(store, options))).toContain(
      '/URI (http://example.com/a\\)b)',
    );
    store.update(linked.id, { position: { x: 80, y: 34 }, size: { w: 40, h: 10 } });
    value = await text(await exportPdf(store, options));
    expect(value).toContain('/Rect [476.224 450.709 595.28 510.237]');
  });
  it('links internal targets only on exported pages', async () => {
    const { store, wide, tall, wideChild, tallChild } = fixture();
    store.update(wideChild.id, { link: elementLink(tall.id) });
    let value = await text(await exportPdf(store, { frameIds: [wide.id, tall.id], dpi: 18 }));
    const pageTwo = value.match(/\/Kids \[\d+ 0 R (\d+) 0 R\]/)?.[1];
    expect(value).toContain(`/Dest [${pageTwo} 0 R /Fit]`);
    store.update(wideChild.id, { link: elementLink(tallChild.id) });
    value = await text(await exportPdf(store, { frameIds: [wide.id, tall.id], dpi: 18 }));
    expect(value).toContain(`/Dest [${value.match(/\/Kids \[\d+ 0 R (\d+) 0 R\]/)?.[1]} 0 R /Fit]`);
    store.update(wideChild.id, { link: elementLink('missing') });
    expect(await text(await exportPdf(store, { frameIds: [wide.id], dpi: 18 }))).not.toContain(
      '/Annots',
    );
  });
  it('composites alpha, supports uncompressed RGB, and uses FlateDecode', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    rgba = new Uint8ClampedArray([0, 0, 0, 128]);
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }));
    const raw = await text(await exportPdf(store, { dpi: 18 }));
    expect(raw).not.toContain('/Filter');
    const image = raw.match(/\/Width (\d+) \/Height (\d+)[\s\S]*?\/Length (\d+)/);
    expect(Number(image?.[3])).toBe(Number(image?.[1]) * Number(image?.[2]) * 3);
    expect(raw).toContain('\x7f\x7f\x7f');
    vi.unstubAllGlobals();
    const { store: compressed, wide } = fixture();
    expect(await text(await exportPdf(compressed, { frameIds: [wide.id], dpi: 18 }))).toContain(
      '/Filter /FlateDecode',
    );
  });
  it('validates before painting and never embeds scenes', async () => {
    const { store, wide } = fixture();
    for (const options of [
      { frameIds: [] },
      { frameIds: [wide.id, wide.id] },
      { margin: -1 },
      { dpi: 0 },
      { pageSize: { width: 0, height: 10 } },
    ])
      await expect(exportPdf(store, options)).rejects.toThrow(RangeError);
    expect(contexts).toBe(0);
    expect(await text(await exportPdf(store, { frameIds: [wide.id], dpi: 18 }))).not.toContain(
      'fieldnotes/scene',
    );
  });
  it('returns null for null context and prepares later frames before painting', async () => {
    const { store, wide } = fixture();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(exportPdf(store, { frameIds: [wide.id], dpi: 18 })).resolves.toBeNull();
    contexts = 0;
    await expect(exportPdf(store, { frameIds: [wide.id, 'missing'], dpi: 18 })).rejects.toThrow(
      RangeError,
    );
    expect(contexts).toBe(0);
  });
  it('deduplicates asset warnings across PDF pages', async () => {
    const { store, wide, tall } = fixture();
    vi.stubGlobal('CompressionStream', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.add(
      createImage({
        parentId: wide.id,
        position: { x: 0, y: 24 },
        size: { w: 1, h: 1 },
        src: 'broken',
      }),
    );
    store.add(
      createImage({
        parentId: tall.id,
        position: { x: 200, y: 24 },
        size: { w: 1, h: 1 },
        src: 'broken',
      }),
    );
    await exportPdf(store, { frameIds: [wide.id, tall.id], imageTimeoutMs: 1, dpi: 18 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
