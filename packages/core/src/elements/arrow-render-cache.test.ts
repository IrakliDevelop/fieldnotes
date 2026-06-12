import { describe, it, expect, vi } from 'vitest';
import { getArrowRenderGeometry } from './arrow-render-cache';
import { createArrow } from './element-factory';
import * as arrowGeometry from './arrow-geometry';

describe('getArrowRenderGeometry', () => {
  it('computes once per arrow object; second lookup adds zero work', () => {
    const spy = vi.spyOn(arrowGeometry, 'getArrowControlPoint');
    const arrow = createArrow({
      position: { x: 0, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      bend: 0.5,
    });
    spy.mockClear();

    const a = getArrowRenderGeometry(arrow);
    const callsAfterFirst = spy.mock.calls.length;
    const b = getArrowRenderGeometry(arrow);
    expect(b).toBe(a);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it('matches the uncached math', () => {
    const arrow = createArrow({
      position: { x: 0, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      bend: 0.3,
    });
    const geo = getArrowRenderGeometry(arrow);
    expect(geo.tangentStart).toBeCloseTo(
      arrowGeometry.getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 0),
    );
    expect(geo.tangentEnd).toBeCloseTo(
      arrowGeometry.getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1),
    );
    expect(geo.controlPoint).toEqual(
      arrowGeometry.getArrowControlPoint(arrow.from, arrow.to, arrow.bend),
    );
  });

  it('straight arrows have a null control point', () => {
    const arrow = createArrow({
      position: { x: 0, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      bend: 0,
    });
    expect(getArrowRenderGeometry(arrow).controlPoint).toBeNull();
  });

  it('a replaced arrow object (store.update semantics) recomputes', () => {
    const arrow = createArrow({
      position: { x: 0, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      bend: 0.5,
    });
    const a = getArrowRenderGeometry(arrow);
    const replaced = { ...arrow, to: { x: 200, y: 0 } };
    const b = getArrowRenderGeometry(replaced);
    expect(b).not.toBe(a);
    expect(b.tangentEnd).not.toBe(a.tangentEnd);
  });
});
