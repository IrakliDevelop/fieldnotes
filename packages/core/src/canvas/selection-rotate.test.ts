import { describe, it, expect } from 'vitest';
import { rotationPivot, rotateElementPatch } from './selection-rotate';
import type { BoundedElement } from './selection-rotate';
import { createShape, createArrow, createTemplate } from '../elements/element-factory';
import { getElementBounds } from '../elements/element-bounds';
import type { CanvasElement } from '../elements/types';

const CW = Math.PI / 2;
const CCW = -Math.PI / 2;

function bounded(el: CanvasElement): BoundedElement {
  const bounds = getElementBounds(el);
  if (!bounds) throw new Error('element has no bounds');
  return { id: el.id, el, bounds };
}

describe('rotationPivot', () => {
  it('single element: own bounds center', () => {
    const a = createShape({ position: { x: 10, y: 20 }, size: { w: 40, h: 20 } });
    expect(rotationPivot([bounded(a)])).toEqual({ x: 30, y: 30 });
  });

  it('multi: center of union of bounds', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 90, y: 40 }, size: { w: 10, h: 10 } });
    expect(rotationPivot([bounded(a), bounded(b)])).toEqual({ x: 50, y: 25 });
  });

  it('multi: pre-rotated element contributes its visual (rotated AABB) box', () => {
    // 40x20 shape rotated 90°: visual AABB is 20x40 centered at (20,10) → x:[10,30], y:[-10,30]
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 40, h: 20 } });
    a.rotation = Math.PI / 2;
    const b = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const pivot = rotationPivot([bounded(a), bounded(b)]);
    expect(pivot.x).toBeCloseTo((10 + 60) / 2);
    expect(pivot.y).toBeCloseTo((-10 + 30) / 2);
  });
});

describe('rotateElementPatch', () => {
  it('rotatable element about own center: rotation-only, position unchanged', () => {
    const a = createShape({ position: { x: 10, y: 20 }, size: { w: 40, h: 20 } });
    const bounds = { x: 10, y: 20, w: 40, h: 20 };
    const patch = rotateElementPatch(a, bounds, { x: 30, y: 30 }, CW);
    expect(patch.rotation).toBeCloseTo(CW);
    expect(patch.position?.x).toBeCloseTo(10);
    expect(patch.position?.y).toBeCloseTo(20);
  });

  it('CCW yields negative rotation', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const patch = rotateElementPatch(a, { x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }, CCW);
    expect(patch.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it('rotation accumulates and normalizes to (-π, π]', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    a.rotation = Math.PI / 2;
    const patch = rotateElementPatch(a, { x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }, CW);
    expect(patch.rotation).toBeCloseTo(Math.PI);
    a.rotation = Math.PI;
    const patch2 = rotateElementPatch(a, { x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }, CW);
    expect(patch2.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it('orbits a distant pivot: center moves, rotation changes', () => {
    // center (5,5), pivot (0,0), CW (y-down: (x,y) → (-y, x)) → new center (-5,5)
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const patch = rotateElementPatch(a, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0 }, CW);
    expect(patch.position?.x).toBeCloseTo(-10);
    expect(patch.position?.y).toBeCloseTo(0);
    expect(patch.rotation).toBeCloseTo(CW);
  });

  it('arrow: endpoints rotate about pivot, position follows center delta', () => {
    const a = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const bounds = getElementBounds(a);
    if (!bounds) throw new Error('no bounds');
    const patch = rotateElementPatch(a, bounds, { x: 0, y: 0 }, CW);
    if (patch && 'from' in patch && patch.from && patch.to) {
      expect(patch.from.x).toBeCloseTo(0);
      expect(patch.from.y).toBeCloseTo(0);
      expect(patch.to.x).toBeCloseTo(0);
      expect(patch.to.y).toBeCloseTo(10);
    } else {
      throw new Error('expected arrow patch with from/to');
    }
    expect(patch.rotation).toBeUndefined();
  });

  it('template: angle shifts by delta (normalized), origin orbits pivot', () => {
    const t = createTemplate({
      position: { x: 10, y: 0 },
      templateShape: 'cone',
      radius: 30,
      angle: 0,
    });
    const bounds = getElementBounds(t);
    if (!bounds) throw new Error('no bounds');
    const patch = rotateElementPatch(t, bounds, { x: 0, y: 0 }, CW);
    if ('angle' in patch) {
      expect(patch.angle).toBeCloseTo(Math.PI / 2);
    } else {
      throw new Error('expected template patch with angle');
    }
    expect(patch.position?.x).toBeCloseTo(0);
    expect(patch.position?.y).toBeCloseTo(10);
    expect(patch.rotation).toBeUndefined();
  });
});
