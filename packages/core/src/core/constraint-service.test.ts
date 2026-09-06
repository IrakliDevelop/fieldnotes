import { describe, it, expect } from 'vitest';
import { ConstraintServiceProxy } from './constraint-service';
import type { PointConstraintService } from './constraint-service';
import type { Point } from './types';

function makeGridService(cellSize: number): PointConstraintService {
  return {
    constrainPoint: (point: Point) => ({
      x: Math.round(point.x / cellSize) * cellSize,
      y: Math.round(point.y / cellSize) * cellSize,
    }),
    getConstraintInfo: () => ({ type: 'grid', cellSize }),
    hasCapability: (cap: string) => cap === 'grid:snap',
  };
}

describe('ConstraintServiceProxy', () => {
  it('returns point unchanged when inactive', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setImplementation(makeGridService(50));
    proxy.setActive(false);

    const result = proxy.constrainPoint({ x: 23, y: 47 });
    expect(result).toEqual({ x: 23, y: 47 });
  });

  it('returns point unchanged when no implementation', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setActive(true);

    const result = proxy.constrainPoint({ x: 23, y: 47 });
    expect(result).toEqual({ x: 23, y: 47 });
  });

  it('delegates to implementation when active', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setImplementation(makeGridService(50));
    proxy.setActive(true);

    const result = proxy.constrainPoint({ x: 23, y: 47 });
    expect(result).toEqual({ x: 0, y: 50 });
  });

  it('isActive reflects setActive', () => {
    const proxy = new ConstraintServiceProxy();
    expect(proxy.isActive).toBe(false);
    proxy.setActive(true);
    expect(proxy.isActive).toBe(true);
    proxy.setActive(false);
    expect(proxy.isActive).toBe(false);
  });

  it('getConstraintInfo returns null without implementation', () => {
    const proxy = new ConstraintServiceProxy();
    expect(proxy.getConstraintInfo()).toBeNull();
  });

  it('getConstraintInfo delegates to implementation', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setImplementation(makeGridService(50));
    const info = proxy.getConstraintInfo();
    expect(info).toEqual({ type: 'grid', cellSize: 50 });
  });

  it('hasCapability returns false without implementation', () => {
    const proxy = new ConstraintServiceProxy();
    expect(proxy.hasCapability('grid:snap')).toBe(false);
  });

  it('hasCapability delegates to implementation', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setImplementation(makeGridService(50));
    expect(proxy.hasCapability('grid:snap')).toBe(true);
    expect(proxy.hasCapability('hex:snap')).toBe(false);
  });

  it('implementation replacement preserves activation', () => {
    const proxy = new ConstraintServiceProxy();
    proxy.setActive(true);
    proxy.setImplementation(makeGridService(50));

    expect(proxy.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 0, y: 50 });

    proxy.setImplementation(makeGridService(100));
    expect(proxy.isActive).toBe(true);
    expect(proxy.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 0, y: 0 });
  });

  it('passes constraint options through to implementation', () => {
    const spy = {
      constrainPoint: (point: Point, options?: { mode?: string }) =>
        options?.mode === 'cell-center' ? { x: 50, y: 50 } : point,
      getConstraintInfo: () => null,
      hasCapability: () => false,
    };
    const proxy = new ConstraintServiceProxy();
    proxy.setImplementation(spy);
    proxy.setActive(true);

    expect(proxy.constrainPoint({ x: 23, y: 47 }, { mode: 'cell-center' })).toEqual({
      x: 50,
      y: 50,
    });
    expect(proxy.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 23, y: 47 });
  });
});
