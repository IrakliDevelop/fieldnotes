import type { Point } from '../core/types';
import { translateElementPatch } from './translate';
import type { CanvasElement } from './types';
import type { ElementStore } from './element-store';
import { findBoundArrows, updateBoundArrow } from './arrow-binding';

export interface HierarchyMove {
  readonly elements: readonly CanvasElement[];
  readonly roots: readonly CanvasElement[];
  readonly rootIds: ReadonlyMap<string, string>;
}

/** Expands literal ids through valid descendants in stable scene order. */
export function getHierarchyClosure(ids: readonly string[], store: ElementStore): HierarchyMove {
  const scene = store.getAll();
  const sceneIds = new Set(scene.map((element) => element.id));
  const directIds = new Set(ids.filter((id) => sceneIds.has(id)));
  const inheritedIds = new Set<string>();
  for (const id of directIds) {
    for (const descendant of store.getDescendants(id)) inheritedIds.add(descendant.id);
  }
  const roots = scene.filter(
    (element) => directIds.has(element.id) && !inheritedIds.has(element.id),
  );
  const elements: CanvasElement[] = [];
  const rootIdByElementId = new Map<string, string>();
  for (const root of roots) {
    elements.push(root);
    rootIdByElementId.set(root.id, root.id);
    for (const descendant of store.getDescendants(root.id)) {
      elements.push(descendant);
      rootIdByElementId.set(descendant.id, root.id);
    }
  }
  return { roots, elements, rootIds: rootIdByElementId };
}

/** Expands unlocked direct roots through their valid descendants in scene order. */
export function getHierarchyMove(ids: readonly string[], store: ElementStore): HierarchyMove {
  const directIds = new Set<string>();
  for (const id of ids) {
    const element = store.getById(id);
    if (
      !element ||
      element.locked ||
      (element.type === 'arrow' && (element.fromBinding || element.toBinding)) ||
      directIds.has(id)
    )
      continue;
    directIds.add(id);
  }

  return getHierarchyClosure([...directIds], store);
}

/** Moves valid hierarchy subtrees to a layer in one atomic store update. */
export function moveHierarchyToLayer(
  ids: readonly string[],
  layerId: string,
  store: ElementStore,
): boolean {
  const move = getHierarchyClosure(ids, store);
  const closureIds = new Set(move.elements.map((element) => element.id));
  const updates = move.elements.flatMap((element) => {
    const rootId = move.rootIds.get(element.id);
    const root = rootId ? store.getById(rootId) : undefined;
    if (!root || root.layerId === layerId) return [];
    return [
      {
        id: element.id,
        partial:
          element.id === root.id && element.parentId && !closureIds.has(element.parentId)
            ? { layerId, parentId: undefined }
            : { layerId },
      },
    ];
  });
  if (updates.length === 0) return false;
  store.updateMany(updates);
  return true;
}

/** Translates a hierarchy move atomically and returns the moved scene elements. */
export function moveHierarchy(
  ids: readonly string[],
  dx: number,
  dy: number,
  store: ElementStore,
): HierarchyMove {
  const move = getHierarchyMove(ids, store);
  const deltas = new Map(move.roots.map((root) => [root.id, { x: dx, y: dy }]));
  moveHierarchyByRoot(move, deltas, store);
  return move;
}

/** Translates each hierarchy root and all of its descendants in one store batch. */
export function moveHierarchyByRoot(
  move: HierarchyMove,
  deltas: ReadonlyMap<string, Point>,
  store: ElementStore,
): void {
  if (move.elements.length === 0) return;
  store.updateMany(
    move.elements.flatMap((element) => {
      const rootId = move.rootIds.get(element.id);
      const delta = rootId ? deltas.get(rootId) : undefined;
      return delta
        ? [{ id: element.id, partial: translateElementPatch(element, delta.x, delta.y) }]
        : [];
    }),
  );
}

/** Reanchors arrows outside the movement closure once after a hierarchy batch. */
export function updateExternalBoundArrows(movedIds: Iterable<string>, store: ElementStore): void {
  const closureIds = new Set(movedIds);
  const arrows = new Map<string, ReturnType<typeof findBoundArrows>[number]>();
  for (const id of closureIds) {
    const element = store.getById(id);
    if (!element || element.type === 'arrow') continue;
    for (const arrow of findBoundArrows(id, store)) {
      if (!closureIds.has(arrow.id)) arrows.set(arrow.id, arrow);
    }
  }
  const updates = [...arrows.values()].flatMap((arrow) => {
    const partial = updateBoundArrow(arrow, store);
    return partial ? [{ id: arrow.id, partial }] : [];
  });
  if (updates.length > 0) store.updateMany(updates);
}

export interface HierarchyOrigins {
  readonly positions: ReadonlyMap<string, Point>;
  readonly arrowEnds: ReadonlyMap<string, { readonly from: Point; readonly to: Point }>;
}

/** Captures enough geometry to restore a move without reading later state. */
export function captureHierarchyOrigins(elements: readonly CanvasElement[]): HierarchyOrigins {
  const positions = new Map<string, Point>();
  const arrowEnds = new Map<string, { from: Point; to: Point }>();
  for (const element of elements) {
    positions.set(element.id, element.position);
    if (element.type === 'arrow') arrowEnds.set(element.id, { from: element.from, to: element.to });
  }
  return { positions, arrowEnds };
}

/** Restores a captured hierarchy move atomically. */
export function restoreHierarchyOrigins(origins: HierarchyOrigins, store: ElementStore): void {
  if (origins.positions.size === 0) return;
  store.updateMany(
    [...origins.positions].map(([id, position]) => ({
      id,
      partial: { position, ...origins.arrowEnds.get(id) },
    })),
  );
}
