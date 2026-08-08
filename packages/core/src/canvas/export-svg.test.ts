// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { exportSvg } from './export-svg';
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
import { HtmlPainterRegistry, HtmlPainterMissingError } from './html-painter-registry';
import type { HtmlElement } from '../elements/types';

const HTML_MARKER = 'data-distinctive-html-marker-xyz';

function htmlEl(): HtmlElement {
  return {
    id: 'html-1',
    type: 'html' as const,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    zIndex: 0,
    locked: false,
    layerId: '',
    htmlType: 'chart',
    data: { marker: HTML_MARKER },
  };
}

function buildStore() {
  const store = new ElementStore();
  store.add(
    createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 50, pressure: 0.5 },
      ],
      position: { x: 0, y: 0 },
      width: 4,
    }),
  );
  store.add(
    createShape({
      position: { x: 100, y: 100 },
      size: { w: 80, h: 60 },
      shape: 'rectangle',
      fillColor: '#ff0000',
    }),
  );
  store.add(createArrow({ from: { x: 200, y: 200 }, to: { x: 300, y: 250 } }));
  store.add(createText({ position: { x: 0, y: 200 }, text: 'Hello\nWorld', color: '#123456' }));
  store.add(createNote({ position: { x: 400, y: 0 }, size: { w: 120, h: 80 }, text: 'Note' }));
  store.add(
    createImage({
      position: { x: 0, y: 400 },
      size: { w: 100, h: 100 },
      src: 'data:image/png;base64,iVBORw0KGgo=',
    }),
  );
  store.add(htmlEl());
  return store;
}

describe('exportSvg', () => {
  it.each([
    [{ padding: -1 }, 'padding'],
    [{ rasterScale: 0 }, 'rasterScale'],
    [{ maxDimension: Number.POSITIVE_INFINITY }, 'maxDimension'],
    [{ htmlTimeoutMs: 0 }, 'htmlTimeoutMs'],
  ])('rejects invalid options %o', async (options, optionName) => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }));
    await expect(exportSvg(store, options)).rejects.toThrow(optionName);
  });

  it('rejects output exceeding its configured size limits', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
    await expect(exportSvg(store, { maxPixels: 9_999 })).rejects.toThrow('maximum of 9999 pixels');
  });

  it('wraps exported elements in their layer opacity', async () => {
    const store = new ElementStore();
    store.add(createShape({ layerId: 'faded', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
    const layerManager = {
      isLayerVisible: () => true,
      getLayer: () => ({ opacity: 0.25 }),
    };

    const svg = await exportSvg(store, {}, layerManager as never);

    expect(svg).toContain('<g opacity="0.25"><rect');
  });

  it('returns an empty svg for an empty store', async () => {
    const svg = await exportSvg(new ElementStore());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 0 0"');
  });

  it('produces a well-formed svg with a viewBox reflecting content + padding', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { background: '#fff', padding: 10 });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

    const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
    expect(vb).not.toBeNull();
    if (vb) {
      const x = Number(vb[1]);
      const y = Number(vb[2]);
      const w = Number(vb[3]);
      const h = Number(vb[4]);
      // content spans roughly x:[0..520], y:[0..500]; padding 10 pushes origin negative
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(w).toBeGreaterThan(500);
      expect(h).toBeGreaterThan(450);
    }
  });

  it('emits a background rect when background is provided', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { background: '#fff' });
    expect(svg).toMatch(/<rect[^>]*fill="#fff"/);
  });

  it('emits paths for stroke and arrow', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toContain('<path');
    // arrowhead polygon
    expect(svg).toContain('<polygon');
  });

  it('emits a rect for the rectangle shape', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toMatch(/<rect[^>]*fill="#ff0000"/);
  });

  it('rasterizes text elements to an <image> and never emits literal HTML tags', async () => {
    // Text now renders RICH via the shared canvas renderer, rasterized to a data-URI
    // <image> (like notes). Under a working canvas it is an <image>; under jsdom's
    // null-context degradation the text is simply skipped — either way no raw <text>
    // node carrying the literal markup is emitted.
    const store = new ElementStore();
    store.add(
      createText({
        position: { x: 0, y: 200 },
        size: { w: 200, h: 60 },
        text: 'Line 1<b>bold</b>',
        color: '#123456',
      }),
    );

    const origCreate = document.createElement.bind(document);
    const ctxStub = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 40 }),
      fillStyle: '',
      font: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(ctxStub as never);
        vi.spyOn(el as HTMLCanvasElement, 'toDataURL').mockReturnValue(
          'data:image/png;base64,AAAA',
        );
      }
      return el;
    });

    const svg = await exportSvg(store);
    vi.restoreAllMocks();

    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
    // No raw <text> emitter and no literal/escaped markup leaking into the SVG.
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('&lt;b&gt;');
  });

  it('emits an image element (data-uri passthrough)', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('excludes html embeds', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).not.toContain(HTML_MARKER);
  });

  it('embeds html renderer output as a rotated raster image', async () => {
    const store = new ElementStore();
    const html = htmlEl();
    html.rotation = Math.PI / 2;
    store.add(html);
    const source = document.createElement('canvas');
    const originalCreate = document.createElement.bind(document);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = originalCreate(tag);
      if (tag === 'canvas') {
        vi.spyOn(node as HTMLCanvasElement, 'getContext').mockReturnValue(ctx as never);
        vi.spyOn(node as HTMLCanvasElement, 'toDataURL').mockReturnValue(
          'data:image/png;base64,HTML',
        );
      }
      return node;
    });

    const svg = await exportSvg(store, { renderHtml: () => source });
    vi.restoreAllMocks();

    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 200, 200);
    expect(svg).toContain('data:image/png;base64,HTML');
    expect(svg).toMatch(/<g transform="rotate\(90 /);
  });

  it('snaps a bound arrow endpoint to the target edge, not its raw center', async () => {
    const store = new ElementStore();
    // Note spans x:[300..400], y:[180..220]; its center is (350, 200).
    const note = createNote({ position: { x: 300, y: 180 }, size: { w: 100, h: 40 } });
    store.add(note);
    // Arrow comes in horizontally from the left, terminating at the note CENTER.
    const arrow = createArrow({ from: { x: 100, y: 200 }, to: { x: 350, y: 200 } });
    arrow.toBinding = { elementId: note.id };
    store.add(arrow);

    const svg = await exportSvg(store);

    // Binding no longer forces dashing — a bound arrow with no strokeStyle is SOLID.
    expect(svg).not.toContain('stroke-dasharray');

    const path = svg.match(/<path d="M[^"]*L([\d.]+) ([\d.]+)"/);
    expect(path).not.toBeNull();
    if (path) {
      const endX = Number(path[1]);
      const endY = Number(path[2]);
      // Snapped to the left edge of the note (x≈300), NOT the raw center (x=350).
      expect(endX).toBeCloseTo(300, 0);
      expect(endX).toBeLessThan(350);
      expect(endY).toBeCloseTo(200, 0);
    }

    // The arrowhead polygon tip sits at the snapped endpoint too, not the center.
    const poly = svg.match(/<polygon points="([\d.]+),([\d.]+)/);
    expect(poly).not.toBeNull();
    if (poly) {
      expect(Number(poly[1])).toBeCloseTo(300, 0);
      expect(Number(poly[1])).toBeLessThan(350);
    }
  });

  it('emits stroke-dasharray="8 4" for a dashed arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'dashed' }));
    const svg = await exportSvg(store);
    expect(svg).toContain('stroke-dasharray="8 4"');
  });

  it('emits stroke-dasharray="2 4" for a dotted arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'dotted' }));
    const svg = await exportSvg(store);
    expect(svg).toContain('stroke-dasharray="2 4"');
  });

  it('omits stroke-dasharray for a solid arrow', async () => {
    const store = new ElementStore();
    store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, strokeStyle: 'solid' }));
    const svg = await exportSvg(store);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('renders a bound solid arrow without dasharray (decoupled from binding)', async () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 300, y: 180 }, size: { w: 100, h: 40 } });
    store.add(note);
    const arrow = createArrow({ from: { x: 100, y: 200 }, to: { x: 350, y: 200 } });
    arrow.toBinding = { elementId: note.id };
    store.add(arrow);
    const svg = await exportSvg(store);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('emits a grid path', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
    store.add(createGrid({ gridType: 'square', cellSize: 20 }));
    const svg = await exportSvg(store);
    expect(svg).toContain('<path');
  });

  it('emits a hex grid path', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
    store.add(createGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 20 }));
    const svg = await exportSvg(store);
    expect(svg).toContain('<path');
  });

  it('emits a geometric circle template', async () => {
    const store = new ElementStore();
    store.add(
      createTemplate({ position: { x: 100, y: 100 }, templateShape: 'circle', radius: 30 }),
    );
    const svg = await exportSvg(store);
    expect(svg).toContain('<circle');
  });

  it('wraps rotated elements in a rotation group', async () => {
    const store = new ElementStore();
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    shape.rotation = Math.PI / 2;
    store.add(shape);
    const svg = await exportSvg(store);
    expect(svg).toMatch(/<g transform="rotate\(90 /);
  });

  it('respects the filter option', async () => {
    const store = buildStore();
    const svg = await exportSvg(store, { filter: (el) => el.type === 'shape' });
    expect(svg).toMatch(/<rect[^>]*fill="#ff0000"/);
    expect(svg).not.toContain('<polygon');
  });

  it('skips elements on hidden layers', async () => {
    const store = new ElementStore();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, layerId: 'hidden' }));
    store.add(
      createShape({
        position: { x: 200, y: 200 },
        size: { w: 50, h: 50 },
        fillColor: '#00ff00',
        layerId: 'visible',
      }),
    );
    const layerManager = { isLayerVisible: (id: string) => id === 'visible' };
    const svg = await exportSvg(store, {}, layerManager as never);
    expect(svg).toMatch(/<rect[^>]*fill="#00ff00"/);
    // hidden shape would sit at origin; visible shape at 200,200 — viewBox origin near 200
    const vb = svg.match(/viewBox="([\d.]+) ([\d.]+)/);
    expect(vb).not.toBeNull();
    if (vb) {
      expect(Number(vb[1])).toBeGreaterThanOrEqual(200);
    }
  });

  it('degrades note to a background-color rect when canvas raster is unavailable (jsdom)', async () => {
    // jsdom canvas.getContext returns null, so the note emitter falls back to a
    // colored placeholder rect rather than a rasterized <image>.
    const store = new ElementStore();
    store.add(
      createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 60 },
        backgroundColor: '#abcabc',
        text: 'x',
      }),
    );
    const svg = await exportSvg(store);
    // Either a rasterized image (if canvas works) or a placeholder rect.
    const hasImage = svg.includes('<image');
    const hasPlaceholder = /<rect[^>]*fill="#abcabc"/.test(svg);
    expect(hasImage || hasPlaceholder).toBe(true);
  });
});

// --- canvas-routed html raster helpers -------------------------------------------------
//
// jsdom's HTMLCanvasElement.getContext('2d') returns null (no `canvas` npm package is
// installed in this workspace — confirmed via `pnpm ls canvas -r`), so real pixel
// rasterization is unavailable. To genuinely test "did the localizing transform run"
// rather than merely "was fillRect called with plausible-looking arguments", the mock
// below implements a small software affine-transform + pixel-buffer simulation: it tracks
// the real cumulative matrix through save/scale/translate/rotate calls exactly as a real
// CanvasRenderingContext2D would, and fillRect marks pixels in a same-sized buffer only
// where that matrix actually places them. A missing localizing translate therefore maps
// fillRect's coordinates outside the buffer for real, not by assertion — the resulting
// data URI (still prefixed `data:image/png;base64,` so it matches the SVG's <image> href
// regex) carries a JSON-encoded alpha buffer that `opaquePixelRatio` decodes and measures.

interface FakeMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const FAKE_IDENTITY: FakeMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function matMul(m1: FakeMatrix, m2: FakeMatrix): FakeMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function matApply(m: FakeMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// This file always runs under `@vitest-environment jsdom` (see the top-of-file pragma),
// so the browser-global btoa/atob are always present — no Node Buffer fallback needed.
function toBase64(json: string): string {
  return btoa(json);
}

function fromBase64(encoded: string): string {
  return atob(encoded);
}

/** Builds a fake 2D context + matching toDataURL backed by a real simulated pixel buffer. */
function createFakeRasterContext(
  width: number,
  height: number,
  rotateLog: number[],
): { ctx: CanvasRenderingContext2D; toDataURL: () => string } {
  const alpha = new Uint8ClampedArray(Math.max(0, width * height));
  let current: FakeMatrix = FAKE_IDENTITY;
  const stack: FakeMatrix[] = [];
  let globalAlpha = 1;

  const ctx = {
    save: () => stack.push(current),
    restore: () => {
      const m = stack.pop();
      if (m) current = m;
    },
    scale: (sx: number, sy: number) => {
      current = matMul(current, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    translate: (dx: number, dy: number) => {
      current = matMul(current, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
    },
    rotate: (theta: number) => {
      rotateLog.push(theta);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      current = matMul(current, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
    },
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: (x: number, y: number, w: number, h: number) => {
      const corners = [
        matApply(current, x, y),
        matApply(current, x + w, y),
        matApply(current, x, y + h),
        matApply(current, x + w, y + h),
      ];
      const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
      const maxX = Math.min(width, Math.ceil(Math.max(...corners.map((c) => c.x))));
      const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
      const maxY = Math.min(height, Math.ceil(Math.max(...corners.map((c) => c.y))));
      for (let py = minY; py < maxY; py++) {
        for (let px = minX; px < maxX; px++) {
          alpha[py * width + px] = 255;
        }
      }
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    fillStyle: '#000000',
  } as unknown as CanvasRenderingContext2D;

  const toDataURL = (): string => {
    const payload = JSON.stringify({ width, height, alpha: Array.from(alpha) });
    return `data:image/png;base64,${toBase64(payload)}`;
  };

  return { ctx, toDataURL };
}

/** Fraction of pixels with nonzero alpha in a data URI produced by createFakeRasterContext. */
async function opaquePixelRatio(dataUri: string): Promise<number> {
  const commaIndex = dataUri.indexOf(',');
  const base64 = commaIndex === -1 ? '' : dataUri.slice(commaIndex + 1);
  const parsed = JSON.parse(fromBase64(base64)) as { alpha: number[] };
  if (parsed.alpha.length === 0) return 0;
  const opaque = parsed.alpha.filter((a) => a > 0).length;
  return opaque / parsed.alpha.length;
}

/** Routes every `document.createElement('canvas')` to a fake raster context/buffer.
 *  Returns the rotate-call log (shared across every canvas created while installed,
 *  since these tests only ever raster one html element at a time) and a restore fn. */
function installFakeRasterCanvas(): { rotateLog: number[]; restore: () => void } {
  const rotateLog: number[] = [];
  const origCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const node = origCreate(tag);
    if (tag === 'canvas') {
      const canvasEl = node as HTMLCanvasElement;
      vi.spyOn(canvasEl, 'getContext').mockImplementation(() => {
        const { ctx, toDataURL } = createFakeRasterContext(
          canvasEl.width,
          canvasEl.height,
          rotateLog,
        );
        vi.spyOn(canvasEl, 'toDataURL').mockImplementation(toDataURL);
        return ctx as never;
      });
    }
    return node;
  });
  return { rotateLog, restore: () => spy.mockRestore() };
}

function markerElement(overrides: Partial<HtmlElement> = {}): HtmlElement {
  return {
    id: 'marker-1',
    type: 'html',
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    zIndex: 0,
    locked: false,
    layerId: '',
    htmlType: 'rk-marker',
    ...overrides,
  };
}

function storeWith(el: HtmlElement): ElementStore {
  const store = new ElementStore();
  store.add(el);
  return store;
}

/** A registry with an active painter for `htmlType` that does nothing (pixel-agnostic). */
function registryWith(htmlType: string): HtmlPainterRegistry {
  const registry = new HtmlPainterRegistry();
  registry.expect([htmlType]);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  registry.register(htmlType, () => {});
  return registry;
}

function layersWithOpacity(opacity: number): {
  isLayerVisible: () => boolean;
  getLayer: () => { opacity: number };
} {
  return {
    isLayerVisible: () => true,
    getLayer: () => ({ opacity }),
  };
}

describe('exportSvg canvas-routed html', () => {
  it('rasterises a marker at a NONZERO position into non-blank pixels', async () => {
    // Discriminating: a missing localizing transform paints outside the offscreen
    // canvas and yields a fully transparent raster, which an <image>-presence
    // assertion alone would happily accept.
    const { restore } = installFakeRasterCanvas();
    try {
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', ({ ctx, size }) => {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, size.w, size.h);
      });
      const el = markerElement({ position: { x: 640, y: 480 } });
      const svg = await exportSvg(storeWith(el), { htmlPainters: registry });
      const dataUri = /href="(data:image\/[^"]+)"/.exec(svg)?.[1];
      if (dataUri === undefined) throw new Error('expected an embedded raster data URI');
      expect(await opaquePixelRatio(dataUri)).toBeGreaterThan(0.9);
    } finally {
      restore();
    }
  });

  it('does not double-apply rotation: the raster is unrotated, the <image> carries rotate()', async () => {
    const { rotateLog, restore } = installFakeRasterCanvas();
    try {
      const svg = await exportSvg(storeWith(markerElement({ rotation: 0.3 })), {
        htmlPainters: registryWith('rk-marker'),
      });
      expect(svg).toContain('<image');
      expect(svg).toMatch(/rotate\(/);
      expect(rotateLog.length).toBe(0); // spy installed on the offscreen context
    } finally {
      restore();
    }
  });

  it('wraps a translucent layer once in a <g opacity> and not in the raster', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      // Poison value: if the painter never runs (e.g. the marker is silently dropped
      // instead of routed to canvas), this stays -1 and the assertion fails — it must
      // not be able to pass just because nothing ran.
      let observed = -1;
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', ({ ctx }) => {
        observed = ctx.globalAlpha;
      });
      const svg = await exportSvg(
        storeWith(markerElement()),
        { htmlPainters: registry },
        layersWithOpacity(0.5) as never,
      );
      expect(observed).toBe(1);
      expect(svg).toContain('<g opacity="0.5">');
    } finally {
      restore();
    }
  });

  it('throws HtmlPainterMissingError under strictMissingCanvasHtml', async () => {
    await expect(
      exportSvg(storeWith(markerElement()), {
        expectedCanvasTypes: new Set(['rk-marker']),
        strictMissingCanvasHtml: true,
      }),
    ).rejects.toBeInstanceOf(HtmlPainterMissingError);
  });

  it('reports missing-painter without throwing when strict is off', async () => {
    const onHtmlError = vi.fn();
    const svg = await exportSvg(storeWith(markerElement()), {
      expectedCanvasTypes: new Set(['rk-marker']),
      onHtmlError,
    });
    expect(svg).not.toContain('<image');
    expect(onHtmlError).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'marker-1', reason: 'missing-painter' }),
    );
  });

  it('does NOT ask renderHtml for canvas-routed elements', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const renderHtml = vi.fn();
      await exportSvg(storeWith(markerElement()), {
        htmlPainters: registryWith('rk-marker'),
        renderHtml,
      });
      expect(renderHtml).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  // Supplementary to the brief's Step 1 list (mirrors A7's export-image coverage):
  // Step 3 also requires forwarding paintHtmlElement's own diagnostics into onHtmlError
  // with matching reasons — verify the wiring, not just the routing.
  it('forwards a painter-threw diagnostic to onHtmlError with the cause', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const boom = new Error('boom');
      const registry = new HtmlPainterRegistry();
      registry.expect(['rk-marker']);
      registry.register('rk-marker', () => {
        throw boom;
      });
      const onHtmlError = vi.fn();
      const svg = await exportSvg(storeWith(markerElement()), {
        htmlPainters: registry,
        onHtmlError,
      });
      // The offscreen canvas is still encoded (blank) even though the painter threw.
      expect(svg).toContain('<image');
      expect(onHtmlError).toHaveBeenCalledWith({
        elementId: 'marker-1',
        htmlType: 'rk-marker',
        reason: 'painter-threw',
        cause: boom,
      });
    } finally {
      restore();
    }
  });

  it('forwards a degenerate-size diagnostic to onHtmlError without invoking the painter', async () => {
    const { restore } = installFakeRasterCanvas();
    try {
      const registry = registryWith('rk-marker');
      const painted = vi.fn();
      registry.register('rk-marker', painted);
      const onHtmlError = vi.fn();
      // A zero-width marker alone would collapse export bounds to 0×h and fail dimension
      // validation before painting is ever reached; a normal shape keeps the overall
      // canvas non-degenerate so the diagnostic path under test is exercised.
      const store = new ElementStore();
      store.add(createShape({ position: { x: 200, y: 200 }, size: { w: 50, h: 50 } }));
      store.add(markerElement({ size: { w: 0, h: 100 } }));
      // The raster still encodes (blank) for a degenerate element, same as A7's
      // exportImage — 'degenerate-size' is a paint-time diagnostic, not an encode
      // failure, so the assertions that matter are: painter untouched, diagnostic fired.
      await exportSvg(store, { htmlPainters: registry, onHtmlError });
      expect(painted).not.toHaveBeenCalled();
      expect(onHtmlError).toHaveBeenCalledWith(
        expect.objectContaining({ elementId: 'marker-1', reason: 'degenerate-size' }),
      );
    } finally {
      restore();
    }
  });
});
