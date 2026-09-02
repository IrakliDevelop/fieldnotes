// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { RemoteSelectionOverlay } from './remote-selection-overlay';
import type { RemoteSelectionOverlayHost } from './remote-selection-overlay';
import { PeerRoster } from './awareness-roster';
import { ElementStore } from '../elements/element-store';
import { LayerManager } from '../layers/layer-manager';
import { createShape } from '../elements/element-factory';
import type { OverlayRenderer } from './render-loop';

function makeCtx(): {
  ctx: CanvasRenderingContext2D;
  strokes: [number, number, number, number][];
  strokeStyles: string[];
} {
  const strokes: [number, number, number, number][] = [];
  const strokeStyles: string[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => strokes.push([x, y, w, h])),
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'strokeStyle', {
    get: () => strokeStyles.at(-1) ?? '',
    set: (value: string) => {
      strokeStyles.push(value);
    },
  });
  return { ctx, strokes, strokeStyles };
}

function makeHost(): {
  host: RemoteSelectionOverlayHost;
  store: ElementStore;
  layers: LayerManager;
  getRenderer: () => OverlayRenderer | null;
  requestRender: ReturnType<typeof vi.fn>;
} {
  const store = new ElementStore();
  const layers = new LayerManager(store);
  let renderer: OverlayRenderer | null = null;
  const requestRender = vi.fn();
  return {
    host: {
      registerOverlay: (draw) => {
        renderer = draw;
        return () => {
          renderer = null;
        };
      },
      requestRender,
      camera: { zoom: 2 },
      store,
      layerManager: layers,
    },
    store,
    layers,
    getRenderer: () => renderer,
    requestRender,
  };
}

const frame = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'awareness',
  id,
  ...extra,
});

describe('RemoteSelectionOverlay', () => {
  it('outlines only ids present in the local store, and only on visible layers', () => {
    const { host, store, layers, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    const visible = createShape({ position: { x: 10, y: 10 }, size: { w: 20, h: 30 } });
    store.add(visible);
    const hiddenLayer = layers.createLayer('Hidden');
    const hidden = createShape({ position: { x: 100, y: 100 }, size: { w: 5, h: 5 } });
    store.add(hidden);
    layers.moveElementToLayer(hidden.id, hiddenLayer.id);
    layers.setLayerVisible(hiddenLayer.id, false);

    roster.apply('c1', frame('ada', { selection: [visible.id, hidden.id, 'missing'] }));
    const { ctx, strokes } = makeCtx();
    getRenderer()?.(ctx);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toEqual([-10, -15, 20, 30]);

    layers.setLayerVisible(hiddenLayer.id, true);
    const second = makeCtx();
    getRenderer()?.(second.ctx);
    expect(second.strokes).toHaveLength(2);
    overlay.dispose();
  });

  it("two peers selecting the same element outline it once in the first peer's colour", () => {
    const { host, store, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    roster.apply('c1', frame('ada', { selection: [el.id], color: '#111111' }));
    roster.apply('c2', frame('bea', { selection: [el.id], color: '#222222' }));
    const { ctx, strokes, strokeStyles } = makeCtx();
    getRenderer()?.(ctx);
    expect(strokes).toHaveLength(1);
    // The strokeStyle assignment made just before the (only) strokeRect call
    // must be the first peer's colour.
    expect(strokeStyles.at(-1)).toBe('#111111');
    overlay.dispose();
  });

  it('clearing a selection erases a previously drawn outline', () => {
    const { host, store, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    roster.apply('c1', frame('ada', { selection: [el.id] }));
    const first = makeCtx();
    getRenderer()?.(first.ctx);
    expect(first.strokes).toHaveLength(1);
    roster.apply('c1', frame('ada', { selection: [], cursor: { x: 1, y: 1 } }));
    const second = makeCtx();
    getRenderer()?.(second.ctx);
    expect(second.strokes).toHaveLength(0);
    overlay.dispose();
  });

  it('never rescans the store on cursor-only roster updates', () => {
    const { host, store, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    const other = createShape({ position: { x: 50, y: 50 }, size: { w: 10, h: 10 } });
    store.add(other);
    const scan = vi.spyOn(store, 'getAll');
    roster.apply('c1', frame('ada', { selection: [el.id], cursor: { x: 0, y: 0 } }));
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 20; i++) {
      roster.apply('c1', frame('ada', { selection: [el.id], cursor: { x: i, y: i } }));
      getRenderer()?.(makeCtx().ctx);
    }
    expect(scan).toHaveBeenCalledTimes(1);
    roster.apply('c1', frame('ada', { selection: [other.id], cursor: { x: 0, y: 0 } }));
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(2);
    overlay.dispose();
  });

  it('does not rescan when a selection change resolves to empty', () => {
    const { host, store, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    const scan = vi.spyOn(store, 'getAll');
    roster.apply('c1', frame('ada', { selection: [] }));
    getRenderer()?.(makeCtx().ctx);
    expect(scan).not.toHaveBeenCalled();
    overlay.dispose();
  });

  it('rescans when the store or layer visibility changes, and when a resolved colour changes', () => {
    const { host, store, layers, getRenderer } = makeHost();
    const roster = new PeerRoster();
    let colour = '#111111';
    const overlay = new RemoteSelectionOverlay(host, roster, { colorFor: () => colour });
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    const other = layers.createLayer('Other');
    layers.moveElementToLayer(el.id, other.id);
    const scan = vi.spyOn(store, 'getAll');
    roster.apply('c1', frame('ada', { selection: [el.id] }));
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(1);
    store.update(el.id, { position: { x: 5, y: 5 } });
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(2);
    layers.setLayerVisible(other.id, false);
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(3);
    colour = '#222222';
    roster.apply('c1', frame('ada', { selection: [el.id], cursor: { x: 1, y: 1 } }));
    getRenderer()?.(makeCtx().ctx);
    expect(scan).toHaveBeenCalledTimes(4);
    overlay.dispose();
  });

  it('draws with alpha and a zoom-invariant line width, rotating about the rect centre', () => {
    const { host, store, getRenderer } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster, { alpha: 0.4, lineWidthPx: 3 });
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    store.add(el);
    store.update(el.id, { rotation: 1 });
    roster.apply('c1', frame('ada', { selection: [el.id] }));
    const { ctx } = makeCtx();
    getRenderer()?.(ctx);
    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.lineWidth).toBe(1.5);
    expect(ctx.rotate).toHaveBeenCalledWith(1);
    expect(ctx.translate).toHaveBeenCalledWith(5, 5);
    overlay.dispose();
  });

  it('dispose unregisters, unsubscribes from roster/store/layers, requests an erase, and is idempotent', () => {
    const { host, store, getRenderer, requestRender } = makeHost();
    const roster = new PeerRoster();
    const overlay = new RemoteSelectionOverlay(host, roster);
    overlay.dispose();
    overlay.dispose();
    expect(overlay.disposed).toBe(true);
    expect(getRenderer()).toBeNull();
    const after = requestRender.mock.calls.length;
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }));
    roster.apply('c1', frame('ada', { selection: ['x'] }));
    expect(requestRender.mock.calls.length).toBe(after);
  });
});
