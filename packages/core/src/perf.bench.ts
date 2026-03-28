import { bench, describe } from 'vitest';
import { ElementStore } from './elements/element-store';
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

function populateStore(store: ElementStore, count: number) {
  const range = 5000;
  for (let i = 0; i < count; i++) {
    const kind = i % 4;
    const pos = randomPoint(range);
    if (kind === 0) {
      store.add(createNote({ position: pos, size: { w: 200, h: 100 } }));
    } else if (kind === 1) {
      const origin = randomPoint(range);
      store.add(createStroke({ points: randomStrokePoints(30, origin), position: origin }));
    } else if (kind === 2) {
      store.add(createArrow({ from: randomPoint(range), to: randomPoint(range) }));
    } else {
      store.add(createShape({ position: pos, size: { w: 80, h: 60 }, shape: 'rectangle' }));
    }
  }
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
