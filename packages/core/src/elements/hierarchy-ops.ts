import type { Point } from '../core/types';
import { translateElementPatch } from './translate';
import type { CanvasElement } from './types';
import type { ElementStore } from './element-store';

export interface HierarchyMove {
  readonly elements: readonly CanvasElement[];
  readonly roots: readonly CanvasElement[];
}

/** Expands unlocked direct roots through their valid descendants in scene order. */
export function getHierarchyMove(ids: readonly string[], store: ElementStore): HierarchyMove {
  const roots: CanvasElement[] = [];
  const included = new Set<string>();
  for (const id of ids) {
    const element = store.getById(id);
    if (
      !element ||
      element.locked ||
      (element.type === 'arrow' && (element.fromBinding || element.toBinding)) ||
      included.has(id)
    )
      continue;
    roots.push(element);
    included.add(id);
    for (const descendant of store.getDescendants(id)) included.add(descendant.id);
  }
  return {
    roots,
    elements: store
      .getAll()
      .filter(
        (element) =>
          included.has(element.id) &&
          !(element.type === 'arrow' && (element.fromBinding || element.toBinding)),
      ),
  };
}

/** Translates a hierarchy move atomically and returns the moved scene elements. */
export function moveHierarchy(
  ids: readonly string[],
  dx: number,
  dy: number,
  store: ElementStore,
): HierarchyMove {
  const move = getHierarchyMove(ids, store);
  store.updateMany(
    move.elements.map((element) => ({
      id: element.id,
      partial: translateElementPatch(element, dx, dy),
    })),
  );
  return move;
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
  store.updateMany(
    [...origins.positions].map(([id, position]) => ({
      id,
      partial: { position, ...origins.arrowEnds.get(id) },
    })),
  );
}
