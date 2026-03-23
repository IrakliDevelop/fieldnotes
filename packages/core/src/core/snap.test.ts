import { describe, it, expect } from 'vitest';
import { snapPoint } from './snap';

describe('snapPoint', () => {
  it('snaps to nearest grid intersection', () => {
    expect(snapPoint({ x: 37, y: 55 }, 24)).toEqual({ x: 48, y: 48 });
  });

  it('snaps exactly on grid points', () => {
    expect(snapPoint({ x: 48, y: 72 }, 24)).toEqual({ x: 48, y: 72 });
  });

  it('snaps negative coordinates', () => {
    expect(snapPoint({ x: -10, y: -37 }, 24)).toEqual({ x: 0, y: -48 });
  });

  it('rounds to nearest (not floor)', () => {
    expect(snapPoint({ x: 13, y: 11 }, 24)).toEqual({ x: 24, y: 0 });
  });

  it('works with different grid sizes', () => {
    expect(snapPoint({ x: 17, y: 33 }, 10)).toEqual({ x: 20, y: 30 });
  });
});
