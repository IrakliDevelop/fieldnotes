import type { Bounds } from '../core/types';
import { boundsIntersect, getElementBounds, getElementVisualBounds } from './element-bounds';
import { buildAuthoredElbowPath, getElbowRouteBounds, routeElbowArrow } from './elbow-routing';
import type { ElementStore } from './element-store';
import type { ArrowElement, CanvasElement } from './types';

interface CacheEntry {
  readonly route: ReturnType<typeof routeElbowArrow>;
  readonly region: Bounds;
  dirty: boolean;
  checkedGeneration: number;
}

interface StoreCache {
  readonly entries: WeakMap<ArrowElement, CacheEntry>;
  readonly affectedLayers: Set<string>;
  geometryGeneration: number;
}

export interface ElbowRouteChange {
  readonly previous?: CanvasElement;
  readonly current?: CanvasElement;
  readonly previousBounds?: Bounds | null;
  readonly currentBounds?: Bounds | null;
  readonly projectionChanged?: boolean;
}

const caches = new WeakMap<ElementStore, StoreCache>();
const visibleLayers = new WeakMap<ElementStore, (id: string) => boolean>();

interface RouteBoundsOverride {
  fromBounds?: Bounds | null;
  toBounds?: Bounds | null;
}

/** Installs the viewport's local layer visibility projection. */
export function setElbowVisibleLayers(
  store: ElementStore,
  isVisible: (id: string) => boolean,
): void {
  visibleLayers.set(store, isVisible);
  invalidateElbowRoutes(store, { projectionChanged: true });
}

function cacheFor(store: ElementStore): StoreCache {
  let cache = caches.get(store);
  if (!cache) {
    cache = { entries: new WeakMap(), affectedLayers: new Set(), geometryGeneration: 0 };
    caches.set(store, cache);
  }
  return cache;
}

/** Returns and clears layers whose cached elbow pixels need repainting. */
export function takeAffectedElbowLayers(store: ElementStore): string[] {
  const affected = cacheFor(store).affectedLayers;
  const layers = [...affected];
  affected.clear();
  return layers;
}

/** Keeps a route through a document-only arrow update. */
export function transferElbowRoute(
  store: ElementStore,
  previous: ArrowElement,
  current: ArrowElement,
): boolean {
  if (!sameRouteGeometry(previous, current)) return false;
  const entry = caches.get(store)?.entries.get(previous);
  if (!entry) return false;
  cacheFor(store).entries.set(current, entry);
  return true;
}

function sameRouteGeometry(previous: ArrowElement, current: ArrowElement): boolean {
  return (
    previous.routing === current.routing &&
    previous.width === current.width &&
    previous.from.x === current.from.x &&
    previous.from.y === current.from.y &&
    previous.to.x === current.to.x &&
    previous.to.y === current.to.y &&
    previous.fromBinding?.elementId === current.fromBinding?.elementId &&
    previous.toBinding?.elementId === current.toBinding?.elementId &&
    previous.fixedSegments?.length === current.fixedSegments?.length &&
    (previous.fixedSegments?.every(
      (segment, index) =>
        segment.axis === current.fixedSegments?.[index]?.axis &&
        segment.value === current.fixedSegments?.[index]?.value,
    ) ??
      true)
  );
}

/** Returns a store-local obstacle-aware route without changing document state. */
export function getElbowRoute(
  store: ElementStore | null,
  arrow: ArrowElement,
  override?: RouteBoundsOverride,
) {
  if (arrow.routing !== 'elbow') return null;
  if (!store) return routeElbowArrow(arrow, null, null, []);
  store.getAll();
  const cache = cacheFor(store);
  const cached = cache.entries.get(arrow);
  if (!override && cached && !cached.dirty) {
    if (cached.checkedGeneration !== cache.geometryGeneration)
      cached.checkedGeneration = cache.geometryGeneration;
    return cached.route;
  }
  const region = getElbowRouteBounds(arrow);
  const obstacles: { id: string; bounds: Bounds; distance: number }[] = [];
  const authoredBounds = boundsOf(buildAuthoredElbowPath(arrow).points);
  for (const element of store.queryRect(region)) {
    if (!(visibleLayers.get(store)?.(element.layerId) ?? true)) continue;
    if (!isObstacle(store, element, arrow)) continue;
    const bounds = clippedBounds(store, element);
    if (!bounds) continue;
    pushNearest(obstacles, {
      id: element.id,
      bounds,
      distance: distanceToBounds(bounds, authoredBounds),
    });
  }
  obstacles.sort(compareObstacles);
  const fromBounds =
    override?.fromBounds ??
    (arrow.fromBinding ? getBounds(store, arrow.fromBinding.elementId) : null);
  const toBounds =
    override?.toBounds ?? (arrow.toBinding ? getBounds(store, arrow.toBinding.elementId) : null);
  const route = routeElbowArrow(
    arrow,
    fromBounds,
    toBounds,
    obstacles.map((obstacle) => obstacle.bounds),
  );
  if (!override)
    cache.entries.set(arrow, {
      route,
      region,
      dirty: false,
      checkedGeneration: cache.geometryGeneration,
    });
  return route;
}

function getBounds(store: ElementStore, id: string): Bounds | null {
  const element = store.getById(id);
  return element && store.getEffectiveClip(id) !== undefined
    ? getElementBounds(element, store.elementRegistry)
    : null;
}

function isObstacle(store: ElementStore, element: CanvasElement, arrow: ArrowElement): boolean {
  if (!isOrdinaryObstacle(element)) return false;
  if (element.id === arrow.fromBinding?.elementId || element.id === arrow.toBinding?.elementId)
    return false;
  if (
    element.id === arrow.id ||
    store.getDescendants(arrow.id).some((child) => child.id === element.id)
  )
    return false;
  for (let parent = arrow.parentId; parent; parent = store.getById(parent)?.parentId) {
    if (parent === element.id) return false;
  }
  return true;
}

function boundsOf(points: readonly { x: number; y: number }[]): Bounds {
  let minX = points[0]?.x ?? 0;
  let maxX = minX;
  let minY = points[0]?.y ?? 0;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function compareObstacles(
  a: { id: string; distance: number },
  b: { id: string; distance: number },
): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function farther(
  a: { id: string; distance: number },
  b: { id: string; distance: number },
): boolean {
  return compareObstacles(a, b) > 0;
}

function pushNearest<T extends { id: string; distance: number }>(heap: T[], value: T): void {
  if (heap.length < 32) heap.push(value);
  else if (farther(heap[0] ?? value, value)) heap[0] = value;
  else return;
  let index = heap.length - 1;
  if (heap.length === 32 && heap[0] === value) index = 0;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentValue = heap[parent];
    const current = heap[index];
    if (!parentValue || !current || !farther(current, parentValue)) break;
    heap[index] = parentValue;
    heap[parent] = current;
    index = parent;
  }
  while (index * 2 + 1 < heap.length) {
    const left = index * 2 + 1;
    const right = left + 1;
    const rightValue = heap[right];
    const leftValue = heap[left];
    const child = rightValue && leftValue && farther(rightValue, leftValue) ? right : left;
    const current = heap[index];
    const childValue = heap[child];
    if (!current || !childValue || !farther(childValue, current)) break;
    heap[index] = childValue;
    heap[child] = current;
    index = child;
  }
}

function clippedBounds(store: ElementStore, element: CanvasElement): Bounds | null {
  const bounds = getElementVisualBounds(element, store.elementRegistry);
  const clip = store.getEffectiveClip(element.id);
  if (!bounds || clip === undefined) return null;
  if (!clip) return bounds;
  const x = Math.max(bounds.x, clip.x);
  const y = Math.max(bounds.y, clip.y);
  const right = Math.min(bounds.x + bounds.w, clip.x + clip.w);
  const bottom = Math.min(bounds.y + bounds.h, clip.y + clip.h);
  return x < right && y < bottom ? { x, y, w: right - x, h: bottom - y } : null;
}

function distanceToBounds(bounds: Bounds, region: Bounds): number {
  const x = Math.max(region.x - (bounds.x + bounds.w), bounds.x - (region.x + region.w), 0);
  const y = Math.max(region.y - (bounds.y + bounds.h), bounds.y - (region.y + region.h), 0);
  return Math.hypot(x, y);
}

/** Marks cached local routes affected by a scene change stale. */
export function invalidateElbowRoutes(store: ElementStore, change: ElbowRouteChange): void {
  const cache = caches.get(store);
  if (!cache) return;
  cache.geometryGeneration += 1;
  for (const arrow of store.getElementsByType('arrow')) {
    if (arrow.routing !== 'elbow') continue;
    const entry = cache.entries.get(arrow);
    const changedArrow =
      (change.previous?.type === 'arrow' && change.previous.id === arrow.id) ||
      (change.current?.type === 'arrow' && change.current.id === arrow.id);
    const boundTarget =
      (change.previous !== undefined &&
        (arrow.fromBinding?.elementId === change.previous.id ||
          arrow.toBinding?.elementId === change.previous.id)) ||
      (change.current !== undefined &&
        (arrow.fromBinding?.elementId === change.current.id ||
          arrow.toBinding?.elementId === change.current.id));
    const obstacleChanged =
      isOrdinaryObstacle(change.previous) || isOrdinaryObstacle(change.current);
    const intersects =
      (change.previousBounds !== undefined &&
        entry !== undefined &&
        change.previousBounds !== null &&
        boundsIntersect(entry.region, change.previousBounds)) ||
      (change.currentBounds !== undefined &&
        entry !== undefined &&
        change.currentBounds !== null &&
        boundsIntersect(entry.region, change.currentBounds));
    if (
      entry &&
      (change.projectionChanged || changedArrow || boundTarget || (obstacleChanged && intersects))
    ) {
      entry.dirty = true;
      cache.affectedLayers.add(arrow.layerId);
    }
    if (!entry && changedArrow) cache.affectedLayers.add(arrow.layerId);
  }
}

function isOrdinaryObstacle(element: CanvasElement | undefined): boolean {
  return (
    element !== undefined &&
    element.type !== 'arrow' &&
    element.type !== 'stroke' &&
    !(element.type === 'shape' && element.shape === 'line')
  );
}
