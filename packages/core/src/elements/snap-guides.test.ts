import { describe, it, expect } from 'vitest';
import { computeSnapGuides } from './snap-guides';
import type { Bounds } from '../core/types';

const B = (x: number, y: number, w: number, h: number): Bounds => ({ x, y, w, h });

describe('computeSnapGuides', () => {
  it('snaps a left edge (same-size boxes align left/center/right together)', () => {
    const res = computeSnapGuides(B(5, 0, 100, 10), [B(0, 500, 100, 10)], 6);
    expect(res.dx).toBe(-5);
    expect(res.dy).toBe(0);
    expect(res.guides).toEqual([{ axis: 'x', position: 0 }]);
  });

  it('snaps both axes simultaneously', () => {
    const res = computeSnapGuides(B(5, 5, 100, 100), [B(0, 0, 100, 100)], 6);
    expect(res.dx).toBe(-5);
    expect(res.dy).toBe(-5);
    expect(res.guides).toHaveLength(2);
    expect(res.guides).toContainEqual({ axis: 'x', position: 0 });
    expect(res.guides).toContainEqual({ axis: 'y', position: 0 });
  });

  it('snaps centers when widths differ (center-x aligns at delta 0)', () => {
    const res = computeSnapGuides(B(0, 0, 100, 10), [B(25, 500, 50, 10)], 6);
    expect(res.dx).toBe(0);
    expect(res.guides).toEqual([{ axis: 'x', position: 50 }]);
  });

  it('does not snap beyond the threshold', () => {
    // target far on BOTH axes (different y too) → no incidental edge alignment
    const res = computeSnapGuides(B(0, 0, 10, 10), [B(100, 100, 10, 10)], 6);
    expect(res).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('emits a guide when an edge is already aligned (delta 0)', () => {
    // moving top already equals target top → dy 0 but a horizontal guide still shows
    const res = computeSnapGuides(B(0, 0, 10, 10), [B(500, 0, 10, 10)], 6);
    expect(res.dy).toBe(0);
    expect(res.guides).toEqual([{ axis: 'y', position: 0 }]);
  });

  it('picks the nearest target on an axis', () => {
    const res = computeSnapGuides(B(0, 0, 10, 10), [B(2, 800, 10, 10), B(-5, 900, 10, 10)], 6);
    expect(res.dx).toBe(2);
    expect(res.guides).toEqual([{ axis: 'x', position: 2 }]);
  });

  it('snaps at exactly the threshold (inclusive)', () => {
    // wide boxes (w=20) so the abutment pair (right→left, |14|) is far and the
    // left-left colinear pair at exactly the threshold wins; target far on y.
    const res = computeSnapGuides(B(0, 0, 20, 10), [B(6, 1000, 20, 10)], 6);
    expect(res.dx).toBe(6);
    expect(res.guides).toEqual([{ axis: 'x', position: 6 }]);
  });

  it('snaps the moving box flush against a target edge (abutment)', () => {
    // moving right edge (10) is 3 from target left edge (13) → snaps flush (dx +3)
    const res = computeSnapGuides(B(0, 0, 10, 10), [B(13, 500, 10, 10)], 6);
    expect(res.dx).toBe(3);
    expect(res.guides).toEqual([{ axis: 'x', position: 13 }]);
  });

  it('returns no snap for empty targets', () => {
    expect(computeSnapGuides(B(0, 0, 10, 10), [], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
