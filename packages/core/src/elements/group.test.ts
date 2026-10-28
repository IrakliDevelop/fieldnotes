import { describe, it, expect } from 'vitest';
import { expandToGroups } from './group';
import { ElementStore } from './element-store';
import { getHierarchyClosure, moveHierarchyToLayer } from './hierarchy-ops';
import type { CanvasElement } from './types';

const el = (id: string, groupId?: string): CanvasElement =>
  ({
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    index: 'a0',
    version: 1,
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

  it('composes group expansion with hierarchy closure without duplicate descendants', () => {
    const store = new ElementStore();
    store.add(el('parent', 'g1'));
    store.add({ ...el('child', 'g1'), parentId: 'parent', index: 'a1' });
    store.add({ ...el('other', 'g1'), index: 'a2' });

    const expanded = expandToGroups(['child'], store.getAll());
    const closure = getHierarchyClosure(expanded, store);

    expect(closure.roots.map((element) => element.id)).toEqual(['parent', 'other']);
    expect(closure.elements.map((element) => element.id)).toEqual(['parent', 'child', 'other']);
  });

  it('moves an expanded group hierarchy once in stable scene order', () => {
    const store = new ElementStore();
    store.add(el('parent', 'g1'));
    store.add({ ...el('child', 'g1'), parentId: 'parent', index: 'a1' });
    store.add({ ...el('other', 'g1'), index: 'a2' });
    const updates: string[] = [];
    store.on('update', ({ current }) => updates.push(current.id));

    expect(moveHierarchyToLayer(expandToGroups(['child'], store.getAll()), 'target', store)).toBe(
      true,
    );

    expect(updates).toEqual(['parent', 'child', 'other']);
    expect(
      store
        .getAll()
        .map((element) => [element.id, element.layerId, element.parentId, element.version]),
    ).toEqual([
      ['parent', 'target', undefined, 2],
      ['child', 'target', 'parent', 2],
      ['other', 'target', undefined, 2],
    ]);
  });
});
