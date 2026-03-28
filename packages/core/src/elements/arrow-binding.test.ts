import { describe, it, expect } from 'vitest';
import {
  getElementCenter,
  getEdgeIntersection,
  findBindTarget,
  findBoundArrows,
  updateBoundArrow,
  clearStaleBindings,
  isBindable,
  unbindArrow,
} from './arrow-binding';
import { getElementBounds } from './element-bounds';
import {
  createNote,
  createText,
  createImage,
  createHtmlElement,
  createArrow,
  createStroke,
} from './element-factory';
import { ElementStore } from './element-store';
import type { CanvasElement } from './types';

describe('getElementCenter', () => {
  it('returns center of a note', () => {
    const note = createNote({ position: { x: 100, y: 50 }, size: { w: 200, h: 100 } });
    expect(getElementCenter(note)).toEqual({ x: 200, y: 100 });
  });

  it('returns center of a text element', () => {
    const text = createText({ position: { x: 0, y: 0 }, size: { w: 200, h: 28 } });
    expect(getElementCenter(text)).toEqual({ x: 100, y: 14 });
  });

  it('returns center of an image', () => {
    const img = createImage({
      position: { x: 10, y: 20 },
      size: { w: 300, h: 200 },
      src: 'test.png',
    });
    expect(getElementCenter(img)).toEqual({ x: 160, y: 120 });
  });

  it('throws for element without size', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    expect(() => getElementCenter(arrow)).toThrow();
  });
});

describe('getElementBounds', () => {
  it('returns bounds for note', () => {
    const note = createNote({ position: { x: 10, y: 20 }, size: { w: 100, h: 50 } });
    expect(getElementBounds(note)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('returns bounds for stroke with points', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 10, y: 20, pressure: 0.5 },
      ],
    });
    const bounds = getElementBounds(stroke);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBe(10);
    expect(bounds.h).toBe(20);
  });
});

describe('getEdgeIntersection', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 };

  it('returns right edge intersection for point to the right', () => {
    const result = getEdgeIntersection(bounds, { x: 200, y: 50 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(50);
  });

  it('returns left edge intersection for point to the left', () => {
    const result = getEdgeIntersection(bounds, { x: -100, y: 50 });
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(50);
  });

  it('returns top edge intersection for point above', () => {
    const result = getEdgeIntersection(bounds, { x: 50, y: -100 });
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
  });

  it('returns bottom edge intersection for point below', () => {
    const result = getEdgeIntersection(bounds, { x: 50, y: 200 });
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(100);
  });

  it('returns correct intersection for diagonal', () => {
    const result = getEdgeIntersection(bounds, { x: 200, y: 200 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(100);
  });
});

describe('findBindTarget', () => {
  it('finds nearest bindable element within threshold', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    store.add(note);
    const result = findBindTarget({ x: 210, y: 155 }, store, 20);
    expect(result?.id).toBe(note.id);
  });

  it('returns null when no element within threshold', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    store.add(note);
    const result = findBindTarget({ x: 500, y: 500 }, store, 20);
    expect(result).toBeNull();
  });

  it('excludes arrows from binding targets', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    store.add(arrow);
    const result = findBindTarget({ x: 50, y: 50 }, store, 20);
    expect(result).toBeNull();
  });

  it('excludes element by excludeId', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    store.add(note);
    const result = findBindTarget({ x: 50, y: 50 }, store, 20, note.id);
    expect(result).toBeNull();
  });

  it('finds element when point is inside bounds', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    store.add(note);
    const result = findBindTarget({ x: 50, y: 50 }, store, 20);
    expect(result?.id).toBe(note.id);
  });

  it('excludes elements on different layer when filter is provided', () => {
    const store = new ElementStore();
    const note = createNote({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      layerId: 'layer-1',
    });
    store.add(note);
    const filter = (el: CanvasElement) => el.layerId === 'layer-2';
    const result = findBindTarget({ x: 50, y: 50 }, store, 20, undefined, filter);
    expect(result).toBeNull();
  });

  it('finds elements on same layer when filter matches', () => {
    const store = new ElementStore();
    const note = createNote({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      layerId: 'layer-1',
    });
    store.add(note);
    const filter = (el: CanvasElement) => el.layerId === 'layer-1';
    const result = findBindTarget({ x: 50, y: 50 }, store, 20, undefined, filter);
    expect(result?.id).toBe(note.id);
  });
});

describe('findBoundArrows', () => {
  it('finds arrows bound to a given element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 200, y: 200 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const result = findBoundArrows(note.id, store);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(arrow.id);
  });

  it('returns empty array when no arrows bound', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    store.add(note);
    const result = findBoundArrows(note.id, store);
    expect(result).toHaveLength(0);
  });
});

describe('updateBoundArrow', () => {
  it('updates from point to bound element center', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 300, y: 300 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const updates = updateBoundArrow(arrow, store);
    expect(updates).not.toBeNull();
    expect(updates?.from).toEqual({ x: 200, y: 150 });
    expect(updates?.to).toBeUndefined();
  });

  it('returns null when no bindings', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    store.add(arrow);
    expect(updateBoundArrow(arrow, store)).toBeNull();
  });
});

describe('clearStaleBindings', () => {
  it('clears binding when target element does not exist', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      fromBinding: { elementId: 'nonexistent' },
    });
    store.add(arrow);
    const updates = clearStaleBindings(arrow, store);
    expect(updates).not.toBeNull();
    expect(updates?.fromBinding).toBeUndefined();
  });

  it('returns null when all bindings are valid', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 200, y: 200 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    expect(clearStaleBindings(arrow, store)).toBeNull();
  });
});

describe('isBindable', () => {
  it('returns true for note, text, image, html', () => {
    expect(isBindable(createNote({ position: { x: 0, y: 0 } }))).toBe(true);
    expect(isBindable(createText({ position: { x: 0, y: 0 } }))).toBe(true);
    expect(
      isBindable(createImage({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, src: 'x' })),
    ).toBe(true);
    expect(
      isBindable(createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } })),
    ).toBe(true);
  });

  it('returns false for arrow and stroke', () => {
    expect(isBindable(createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }))).toBe(false);
    expect(isBindable(createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] }))).toBe(false);
  });
});

describe('unbindArrow', () => {
  it('clears fromBinding and rewrites from to edge point', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 300, y: 50 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const updates = unbindArrow(arrow, store);
    expect(updates.fromBinding).toBeUndefined();
    expect(updates.from).toBeDefined();
    expect(updates.from?.x).toBeCloseTo(100); // right edge
  });

  it('clears toBinding and rewrites to to edge point', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 0, y: 50 },
      to: { x: 250, y: 50 },
      toBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const updates = unbindArrow(arrow, store);
    expect(updates.toBinding).toBeUndefined();
    expect(updates.to).toBeDefined();
    expect(updates.to?.x).toBeCloseTo(200); // left edge
  });
});
