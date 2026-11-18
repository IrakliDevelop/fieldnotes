// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementStore } from '../elements/element-store';
import { createShape } from '../elements/element-factory';
import { exportPdf } from './export-pdf';

let context: CanvasRenderingContext2D;

beforeEach(() => {
  context = new Proxy(
    {
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255),
      }),
    },
    {
      get(target, key) {
        if (key === 'canvas' || key === 'getImageData') return Reflect.get(target, key);
        return () => undefined;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => vi.restoreAllMocks());

describe('exportPdf', () => {
  it('writes one PDF page for a board shape', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 20, h: 10 } }));
    const pdf = await exportPdf(store, { dpi: 18 });
    expect(pdf?.type).toBe('application/pdf');
    expect(new TextDecoder('latin1').decode(await pdf?.arrayBuffer())).toMatch(/^%PDF-1.4/);
  });

  it('rejects invalid options before creating a canvas', async () => {
    const store = new ElementStore();
    await expect(exportPdf(store, { frameIds: [] })).rejects.toThrow(RangeError);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
});
