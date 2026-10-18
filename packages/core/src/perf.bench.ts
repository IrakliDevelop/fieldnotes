import { bench, describe } from 'vitest';
import { ElementStore } from './elements/element-store';
import { LayerManager } from './layers/layer-manager';
import { RenderLoop } from './canvas/render-loop';
import { MarginViewport } from './canvas/margin-viewport';
import type { RenderLoopDeps } from './canvas/render-loop';
import { createStroke, createNote, createArrow, createShape } from './elements/element-factory';
import { getElementBounds, boundsIntersect } from './elements/element-bounds';
import type { Bounds } from './core/types';

function randomPoint(range: number) {
  return { x: Math.random() * range - range / 2, y: Math.random() * range - range / 2 };
}

function randomStrokePoints(count: number, _origin: { x: number; y: number }) {
  const points = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    x += Math.random() * 10 - 5;
    y += Math.random() * 10 - 5;
    points.push({ x, y, pressure: 0.5 });
  }
  return points;
}

function populateStore(store: ElementStore, count: number, layerIds: readonly string[] = []) {
  const range = 5000;
  for (let i = 0; i < count; i++) {
    const kind = i % 4;
    const pos = randomPoint(range);
    const layerId = layerIds[i % Math.max(1, layerIds.length)];
    if (kind === 0) {
      store.add(createNote({ position: pos, size: { w: 200, h: 100 }, layerId }));
    } else if (kind === 1) {
      const origin = randomPoint(range);
      store.add(
        createStroke({ points: randomStrokePoints(30, origin), position: origin, layerId }),
      );
    } else if (kind === 2) {
      store.add(createArrow({ from: randomPoint(range), to: randomPoint(range), layerId }));
    } else {
      store.add(
        createShape({ position: pos, size: { w: 80, h: 60 }, shape: 'rectangle', layerId }),
      );
    }
  }
}

const noop = (): void => undefined;

function stubCtx(): CanvasRenderingContext2D {
  return {
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    drawImage: noop,
    setTransform: noop,
  } as unknown as CanvasRenderingContext2D;
}

function createFrameLoop(elementCount: number): RenderLoop {
  const store = new ElementStore();
  const layerManager = new LayerManager(store);
  const layerIds = [
    layerManager.activeLayerId,
    layerManager.createLayer().id,
    layerManager.createLayer().id,
    layerManager.createLayer().id,
  ];
  populateStore(store, elementCount, layerIds);

  const ctx = stubCtx();
  const canvasEl = document.createElement('canvas');
  canvasEl.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  const marginViewport = new MarginViewport(256);
  marginViewport.setViewport(800, 600, 1);
  const offCanvas = document.createElement('canvas');

  const deps: RenderLoopDeps = {
    canvasEl,
    camera: { position: { x: 0, y: 0 }, zoom: 1 } as unknown as RenderLoopDeps['camera'],
    background: { render: noop } as unknown as RenderLoopDeps['background'],
    store,
    renderer: {
      setCanvasSize: noop,
      isDomElement: (el: { type: string }) => el.type === 'note',
      isFullCanvasElement: () => false,
      renderCanvasElement: noop,
    } as unknown as RenderLoopDeps['renderer'],
    toolManager: { activeTool: null } as unknown as RenderLoopDeps['toolManager'],
    layerManager,
    domNodeManager: {
      syncDomNode: noop,
      hideDomNode: noop,
    } as unknown as RenderLoopDeps['domNodeManager'],
    layerCache: {
      isDirty: () => false,
      markAllDirty: noop,
      getCanvas: () => offCanvas,
    } as unknown as RenderLoopDeps['layerCache'],
    marginViewport,
    hybridSurface: {
      beginFrame: noop,
      getContext: () => ctx,
    } as unknown as RenderLoopDeps['hybridSurface'],
  };
  return new RenderLoop(deps);
}

describe('ElementStore spatial queries', () => {
  const store = new ElementStore();
  populateStore(store, 500);

  const viewportRect: Bounds = { x: -400, y: -300, w: 800, h: 600 };
  const point = { x: 0, y: 0 };

  bench('queryRect (viewport-sized)', () => {
    store.queryRect(viewportRect);
  });

  bench('queryPoint (single point)', () => {
    store.queryPoint(point);
  });

  bench('getAll (baseline linear)', () => {
    store.getAll();
  });
});

describe('getElementBounds', () => {
  const note = createNote({ position: { x: 10, y: 20 }, size: { w: 100, h: 50 } });
  const stroke = createStroke({
    points: randomStrokePoints(50, { x: 0, y: 0 }),
    position: { x: 100, y: 100 },
  });
  const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, bend: 30 });

  bench('bounds for note (sized element)', () => {
    getElementBounds(note);
  });

  bench('bounds for stroke (cached)', () => {
    getElementBounds(stroke);
  });

  bench('bounds for arrow (bezier)', () => {
    getElementBounds(arrow);
  });
});

describe('boundsIntersect', () => {
  const a: Bounds = { x: 0, y: 0, w: 100, h: 100 };
  const bHit: Bounds = { x: 50, y: 50, w: 100, h: 100 };
  const bMiss: Bounds = { x: 500, y: 500, w: 10, h: 10 };

  bench('intersecting', () => {
    boundsIntersect(a, bHit);
  });

  bench('non-intersecting', () => {
    boundsIntersect(a, bMiss);
  });
});

describe('store mutations with spatial index', () => {
  bench('add 100 elements', () => {
    const store = new ElementStore();
    for (let i = 0; i < 100; i++) {
      store.add(createNote({ position: randomPoint(5000), size: { w: 200, h: 100 } }));
    }
  });

  bench('loadSnapshot 500 elements', () => {
    const elements = [];
    for (let i = 0; i < 500; i++) {
      elements.push(createNote({ position: randomPoint(5000), size: { w: 200, h: 100 } }));
    }
    const store = new ElementStore();
    store.loadSnapshot(elements);
  });
});

describe('RenderLoop frame', () => {
  const loop = createFrameLoop(10_000);

  bench('10,000 mixed elements over 4 layers', () => {
    loop.requestRender();
    loop.flush();
  });
});

describe('note creation', () => {
  // A counter across iterations keeps every text distinct, so no input repeats.
  let seq = 0;

  bench('createNote + store.add x100', () => {
    const store = new ElementStore();
    for (let i = 0; i < 100; i++) {
      const text = `<b>Session ${seq++}</b> notes <span style="font-size: 18px;">loot</span><div>next</div>`;
      store.add(createNote({ position: randomPoint(5000), size: { w: 200, h: 100 }, text }));
    }
  });
});
