import { expect } from 'vitest';
import type { ElementStore } from '../elements/element-store';
import type { CanvasElement, ElementType } from '../elements/types';

export function findElementsByType<T extends ElementType>(
  store: ElementStore,
  type: T,
): Extract<CanvasElement, { type: T }>[] {
  return store.getElementsByType(type);
}

export function assertElementCount(store: ElementStore, expected: number): void {
  expect(store.count).toBe(expected);
}

export function assertBounds(
  el: CanvasElement & { position: { x: number; y: number }; size: { w: number; h: number } },
  expected: { x: number; y: number; w: number; h: number },
  tolerance = 0,
): void {
  if (tolerance === 0) {
    expect(el.position.x).toBe(expected.x);
    expect(el.position.y).toBe(expected.y);
    expect(el.size.w).toBe(expected.w);
    expect(el.size.h).toBe(expected.h);
  } else {
    expect(el.position.x).toBeCloseTo(expected.x, tolerance);
    expect(el.position.y).toBeCloseTo(expected.y, tolerance);
    expect(el.size.w).toBeCloseTo(expected.w, tolerance);
    expect(el.size.h).toBeCloseTo(expected.h, tolerance);
  }
}
