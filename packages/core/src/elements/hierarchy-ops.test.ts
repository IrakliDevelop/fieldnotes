import { describe, expect, it, vi } from 'vitest';
import { createArrow, createNote, createStroke } from './element-factory';
import { ElementStore } from './element-store';
import {
  captureHierarchyOrigins,
  getHierarchyMove,
  moveHierarchy,
  restoreHierarchyOrigins,
  updateExternalBoundArrows,
  getHierarchyClosure,
  moveHierarchyToLayer,
} from './hierarchy-ops';

function addTree(store: ElementStore): void {
  store.add({
    ...createNote({ position: { x: 10, y: 20 }, layerId: 'a', index: 'a' }),
    id: 'root',
  });
  store.add({
    ...createNote({ position: { x: 30, y: 40 }, layerId: 'a', index: 'b', parentId: 'root' }),
    id: 'child',
  });
  store.add({
    ...createNote({
      position: { x: 50, y: 60 },
      layerId: 'a',
      index: 'c',
      parentId: 'child',
      locked: true,
    }),
    id: 'locked',
  });
}

describe('hierarchy operations', () => {
  it('moves a selected subtree atomically and retains its internal links', () => {
    const store = new ElementStore();
    addTree(store);
    const events: string[] = [];
    store.on('update', ({ current }) => events.push(current.id));

    expect(moveHierarchyToLayer(['root'], 'b', store)).toBe(true);

    expect(events).toEqual(['root', 'child', 'locked']);
    expect(
      store.getAll().map((element) => [element.id, element.layerId, element.parentId]),
    ).toEqual([
      ['root', 'b', undefined],
      ['child', 'b', 'root'],
      ['locked', 'b', 'child'],
    ]);
  });

  it('detaches a child subtree and ignores duplicate, missing, and same-layer inputs', () => {
    const store = new ElementStore();
    addTree(store);
    const events: string[] = [];
    store.on('update', ({ current }) => events.push(current.id));

    expect(moveHierarchyToLayer(['missing', 'child', 'child'], 'b', store)).toBe(true);
    expect(events).toEqual(['child', 'locked']);
    expect(store.getById('child')).toMatchObject({ layerId: 'b', parentId: undefined });
    expect(store.getById('locked')).toMatchObject({ layerId: 'b', parentId: 'child' });

    expect(moveHierarchyToLayer(['root', 'root'], 'a', store)).toBe(false);
    expect(events).toEqual(['child', 'locked']);
  });

  it('moves an overlapping literal layer selection once in stable subtree order', () => {
    const store = new ElementStore();
    addTree(store);
    const updates: string[] = [];
    store.on('update', ({ current }) => updates.push(current.id));

    expect(moveHierarchyToLayer(['locked', 'root', 'child', 'root'], 'b', store)).toBe(true);

    expect(updates).toEqual(['root', 'child', 'locked']);
    expect(
      store.getAll().map((element) => [element.id, element.layerId, element.parentId]),
    ).toEqual([
      ['root', 'b', undefined],
      ['child', 'b', 'root'],
      ['locked', 'b', 'child'],
    ]);
  });

  it('expands literal roots through locked and bound-arrow descendants in stable DFS order', () => {
    const store = new ElementStore();
    addTree(store);
    const arrow = {
      ...createArrow({
        position: { x: 70, y: 80 },
        from: { x: 70, y: 80 },
        to: { x: 90, y: 100 },
        layerId: 'a',
        index: 'd',
        parentId: 'root',
        fromBinding: { elementId: 'root', anchor: { x: 0.5, y: 0.5 } },
      }),
      id: 'bound-arrow',
    };
    const other = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'a', index: 'z' }),
      id: 'other',
    };
    store.add(arrow);
    store.add(other);

    const closure = getHierarchyClosure(['other', 'locked', 'root', 'missing'], store);

    expect(closure.roots.map((element) => element.id)).toEqual(['root', 'other']);
    expect(closure.elements.map((element) => element.id)).toEqual([
      'root',
      'child',
      'locked',
      'bound-arrow',
      'other',
    ]);
  });

  it('canonicalizes overlap in either input order with stable DFS descendants', () => {
    const store = new ElementStore();
    addTree(store);
    for (const ids of [
      ['child', 'root'],
      ['root', 'child'],
    ]) {
      const move = getHierarchyMove(ids, store);
      expect(move.roots.map((element) => element.id)).toEqual(['root']);
      expect(move.elements.map((element) => element.id)).toEqual(['root', 'child', 'locked']);
    }
  });

  it('does not move a locked direct root or an unknown id', () => {
    const store = new ElementStore();
    addTree(store);
    expect(getHierarchyMove(['locked', 'missing'], store).elements).toEqual([]);
  });

  it('translates notes, strokes, and arrows atomically', () => {
    const store = new ElementStore();
    const note = {
      ...createNote({ position: { x: 1, y: 2 }, layerId: 'a', index: 'a' }),
      id: 'note',
    };
    const stroke = {
      ...createStroke({
        position: { x: 3, y: 4 },
        layerId: 'a',
        index: 'b',
        points: [{ x: 0, y: 0, pressure: 1 }],
      }),
      id: 'stroke',
    };
    const arrow = {
      ...createArrow({
        position: { x: 5, y: 6 },
        layerId: 'a',
        index: 'c',
        parentId: 'note',
        from: { x: 5, y: 6 },
        to: { x: 8, y: 9 },
      }),
      id: 'arrow',
    };
    store.add(note);
    store.add(stroke);
    store.add(arrow);
    const seen: { id: string; x: number; y: number }[][] = [];
    store.on('update', () =>
      seen.push(store.getAll().map((element) => ({ id: element.id, ...element.position }))),
    );
    moveHierarchy(['note', 'stroke'], 10, -2, store);
    expect(store.getById('note')?.position).toEqual({ x: 11, y: 0 });
    expect(store.getById('stroke')?.position).toEqual({ x: 13, y: 2 });
    expect(store.getById('arrow')).toMatchObject({
      position: { x: 15, y: 4 },
      from: { x: 15, y: 4 },
      to: { x: 18, y: 7 },
    });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toEqual([
      { id: 'note', x: 11, y: 0 },
      { id: 'arrow', x: 15, y: 4 },
      { id: 'stroke', x: 13, y: 2 },
    ]);
  });

  it('includes inherited bound arrows but blocks them as direct roots', () => {
    const store = new ElementStore();
    const parent = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'a', index: 'a' }),
      id: 'parent',
    };
    const arrow = {
      ...createArrow({
        layerId: 'a',
        index: 'b',
        parentId: 'parent',
        position: { x: 10, y: 20 },
        from: { x: 10, y: 20 },
        to: { x: 30, y: 40 },
        fromBinding: { elementId: 'parent', anchor: { x: 0.5, y: 0.5 } },
      }),
      id: 'arrow',
    };
    store.add(parent);
    store.add(arrow);

    expect(getHierarchyMove(['arrow'], store).elements).toEqual([]);
    moveHierarchy(['parent'], 4, -3, store);
    expect(store.getById('arrow')).toMatchObject({
      position: { x: 14, y: 17 },
      from: { x: 14, y: 17 },
      to: { x: 34, y: 37 },
    });
    expect(store.getVersion('arrow')).toBe(1);
  });

  it('restores full arrow geometry and only refreshes external bound arrows', () => {
    const store = new ElementStore();
    const parent = {
      ...createNote({
        position: { x: 10, y: 20 },
        size: { w: 80, h: 60 },
        layerId: 'a',
        index: 'a',
      }),
      id: 'parent',
    };
    const child = {
      ...createArrow({
        position: { x: 15, y: 25 },
        from: { x: 15, y: 25 },
        to: { x: 30, y: 40 },
        fromBinding: { elementId: 'parent', anchor: { x: 0.5, y: 0.5 } },
        parentId: 'parent',
        layerId: 'a',
        index: 'b',
      }),
      id: 'child',
    };
    const external = {
      ...createArrow({
        position: { x: 0, y: 0 },
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        fromBinding: { elementId: 'parent', anchor: { x: 0.5, y: 0.5 } },
        layerId: 'a',
        index: 'c',
      }),
      id: 'external',
    };
    store.add(parent);
    store.add(child);
    store.add(external);
    const move = getHierarchyMove(['parent'], store);
    const origins = captureHierarchyOrigins(move.elements);
    moveHierarchy(['parent'], 7, 8, store);
    updateExternalBoundArrows(
      move.elements.map((element) => element.id),
      store,
    );
    expect(store.getVersion('child')).toBe(1);
    expect(store.getVersion('external')).toBe(1);
    expect(store.getById('child')).toMatchObject({
      position: { x: 22, y: 33 },
      from: { x: 22, y: 33 },
      to: { x: 37, y: 48 },
    });
    expect(store.getById('external')).toMatchObject({
      position: { x: 57, y: 58 },
      from: { x: 57, y: 58 },
      to: { x: 100, y: 100 },
    });
    restoreHierarchyOrigins(origins, store);
    updateExternalBoundArrows(origins.positions.keys(), store);
    expect(store.getById('child')).toMatchObject({
      position: { x: 15, y: 25 },
      from: { x: 15, y: 25 },
      to: { x: 30, y: 40 },
    });
    expect(store.getVersion('external')).toBe(2);
    expect(store.getById('external')).toMatchObject({
      position: { x: 50, y: 50 },
      from: { x: 50, y: 50 },
      to: { x: 100, y: 100 },
    });
  });

  it('does not call updateMany for an empty movement closure', () => {
    const store = new ElementStore();
    const updateMany = vi.spyOn(store, 'updateMany');
    moveHierarchy(['missing'], 1, 1, store);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
