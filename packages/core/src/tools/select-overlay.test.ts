// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getOverlayLayout, getHandlePositions } from './select-overlay';
import { createNote } from '../elements/element-factory';

describe('select-overlay', () => {
  it('getOverlayLayout centers and rotates corners', () => {
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    note.rotation = Math.PI / 2;
    const layout = getOverlayLayout(note, 1);
    expect(layout?.center).toEqual({ x: 50, y: 50 });
    const nw = layout?.corners.find(([h]) => h === 'nw')?.[1];
    expect(nw && Math.abs(nw.x - 50) > 1).toBe(true);
  });
  it('getHandlePositions returns the four axis-aligned corners', () => {
    expect(getHandlePositions({ x: 0, y: 0, w: 10, h: 20 })).toEqual([
      ['nw', { x: 0, y: 0 }],
      ['ne', { x: 10, y: 0 }],
      ['sw', { x: 0, y: 20 }],
      ['se', { x: 10, y: 20 }],
    ]);
  });
});
