// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { computeBounds, getElementRect, exportImage } from './export-image';
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

  function mockGetContext() {
    const ctx = mockCanvasCtx();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(ctx as never);
        vi.spyOn(el as HTMLCanvasElement, 'toBlob').mockImplementation((cb) => {
          cb(new Blob(['fake'], { type: 'image/png' }));
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

  it('skips html elements', async () => {
    mockGetContext();
    const store = new ElementStore();
    store.add({
      id: 'html-1',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      zIndex: 0,
      locked: false,
      layerId: '',
    } as never);

    store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }));

    const blob = await exportImage(store);
    expect(blob).toBeInstanceOf(Blob);
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
});
