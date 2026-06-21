// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { translateElementPatch } from './translate';
import { createArrow, createNote, createStroke } from './element-factory';

describe('translateElementPatch', () => {
  it('translates a non-arrow by offsetting position only', () => {
    const note = createNote({ position: { x: 10, y: 20 }, text: 'x' });
    expect(translateElementPatch(note, 5, -3)).toEqual({ position: { x: 15, y: 17 } });
  });
  it('translates an arrow by offsetting position, from, and to', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    const patch = translateElementPatch(arrow, 4, 6) as {
      position: { x: number; y: number };
      from: { x: number; y: number };
      to: { x: number; y: number };
    };
    expect(patch.from).toEqual({ x: 4, y: 6 });
    expect(patch.to).toEqual({ x: 14, y: 16 });
    expect(patch.position).toEqual({ x: arrow.position.x + 4, y: arrow.position.y + 6 });
  });
  it('translates a stroke by position only (points untouched)', () => {
    const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 1 }], position: { x: 2, y: 2 } });
    const patch = translateElementPatch(stroke, 1, 1);
    expect(patch).toEqual({ position: { x: 3, y: 3 } });
    expect('points' in patch).toBe(false);
  });
});
