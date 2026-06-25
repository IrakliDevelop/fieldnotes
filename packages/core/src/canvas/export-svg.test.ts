// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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

const HTML_MARKER = 'data-distinctive-html-marker-xyz';

function htmlEl() {
  return {
    id: 'html-1',
    type: 'html' as const,
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    zIndex: 0,
    locked: false,
    layerId: '',
    html: `<div>${HTML_MARKER}</div>`,
  } as never;
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

  it('emits text elements per line', async () => {
    const store = buildStore();
    const svg = await exportSvg(store);
    expect(svg).toContain('<text');
    expect(svg).toContain('>Hello<');
    expect(svg).toContain('>World<');
    expect(svg).toContain('fill="#123456"');
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

    const path = svg.match(/<path d="M[^"]*L([\d.]+) ([\d.]+)"[^>]*stroke-dasharray/);
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
