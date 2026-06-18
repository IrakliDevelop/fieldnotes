import { describe, it, expect } from 'vitest';
import { erasePoints } from './stroke-erase';
import type { StrokePoint } from '../core/types';

const P = (x: number, y: number, pressure = 1): StrokePoint => ({ x, y, pressure });

describe('erasePoints', () => {
  it('returns null when the eraser misses the stroke', () => {
    expect(erasePoints([P(0, 0), P(10, 0), P(20, 0)], { x: 50, y: 50 }, 5)).toBeNull();
  });

  it('splits a stroke into two runs when erased in the middle', () => {
    const runs = erasePoints([P(0, 0), P(10, 0), P(20, 0), P(30, 0)], { x: 15, y: 0 }, 3);
    expect(runs).not.toBeNull();
    expect(runs).toHaveLength(2);
    if (!runs || runs.length < 2) return;
    const left = runs[0];
    const right = runs[1];
    if (!left || !right) return;
    expect(left[0]).toEqual(P(0, 0));
    expect(left.at(-1)?.x).toBeCloseTo(12, 5);
    expect(right[0]?.x).toBeCloseTo(18, 5);
    expect(right.at(-1)).toEqual(P(30, 0));
  });

  it('splits a single long segment in the middle (segment-level, not point-level)', () => {
    const runs = erasePoints([P(0, 0), P(100, 0)], { x: 50, y: 0 }, 5);
    expect(runs).toHaveLength(2);
    if (!runs || runs.length < 2) return;
    const left = runs[0];
    const right = runs[1];
    if (!left || !right) return;
    expect(left.at(-1)?.x).toBeCloseTo(45, 5);
    expect(right[0]?.x).toBeCloseTo(55, 5);
  });

  it('returns one run when erased at an endpoint', () => {
    const runs = erasePoints([P(0, 0), P(10, 0)], { x: 10, y: 0 }, 3);
    expect(runs).toHaveLength(1);
    if (!runs || runs.length < 1) return;
    const run = runs[0];
    if (!run) return;
    expect(run[0]).toEqual(P(0, 0));
    expect(run.at(-1)?.x).toBeCloseTo(7, 5);
  });

  it('returns [] when the whole stroke is erased', () => {
    expect(erasePoints([P(0, 0), P(2, 0)], { x: 1, y: 0 }, 10)).toEqual([]);
  });

  it('interpolates pressure at the cut boundary', () => {
    const runs = erasePoints([P(0, 0, 0), P(100, 0, 1)], { x: 50, y: 0 }, 5);
    if (!runs || runs.length < 2) return;
    const left = runs[0];
    const right = runs[1];
    if (!left || !right) return;
    expect(left.at(-1)?.pressure).toBeCloseTo(0.45, 5);
    expect(right[0]?.pressure).toBeCloseTo(0.55, 5);
  });

  it('drops a lone surviving point (run < 2 points)', () => {
    const runs = erasePoints([P(0, 0), P(10, 0), P(20, 0)], { x: 6, y: 0 }, 7);
    expect(runs).not.toBeNull();
    if (!runs) return;
    for (const run of runs) expect(run.length).toBeGreaterThanOrEqual(2);
  });

  it('handles a single-point stroke', () => {
    expect(erasePoints([P(5, 5)], { x: 5, y: 5 }, 3)).toEqual([]);
    expect(erasePoints([P(5, 5)], { x: 50, y: 50 }, 3)).toBeNull();
  });
});
