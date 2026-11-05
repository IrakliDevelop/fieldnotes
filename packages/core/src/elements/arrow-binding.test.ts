import { describe, it, expect, vi } from 'vitest';
import {
  getElementCenter,
  findBindTarget,
  findBoundArrows,
  updateBoundArrow,
  updateArrowsBoundToElements,
  clearStaleBindings,
  isBindable,
  unbindArrowsFrom,
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
import type { CanvasElement, ExtensionElementEnvelope } from './types';
import { createTestBoxRegistry } from '../test-helpers/test-box-type';
import { createShape } from './element-factory';
import { createBoundText } from './bound-text';

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

describe('findBindTarget', () => {
  it('skips actual bound text while retaining unrelated text targets', () => {
    const store = new ElementStore();
    const rectangle = createShape({
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
    });
    const bound = { ...createBoundText(rectangle, { text: 'bound' }), size: { w: 60, h: 20 } };
    const extra = createText({ position: { x: 0, y: 0 }, size: { w: 60, h: 20 } });
    store.add(rectangle);
    store.add(bound);
    store.add(extra);

    expect(findBindTarget({ x: 50, y: 50 }, store, 20)?.id).toBe(rectangle.id);
  });

  it('retains an existing unrotated-bounds target after spatial filtering', () => {
    const store = new ElementStore();
    const note = createNote({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 100 },
    });
    note.rotation = Math.PI / 2;
    store.add(note);

    expect(findBindTarget({ x: 10, y: 0 }, store, 20)?.id).toBe(note.id);
  });

  it('queries candidates without enumerating all elements', () => {
    const store = new ElementStore();
    const excluded = Object.assign(createNote({ position: { x: 0, y: 0 } }), { id: 'excluded' });
    const filtered = Object.assign(createNote({ position: { x: 1, y: 0 } }), { id: 'filtered' });
    const target = Object.assign(createNote({ position: { x: 2, y: 0 } }), { id: 'target' });
    store.add(excluded);
    store.add(filtered);
    store.add(target);
    const getAll = vi.spyOn(store, 'getAll');

    const result = findBindTarget(
      { x: 2, y: 0 },
      store,
      20,
      excluded.id,
      (element) => element.id !== filtered.id,
    );

    expect(result?.id).toBe(target.id);
    expect(getAll).not.toHaveBeenCalled();
  });

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
    const updates = updateBoundArrow(arrow, (id) => store.getById(id));
    expect(updates).not.toBeNull();
    expect(updates?.from).toEqual({ x: 200, y: 150 });
    expect(updates?.to).toBeUndefined();
  });

  it('returns null when no bindings', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    store.add(arrow);
    expect(updateBoundArrow(arrow, (id) => store.getById(id))).toBeNull();
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

describe('updateArrowsBoundToElements', () => {
  it('re-anchors arrows bound to a moved element and ignores arrow ids', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
    store.add(note);
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 150, y: 150 } });
    arrow.toBinding = { elementId: note.id };
    store.add(arrow);

    // move the note, then re-anchor bound arrows
    store.update(note.id, { position: { x: 400, y: 400 } });
    updateArrowsBoundToElements([note.id], store);

    const updated = store.getById(arrow.id) as { to: { x: number; y: number } };
    // the bound 'to' endpoint should now point toward the moved note's new edge (x grew)
    expect(updated.to.x).toBeGreaterThan(150);
  });

  it('is a no-op when no moved non-arrow elements are given', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    store.add(arrow);
    expect(() => updateArrowsBoundToElements([arrow.id], store)).not.toThrow();
    const after = store.getById(arrow.id) as { to: { x: number; y: number } };
    expect(after.to).toEqual({ x: 10, y: 10 }); // unchanged
  });
});

describe('unbindArrowsFrom', () => {
  it('releases a bent arrow at its intrinsic curve edge after removal', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 350, y: 50 },
      bend: 60,
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    store.remove(note.id);

    unbindArrowsFrom(store, note, undefined, store.elementRegistry);

    const updated = store.getById(arrow.id);
    if (!updated || updated.type !== 'arrow') throw new Error('expected arrow');
    expect(updated.from.x).toBeCloseTo(100, 2);
    expect(updated.from.y).toBeCloseTo(66.667, 2);
  });

  it('detaches arrows from a removed element to its edge and forwards the change meta', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 300, y: 50 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    store.remove(note.id);
    const metas: unknown[] = [];
    store.on('update', (_change, meta) => metas.push(meta));

    unbindArrowsFrom(store, note, { origin: 'remote' }, store.elementRegistry);

    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.fromBinding).toBeUndefined();
    if (!updated || updated.type !== 'arrow') throw new Error('expected arrow');
    expect(updated.position.x).toBeCloseTo(100, 2);
    expect(updated.position.y).toBeCloseTo(50, 2);
    expect(metas).toEqual([{ origin: 'remote' }]);
  });

  it('leaves the endpoint on the edge of a removed extension bounded by the given registry', () => {
    const registry = createTestBoxRegistry();
    const store = new ElementStore(registry);
    const box: ExtensionElementEnvelope = {
      id: 'box',
      type: 'extension',
      extensionType: 'test:box',
      position: { x: 100, y: 100 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    };
    const arrow = createArrow({
      from: { x: 0, y: 110 },
      to: { x: 120, y: 110 },
      toBinding: { elementId: box.id },
    });
    store.add(arrow);

    unbindArrowsFrom(store, box, undefined, registry);

    const updated = store.getById(arrow.id);
    if (!updated || updated.type !== 'arrow') throw new Error('expected arrow');
    expect(updated.to.x).toBeCloseTo(100, 2);
    expect(updated.to.y).toBeCloseTo(110, 2);
  });
});
