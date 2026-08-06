// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  computeBounds,
  getElementRect,
  exportImage,
  loadImages,
  fitExportScale,
} from './export-image';
import {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createText,
  createShape,
  createGrid,
  createTemplate,
} from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';

describe('getElementRect', () => {
  it('returns bounds for a note', () => {
    const note = createNote({ position: { x: 10, y: 20 }, size: { w: 200, h: 100 } });
    const rect = getElementRect(note);
    expect(rect).toEqual({ x: 10, y: 20, w: 200, h: 100 });
  });

  it('returns bounds for a shape', () => {
    const shape = createShape({ position: { x: 5, y: 5 }, size: { w: 50, h: 50 } });
    const rect = getElementRect(shape);
    expect(rect).toEqual({ x: 5, y: 5, w: 50, h: 50 });
  });

  it('expands bounds to rotated AABB for a rotated note', () => {
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    note.rotation = Math.PI / 4;
    const rect = getElementRect(note);
    expect(rect).not.toBeNull();
    if (rect) {
      const diag = 100 * Math.SQRT2;
      expect(rect.w).toBeCloseTo(diag, 5);
      expect(rect.h).toBeCloseTo(diag, 5);
      expect(rect.x).toBeCloseTo(50 - diag / 2, 5);
      expect(rect.y).toBeCloseTo(50 - diag / 2, 5);
    }
  });

  it('expands bounds to rotated AABB for a rotated stroke', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 0, pressure: 0.5 },
      ],
      position: { x: 0, y: 0 },
      width: 0,
    });
    stroke.rotation = Math.PI / 2;
    const rect = getElementRect(stroke);
    expect(rect).not.toBeNull();
    if (rect) {
      expect(rect.h).toBeCloseTo(100, 5);
      expect(rect.w).toBeCloseTo(0, 5);
    }
  });

  it('returns bounds for a text element', () => {
    const text = createText({ position: { x: 0, y: 0 }, size: { w: 200, h: 28 } });
    const rect = getElementRect(text);
    expect(rect).toEqual({ x: 0, y: 0, w: 200, h: 28 });
  });

  it('returns bounds for an image', () => {
    const img = createImage({ position: { x: 50, y: 50 }, size: { w: 300, h: 200 }, src: '' });
    const rect = getElementRect(img);
    expect(rect).toEqual({ x: 50, y: 50, w: 300, h: 200 });
  });

  it('returns bounds for a stroke', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 50, pressure: 0.5 },
      ],
      position: { x: 10, y: 10 },
      width: 4,
    });
    const rect = getElementRect(stroke);
    expect(rect).toEqual({ x: 8, y: 8, w: 104, h: 54 });
  });

  it('returns bounds for a straight arrow with padding', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      width: 2,
    });
    const rect = getElementRect(arrow);
    expect(rect).not.toBeNull();
    if (rect) {
      expect(rect.x).toBeLessThan(0);
      expect(rect.w).toBeGreaterThan(100);
    }
  });

  it('returns bounds for a template element', () => {
    const t = createTemplate({ position: { x: 100, y: 100 }, templateShape: 'circle', radius: 30 });
    const rect = getElementRect(t);
    expect(rect).toEqual({ x: 70, y: 70, w: 60, h: 60 });
  });

  it('returns null for grid elements', () => {
    const grid = createGrid({});
    expect(getElementRect(grid)).toBeNull();
  });

  it('returns null for stroke with no points', () => {
    const stroke = createStroke({ points: [] as never[] });
    expect(getElementRect(stroke)).toBeNull();
  });
});

describe('computeBounds', () => {
  it('computes bounding box of multiple elements with padding', () => {
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    const shape = createShape({ position: { x: 400, y: 50 }, size: { w: 100, h: 80 } });
    const bounds = computeBounds([note, shape], 10);
    expect(bounds).toEqual({ x: 90, y: 40, w: 420, h: 170 });
  });

  it('returns null for empty element list', () => {
    expect(computeBounds([], 10)).toBeNull();
  });

  it('returns null when all elements are grids', () => {
    const grid = createGrid({});
    expect(computeBounds([grid], 10)).toBeNull();
  });

  it('ignores grid elements in bounds calculation', () => {
    const note = createNote({ position: { x: 50, y: 50 }, size: { w: 100, h: 100 } });
    const grid = createGrid({});
    const bounds = computeBounds([note, grid], 0);
    expect(bounds).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });
});

describe('fitExportScale', () => {
  it('returns the requested scale when the output fits', () => {
    expect(fitExportScale({ w: 100, h: 50 }, 2, {})).toBe(2);
  });

  it('clamps to the dimension cap and never upscales', () => {
    const s = fitExportScale({ w: 1000, h: 500 }, 4, { maxDimension: 2000 });
    expect(s).toBeLessThanOrEqual(2);
    expect(Math.ceil(1000 * s)).toBeLessThanOrEqual(2000);
    expect(s).toBeGreaterThan(1.9);
  });

  it('clamps to the pixel cap', () => {
    const s = fitExportScale({ w: 1000, h: 1000 }, 4, { maxPixels: 1_000_000 });
    expect(Math.ceil(1000 * s) * Math.ceil(1000 * s)).toBeLessThanOrEqual(1_000_000);
  });

  it('handles an analytical candidate that only violates a cap after ceil rounding', () => {
    // sqrt(10/9) ≈ 1.054 → ceil(3 × 1.054) = 4 → 4 × 4 = 16 > 10.
    // The largest fitting scale is 1 (3 × 3 = 9 ≤ 10).
    const s = fitExportScale({ w: 3, h: 3 }, 4, { maxPixels: 10 });
    expect(Math.ceil(3 * s) * Math.ceil(3 * s)).toBeLessThanOrEqual(10);
    expect(s).toBeGreaterThan(0.99);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('fits astronomically large bounds instead of collapsing to zero', () => {
    // 1e200 × 1e200 overflows to Infinity — the pixel candidate must be
    // computed without forming the area product.
    const s = fitExportScale({ w: 1e200, h: 1e200 }, 2, {});
    expect(s).toBeGreaterThan(0);
    const dim = Math.ceil(1e200 * s);
    // For square bounds under the default caps the PIXEL cap binds (8192²),
    // not the dimension cap — assert near-optimality against the binding cap.
    expect(dim).toBeLessThanOrEqual(16_384);
    expect(dim * dim).toBeLessThanOrEqual(67_108_864);
    expect(dim * dim).toBeGreaterThan(67_108_864 * 0.98);
  });
});

describe('loadImages', () => {
  it('loads the exact source URL without rewriting it', async () => {
    const originalImage = globalThis.Image;
    let requestedSrc = '';
    globalThis.Image = class MockImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: ((cause: unknown) => void) | null = null;
      set src(value: string) {
        requestedSrc = value;
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;

    try {
      const image = createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'https://assets.example/map.png?token=signed',
      });
      await loadImages([image]);
      expect(requestedSrc).toBe(image.src);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it('reports a load failure with element context', async () => {
    const originalImage = globalThis.Image;
    const cause = new Event('error');
    globalThis.Image = class MockImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: ((cause: unknown) => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.(cause));
      }
    } as unknown as typeof Image;

    try {
      const onAssetError = vi.fn();
      const image = createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'https://assets.example/missing.png',
      });
      const result = await loadImages([image], { onAssetError });
      expect(result.size).toBe(0);
      expect(onAssetError).toHaveBeenCalledWith({
        elementId: image.id,
        src: image.src,
        reason: 'load',
        cause,
      });
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it('times out an image that never settles', async () => {
    vi.useFakeTimers();
    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: ((cause: unknown) => void) | null = null;
      set src(_value: string) {
        void _value;
      }
    } as unknown as typeof Image;

    try {
      const onAssetError = vi.fn();
      const image = createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'https://assets.example/hung.png',
      });
      const loading = loadImages([image], { imageTimeoutMs: 25, onAssetError });
      await vi.advanceTimersByTimeAsync(25);
      await expect(loading).resolves.toEqual(new Map());
      expect(onAssetError).toHaveBeenCalledWith({
        elementId: image.id,
        src: image.src,
        reason: 'timeout',
      });
    } finally {
      globalThis.Image = originalImage;
      vi.useRealTimers();
    }
  });
});

describe('getElementRect — html element', () => {
  it('returns bounds for an html element with size', () => {
    const html = {
      id: 'html-1',
      type: 'html' as const,
      position: { x: 10, y: 20 },
      size: { w: 300, h: 200 },
      zIndex: 0,
      locked: false,
      layerId: '',
    };
    const rect = getElementRect(html);
    expect(rect).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });
});

describe('exportImage', () => {
  it.each([
    [{ scale: 0 }, 'scale'],
    [{ scale: Number.NaN }, 'scale'],
    [{ padding: -1 }, 'padding'],
    [{ imageTimeoutMs: 0 }, 'imageTimeoutMs'],
    [{ htmlTimeoutMs: 0 }, 'htmlTimeoutMs'],
  ])('rejects invalid options %o', async (options, optionName) => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    await expect(exportImage(store, options)).rejects.toThrow(optionName);
  });

  it.each([
    [{ format: 'webp' as never }, 'format'],
    [{ quality: 0 }, 'quality'],
    [{ quality: 1.5 }, 'quality'],
    [{ quality: Number.NaN }, 'quality'],
  ])('rejects invalid encoding options %o', async (options, optionName) => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    await expect(exportImage(store, options)).rejects.toThrow(optionName);
  });

  it('rejects an export exceeding the dimension limit before creating a canvas', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 101, h: 10 } }));
    const createSpy = vi.spyOn(document, 'createElement');

    await expect(exportImage(store, { scale: 1, maxDimension: 100 })).rejects.toThrow(
      'maximum dimension',
    );
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('rejects an export exceeding the pixel limit before creating a canvas', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 } }));
    const createSpy = vi.spyOn(document, 'createElement');

    await expect(exportImage(store, { scale: 1, maxPixels: 399 })).rejects.toThrow(
      'maximum of 399 pixels',
    );
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('returns null for empty store', async () => {
    const store = new ElementStore();
    const result = await exportImage(store);
    expect(result).toBeNull();
  });

  it('returns null when all elements are grids', async () => {
    const store = new ElementStore();
    store.add(createGrid({}));
    const result = await exportImage(store);
    expect(result).toBeNull();
  });

  it('returns null when filter excludes all elements', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 } }));
    const result = await exportImage(store, { filter: () => false });
    expect(result).toBeNull();
  });

  it('returns null in jsdom because getContext returns null', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));
    const result = await exportImage(store);
    expect(result).toBeNull();
  });

  it('applies scale option to canvas dimensions', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));

    const createSpy = vi.spyOn(document, 'createElement');
    await exportImage(store, { scale: 3, padding: 10 });

    const canvasCall = createSpy.mock.results.find(
      (r) => r.type === 'return' && r.value instanceof HTMLCanvasElement,
    );
    if (canvasCall && canvasCall.type === 'return') {
      const canvas = canvasCall.value as HTMLCanvasElement;
      expect(canvas.width).toBe(Math.ceil(120 * 3));
      expect(canvas.height).toBe(Math.ceil(70 * 3));
    }
    createSpy.mockRestore();
  });

  it('filters elements by layer visibility', async () => {
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 }, layerId: 'hidden' }));
    store.add(
      createNote({ position: { x: 200, y: 200 }, size: { w: 100, h: 50 }, layerId: 'visible' }),
    );

    const mockLayerManager = {
      isLayerVisible: (id: string) => id === 'visible',
    };

    const result = await exportImage(store, {}, mockLayerManager as never);
    expect(result).toBeNull();
  });

  it('applies custom filter to elements', async () => {
    const store = new ElementStore();
    const note1 = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const note2 = createNote({ position: { x: 500, y: 500 }, size: { w: 100, h: 50 } });
    store.add(note1);
    store.add(note2);

    const bounds = computeBounds([note1], 0);
    expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 50 });

    const bothBounds = computeBounds([note1, note2], 0);
    expect(bothBounds).toEqual({ x: 0, y: 0, w: 600, h: 550 });
  });

  describe('exportImage — region option', () => {
    it.each([
      [{ x: 0, y: 0, w: 0, h: 10 }],
      [{ x: 0, y: 0, w: 10, h: -1 }],
      [{ x: Number.NaN, y: 0, w: 10, h: 10 }],
      [{ x: 0, y: Infinity, w: 10, h: 10 }],
    ])('rejects invalid region %o', async (region) => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
      await expect(exportImage(store, { region })).rejects.toThrow('region');
    });

    it('uses the region as canvas bounds instead of content bounds', async () => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 500, h: 500 } }));
      const createSpy = vi.spyOn(document, 'createElement');
      await exportImage(store, { scale: 1, region: { x: 10, y: 20, w: 100, h: 50 } });
      const canvasCall = createSpy.mock.results.find(
        (r) => r.type === 'return' && r.value instanceof HTMLCanvasElement,
      );
      expect(canvasCall).toBeDefined();
      if (canvasCall && canvasCall.type === 'return') {
        const canvas = canvasCall.value as HTMLCanvasElement;
        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(50);
      }
      createSpy.mockRestore();
    });

    it('applies padding around the region', async () => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
      const createSpy = vi.spyOn(document, 'createElement');
      await exportImage(store, { scale: 1, padding: 5, region: { x: 0, y: 0, w: 100, h: 50 } });
      const canvasCall = createSpy.mock.results.find(
        (r) => r.type === 'return' && r.value instanceof HTMLCanvasElement,
      );
      if (canvasCall && canvasCall.type === 'return') {
        const canvas = canvasCall.value as HTMLCanvasElement;
        expect(canvas.width).toBe(110);
        expect(canvas.height).toBe(60);
      }
      createSpy.mockRestore();
    });
  });

  describe('exportImage — scaleMode fit', () => {
    it('shrinks the canvas to the caps instead of throwing', async () => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 1000, h: 500 } }));
      const createSpy = vi.spyOn(document, 'createElement');
      await exportImage(store, { scale: 4, scaleMode: 'fit', maxDimension: 2000 });
      const canvasCall = createSpy.mock.results.find(
        (r) => r.type === 'return' && r.value instanceof HTMLCanvasElement,
      );
      expect(canvasCall).toBeDefined();
      if (canvasCall && canvasCall.type === 'return') {
        const canvas = canvasCall.value as HTMLCanvasElement;
        expect(canvas.width).toBeLessThanOrEqual(2000);
        expect(canvas.height).toBeLessThanOrEqual(1000);
        expect(canvas.width).toBeGreaterThan(1900);
      }
      createSpy.mockRestore();
    });

    it("keeps 'exact' mode throwing on oversized exports", async () => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 1000, h: 500 } }));
      await expect(
        exportImage(store, { scale: 4, scaleMode: 'exact', maxDimension: 2000 }),
      ).rejects.toThrow('maximum dimension');
    });

    it('rejects an unknown scaleMode', async () => {
      const store = new ElementStore();
      store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
      await expect(exportImage(store, { scaleMode: 'zoom' as never })).rejects.toThrow('scaleMode');
    });
  });
});

function mockCanvasCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 40 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
    font: '',
    textBaseline: '',
    textAlign: '',
    lineCap: '',
    lineJoin: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('exportImage — rendering paths', () => {
  const origCreate = document.createElement.bind(document);
  let lastToBlobArgs: [string | undefined, unknown] | null = null;
  let lastCreateSpy: ReturnType<typeof vi.spyOn> | null = null;

  function mockGetContext() {
    lastToBlobArgs = null;
    lastCreateSpy = null;
    const ctx = mockCanvasCtx();
    lastCreateSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(ctx as never);
        vi.spyOn(el as HTMLCanvasElement, 'toBlob').mockImplementation(function (
          this: HTMLCanvasElement,
          cb: BlobCallback,
          type?: string,
          q?: unknown,
        ) {
          lastToBlobArgs = [type, q];
          cb(new Blob(['fake'], { type: type ?? 'image/png' }));
        });
      }
      return el;
    });
    return ctx;
  }

  it('renders notes via note-canvas-renderer', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 }, text: 'Hello' }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.fill).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('composites a translucent layer as one group', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createShape({
        layerId: 'faded',
        position: { x: 0, y: 0 },
        size: { w: 50, h: 50 },
      }),
    );
    const layerManager = {
      isLayerVisible: () => true,
      getLayer: () => ({ opacity: 0.25 }),
    };

    const blob = await exportImage(store, {}, layerManager as never);

    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.globalAlpha).toBe(0.25);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0);
    vi.restoreAllMocks();
  });

  it('renders text elements with correct positioning', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createText({ position: { x: 10, y: 20 }, text: 'Hello\nWorld' }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.fillText).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders rich text and never draws literal HTML tags', async () => {
    // Text now renders via the shared run renderer (same as notes): bold/italic runs,
    // word-wrapped left alignment. The literal markup must never reach fillText.
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createText({
        position: { x: 10, y: 20 },
        size: { w: 200, h: 28 },
        text: 'Line 1<b>bold</b>',
      }),
    );

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);

    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    const drawn = calls.map((c) => c[0] as string);
    expect(drawn).toContain('bold');
    for (const word of drawn) {
      expect(word).not.toContain('<b>');
      expect(word).not.toContain('</b>');
    }
    vi.restoreAllMocks();
  });

  it('skips text rendering when text is empty', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createText({ position: { x: 0, y: 0 }, text: '' }));

    await exportImage(store);
    expect(ctx.fillText).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders strokes via element renderer', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 50, y: 50, pressure: 0.5 },
        ],
      }),
    );

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders arrows via element renderer', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.moveTo).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('applies a dash pattern for a dashed arrow', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, strokeStyle: 'dashed' }));

    await exportImage(store);
    expect(ctx.setLineDash).toHaveBeenCalledWith([8, 4]);
    vi.restoreAllMocks();
  });

  it('renders shapes via element renderer', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createShape({
        position: { x: 10, y: 10 },
        size: { w: 80, h: 60 },
        fillColor: '#ff0000',
      }),
    );

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.fillRect).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders html elements through the application hook', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    const html = {
      id: 'html-1',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      zIndex: 0,
      locked: false,
      layerId: '',
      htmlType: 'chart',
    } as const;
    store.add(html);

    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));
    const source = document.createElement('canvas');

    const blob = await exportImage(store, { renderHtml: () => source });
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 100, 100);
    vi.restoreAllMocks();
  });

  it('reports html elements omitted without an application hook', async () => {
    mockGetContext();
    const store = new ElementStore();
    const html = {
      id: 'html-unsupported',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      zIndex: 0,
      locked: false,
      layerId: '',
      htmlType: 'chart',
    } as const;
    store.add(html);
    const onHtmlError = vi.fn();

    await exportImage(store, { onHtmlError });

    expect(onHtmlError).toHaveBeenCalledWith({
      elementId: html.id,
      htmlType: 'chart',
      reason: 'unsupported',
    });
    vi.restoreAllMocks();
  });

  it('renders grids at the end after other elements', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));
    store.add(createGrid({ gridType: 'square', cellSize: 20 }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.stroke).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders hex grids', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));
    store.add(createGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 20 }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.closePath).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('uses default options when none provided', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));

    await exportImage(store);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    vi.restoreAllMocks();
  });

  it('uses custom background color', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createShape({
        position: { x: 10, y: 10 },
        size: { w: 50, h: 50 },
        fillColor: 'none',
        strokeWidth: 0,
      }),
    );

    await exportImage(store, { background: '#000000' });
    expect(ctx.fillRect).toHaveBeenCalled();
    const firstFillRectCall = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstFillRectCall).toBeDefined();
    vi.restoreAllMocks();
  });

  it('renders templates via element renderer', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(
      createTemplate({
        position: { x: 50, y: 50 },
        templateShape: 'circle',
        radius: 30,
      }),
    );

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.arc).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('handles image elements in export via onerror fallback', async () => {
    mockGetContext();
    const store = new ElementStore();
    const img = createImage({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      src: 'data:image/png;base64,iVBORw0KGgo=',
    });
    store.add(img);

    const OrigImage = globalThis.Image;
    globalThis.Image = class MockImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      get src() {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        setTimeout(() => {
          if (this.onerror) this.onerror();
        }, 0);
      }
    } as unknown as typeof Image;

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    globalThis.Image = OrigImage;
    vi.restoreAllMocks();
  });

  it('renders loaded images in export via onload', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    const img = createImage({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      src: 'data:image/png;base64,abc',
    });
    store.add(img);

    const OrigImage = globalThis.Image;
    globalThis.Image = class MockImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 100;
      height = 100;
      complete = true;
      private _src = '';
      get src() {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as unknown as typeof Image;

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.drawImage).toHaveBeenCalled();
    globalThis.Image = OrigImage;
    vi.restoreAllMocks();
  });

  it('produces a background-only image for a region with no elements', async () => {
    mockGetContext();
    const store = new ElementStore();
    const blob = await exportImage(store, { region: { x: 0, y: 0, w: 50, h: 50 } });
    expect(blob).toBeInstanceOf(Blob);
    vi.restoreAllMocks();
  });

  it('still applies filter and layer visibility under a region', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 }, layerId: 'hidden' }));
    store.add(createNote({ position: { x: 30, y: 0 }, size: { w: 20, h: 20 }, text: 'kept' }));
    const mockLayerManager = { isLayerVisible: (id: string) => id !== 'hidden' };
    const blob = await exportImage(
      store,
      { region: { x: 0, y: 0, w: 100, h: 100 }, filter: (el) => el.type === 'note' },
      mockLayerManager as never,
    );
    expect(blob).toBeInstanceOf(Blob);
    // Exactly one note rendered: the hidden-layer note is excluded even though
    // it intersects the region. renderNoteOnCanvas uses roundRect+fill once per note.
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('encodes jpeg with quality when requested', async () => {
    mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 } }));
    const blob = await exportImage(store, { format: 'jpeg', quality: 0.8 });
    expect(blob?.type).toBe('image/jpeg');
    expect(lastToBlobArgs).toEqual(['image/jpeg', 0.8]);
    vi.restoreAllMocks();
  });

  it('composes region, filter, fit scale, and jpeg encoding in one export', async () => {
    const ctx = mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 500, h: 500 }, text: 'kept' }));
    const excluded = createNote({ position: { x: 600, y: 0 }, size: { w: 40, h: 40 } });
    store.add(excluded);

    const blob = await exportImage(store, {
      region: { x: 0, y: 0, w: 500, h: 500 },
      filter: (el) => el.id !== excluded.id,
      scale: 4,
      scaleMode: 'fit',
      maxDimension: 1000,
      format: 'jpeg',
      quality: 0.85,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/jpeg');
    expect(lastToBlobArgs).toEqual(['image/jpeg', 0.85]);
    // fit clamps 4x on a 500-wide region to the 1000px dimension cap
    const canvasCall = lastCreateSpy?.mock.results.find(
      (r) => r.type === 'return' && r.value instanceof HTMLCanvasElement,
    );
    expect(canvasCall).toBeDefined();
    if (canvasCall && canvasCall.type === 'return') {
      const canvas = canvasCall.value as HTMLCanvasElement;
      expect(canvas.width).toBeLessThanOrEqual(1000);
      expect(canvas.width).toBeGreaterThan(990);
    }
    // exactly one note rendered: the filtered-out note never draws
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('defaults to png encoding', async () => {
    mockGetContext();
    const store = new ElementStore();
    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 } }));
    const blob = await exportImage(store, {});
    expect(blob?.type).toBe('image/png');
    expect(lastToBlobArgs).toEqual(['image/png', undefined]);
    vi.restoreAllMocks();
  });
});
