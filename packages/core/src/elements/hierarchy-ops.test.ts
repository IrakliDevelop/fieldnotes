import { describe, expect, it } from 'vitest';
import { createArrow, createNote, createStroke } from './element-factory';
import { ElementStore } from './element-store';
import { getHierarchyMove, moveHierarchy } from './hierarchy-ops';

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
  it('expands an unlocked root in stable DFS order and includes locked descendants once', () => {
    const store = new ElementStore();
    addTree(store);
    expect(
      getHierarchyMove(['child', 'root'], store).elements.map((element) => element.id),
    ).toEqual(['root', 'child', 'locked']);
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
});
