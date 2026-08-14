import { describe, expect, it, vi } from 'vitest';
import { ElementStore } from '../elements/element-store';
import { createImage, createStroke } from '../elements/element-factory';
import { computeElementRects, elementRectsEqual } from './element-rect-tracker';
import type { CanvasElement } from '../elements/types';

function storeWith(...elements: CanvasElement[]): ElementStore {
  const store = new ElementStore();
  for (const el of elements) store.add(el);
  return store;
}

function image(id: string, x: number, y: number): CanvasElement {
  return {
    ...createImage({ position: { x, y }, size: { w: 40, h: 40 }, src: 'a.png', layerId: 'l1' }),
    id,
  };
}

describe('computeElementRects', () => {
  it('returns one rect per matched element, echoing the key', () => {
    const store = storeWith(image('a', 10, 20), image('b', 50, 60));
    const rects = computeElementRects(store, (el) => (el.id === 'a' ? 'key-a' : null));
    expect(rects).toEqual([{ id: 'a', key: 'key-a', x: 10, y: 20, w: 40, h: 40, rotation: 0 }]);
  });

  it('reports rotation in radians, defaulting to 0', () => {
    const rotated = { ...image('a', 0, 0), rotation: 1.5 };
    const rects = computeElementRects(storeWith(rotated), () => 'k');
    expect(rects[0]?.rotation).toBe(1.5);
  });

  it('tracks unsized elements via getElementBounds', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 30, y: 40, pressure: 0.5 },
      ],
      color: '#000',
      width: 2,
      layerId: 'l1',
    });
    const rects = computeElementRects(storeWith(stroke), () => 'stroke-key');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.w).toBeGreaterThan(0);
    expect(rects[0]?.h).toBeGreaterThan(0);
  });

  it('treats a throwing match as unmatched and reports it', () => {
    const onError = vi.fn();
    const boom = new Error('bad match');
    const rects = computeElementRects(
      storeWith(image('a', 0, 0)),
      () => {
        throw boom;
      },
      onError,
    );
    expect(rects).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(boom);
  });

  it('treats a non-string, non-null match result as unmatched', () => {
    const rects = computeElementRects(storeWith(image('a', 0, 0)), () => 42 as unknown as string);
    expect(rects).toEqual([]);
  });
});

describe('elementRectsEqual', () => {
  const base = { id: 'a', key: 'k', x: 0, y: 0, w: 1, h: 1, rotation: 0 };

  it('is true for field-identical snapshots in different arrays', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base }])).toBe(true);
  });

  it('is false when only the key differs', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base, key: 'other' }])).toBe(false);
  });

  it('is false when only the position differs', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base, x: 2 }])).toBe(false);
  });

  it('is false for different lengths', () => {
    expect(elementRectsEqual([{ ...base }], [])).toBe(false);
  });
});
