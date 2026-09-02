// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { RemoteCursorOverlay, defaultPeerColor, PEER_COLORS } from './remote-cursor-overlay';
import type { RemoteCursorOverlayHost } from './remote-cursor-overlay';
import { PeerRoster } from './awareness-roster';
import type { OverlayRenderer } from './render-loop';

interface Recorded {
  texts: string[];
  fills: string[];
  translates: [number, number][];
  scales: [number, number][];
  calls: string[];
}

function makeCtx(): { ctx: CanvasRenderingContext2D; rec: Recorded } {
  const rec: Recorded = { texts: [], fills: [], translates: [], scales: [], calls: [] };
  let fillStyle = '';
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(() => {
      rec.calls.push('fill');
      rec.fills.push(fillStyle);
    }),
    fillText: vi.fn((text: string) => {
      rec.calls.push('fillText');
      rec.texts.push(text);
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    translate: vi.fn((x: number, y: number) => {
      rec.calls.push('translate');
      rec.translates.push([x, y]);
    }),
    scale: vi.fn((x: number, y: number) => {
      rec.calls.push('scale');
      rec.scales.push([x, y]);
    }),
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

function makeHost(zoom = 1): {
  host: RemoteCursorOverlayHost;
  getRenderer: () => OverlayRenderer | null;
  requestRender: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
} {
  let renderer: OverlayRenderer | null = null;
  const unregister = vi.fn(() => {
    renderer = null;
  });
  const requestRender = vi.fn();
  return {
    host: {
      registerOverlay: (draw) => {
        renderer = draw;
        return unregister;
      },
      requestRender,
      camera: { zoom },
    },
    getRenderer: () => renderer,
    requestRender,
    unregister,
  };
}

const frame = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'awareness',
  id,
  ...extra,
});

describe('defaultPeerColor', () => {
  it('is deterministic, drawn from the palette, and spreads distinct ids', () => {
    expect(defaultPeerColor('ada')).toBe(defaultPeerColor('ada'));
    expect(PEER_COLORS).toContain(defaultPeerColor('ada'));
    expect(PEER_COLORS).toHaveLength(12);
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(defaultPeerColor));
    expect(seen.size).toBeGreaterThan(3);
    expect(defaultPeerColor('')).toBe(PEER_COLORS[0]);
  });
});

describe('RemoteCursorOverlay', () => {
  it('draws only peers with a cursor, at the world point, scaled by 1/zoom, with the raw name as text', () => {
    const roster = new PeerRoster();
    const { host, getRenderer } = makeHost(2);
    const overlay = new RemoteCursorOverlay(host, roster);
    roster.apply('c1', frame('ada', { name: '<b>Ada</b>', cursor: { x: 10, y: 20 } }));
    roster.apply('c2', frame('bob', { name: 'Bob' }));
    const { ctx, rec } = makeCtx();
    getRenderer()?.(ctx);
    expect(rec.translates).toEqual([[10, 20]]);
    expect(rec.scales).toEqual([[0.5, 0.5]]);
    expect(rec.texts).toEqual(['<b>Ada</b>']);
    // Order matters: `translate` must move the origin to the cursor's world
    // point BEFORE `scale` shrinks the glyph by 1/zoom. Swapping them would
    // scale the translation itself, drawing the glyph at the wrong point.
    expect(rec.calls.indexOf('translate')).toBeLessThan(rec.calls.indexOf('scale'));
    expect(rec.calls.indexOf('scale')).toBeLessThan(rec.calls.indexOf('fill'));
    overlay.dispose();
  });

  it.each([0, NaN])('falls back to scale 1 when zoom is %s', (zoom) => {
    const roster = new PeerRoster();
    const { host, getRenderer } = makeHost(zoom);
    const overlay = new RemoteCursorOverlay(host, roster);
    roster.apply('c1', frame('ada', { cursor: { x: 5, y: 5 } }));
    const { ctx, rec } = makeCtx();
    getRenderer()?.(ctx);
    expect(rec.scales).toEqual([[1, 1]]);
    overlay.dispose();
  });

  it('resolves colour as colorFor → wire color → defaultPeerColor(id)', () => {
    const roster = new PeerRoster();
    const { host, getRenderer } = makeHost();
    const overlay = new RemoteCursorOverlay(host, roster, {
      colorFor: (peer) => (peer.id === 'dm' ? '#000001' : undefined),
    });
    roster.apply('a', frame('dm', { color: '#ff0000', cursor: { x: 0, y: 0 } }));
    roster.apply('b', frame('ada', { color: '#00ff00', cursor: { x: 0, y: 0 } }));
    roster.apply('c', frame('cy', { cursor: { x: 0, y: 0 } }));
    const peers = roster.getPeers();
    expect(peers.map((p) => overlay.resolveColor(p))).toEqual([
      '#000001',
      '#00ff00',
      defaultPeerColor('cy'),
    ]);
    const { ctx, rec } = makeCtx();
    getRenderer()?.(ctx);
    expect(rec.fills).toContain('#000001');
    expect(rec.fills).toContain('#00ff00');
    expect(rec.fills).toContain(defaultPeerColor('cy'));
    overlay.dispose();
  });

  it('showLabels: false skips the label entirely', () => {
    const roster = new PeerRoster();
    const { host, getRenderer } = makeHost();
    const overlay = new RemoteCursorOverlay(host, roster, { showLabels: false });
    roster.apply('c1', frame('ada', { name: 'Ada', cursor: { x: 1, y: 1 } }));
    const { ctx, rec } = makeCtx();
    getRenderer()?.(ctx);
    expect(rec.texts).toEqual([]);
    overlay.dispose();
  });

  it('requests a render on roster change and caches text metrics per name+font', () => {
    const roster = new PeerRoster();
    const { host, getRenderer, requestRender } = makeHost();
    const overlay = new RemoteCursorOverlay(host, roster);
    requestRender.mockClear();
    roster.apply('c1', frame('ada', { name: 'Ada', cursor: { x: 1, y: 1 } }));
    expect(requestRender).toHaveBeenCalledTimes(1);
    const { ctx } = makeCtx();
    getRenderer()?.(ctx);
    roster.apply('c1', frame('ada', { name: 'Ada', cursor: { x: 2, y: 2 } }));
    getRenderer()?.(ctx);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it('clears the label-width cache once it grows past 64 entries, instead of caching unboundedly', () => {
    const roster = new PeerRoster();
    const { host, getRenderer } = makeHost();
    const overlay = new RemoteCursorOverlay(host, roster);
    for (let i = 0; i < 70; i++) {
      roster.apply(`c${i}`, frame(`p${i}`, { name: `name${i}`, cursor: { x: i, y: i } }));
    }
    const { ctx } = makeCtx();
    getRenderer()?.(ctx);
    expect(ctx.measureText).toHaveBeenCalledTimes(70);
    // Crossing the 64-entry bound on the next roster change clears the whole
    // cache, so every peer (now 71) is re-measured on the next render.
    roster.apply('c70', frame('p70', { name: 'name70', cursor: { x: 70, y: 70 } }));
    getRenderer()?.(ctx);
    expect(ctx.measureText).toHaveBeenCalledTimes(70 + 71);
    overlay.dispose();
  });

  it('dispose unregisters, requests a final erase, unsubscribes from the roster, and is idempotent', () => {
    const roster = new PeerRoster();
    const { host, getRenderer, requestRender, unregister } = makeHost();
    const overlay = new RemoteCursorOverlay(host, roster);
    overlay.dispose();
    overlay.dispose();
    expect(overlay.disposed).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(getRenderer()).toBeNull();
    const after = requestRender.mock.calls.length;
    roster.apply('c1', frame('ada', { cursor: { x: 1, y: 1 } }));
    expect(requestRender.mock.calls.length).toBe(after);
  });
});
