import { describe, it, expect } from 'vitest';
import { expandToGroups } from './group';
import type { CanvasElement } from './types';

const el = (id: string, groupId?: string): CanvasElement =>
  ({
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'l',
    groupId,
  }) as unknown as CanvasElement;

describe('expandToGroups', () => {
  it('expands one member to all co-members', () => {
    const els = [el('a', 'g1'), el('b', 'g1'), el('c')];
    expect(expandToGroups(['a'], els).sort()).toEqual(['a', 'b']);
  });

  it('returns the same array reference when no selected element is grouped', () => {
    const els = [el('a'), el('b')];
    const ids = ['a'];
    expect(expandToGroups(ids, els)).toBe(ids);
  });

  it('includes every group a selection touches', () => {
    const els = [el('a', 'g1'), el('b', 'g1'), el('c', 'g2'), el('d', 'g2'), el('e')];
    expect(expandToGroups(['a', 'c'], els).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps ungrouped ids alongside expanded groups', () => {
    const els = [el('a', 'g1'), el('b', 'g1'), el('z')];
    expect(expandToGroups(['a', 'z'], els).sort()).toEqual(['a', 'b', 'z']);
  });

  it('does not duplicate a co-member already in the input', () => {
    const els = [el('a', 'g1'), el('b', 'g1')];
    expect(expandToGroups(['a', 'b'], els).sort()).toEqual(['a', 'b']);
  });
});
