import type { Bounds } from '../core/types';
import { boundsIntersect, getElementBounds, getElementVisualBounds } from './element-bounds';
import { getElbowRouteBounds, routeElbowArrow } from './elbow-routing';
import type { ElementStore } from './element-store';
import type { ArrowElement, CanvasElement } from './types';

interface CacheEntry {
  readonly route: ReturnType<typeof routeElbowArrow>;
  readonly region: Bounds;
  dirty: boolean;
}

const caches = new WeakMap<ElementStore, WeakMap<ArrowElement, CacheEntry>>();
const visibleLayers = new WeakMap<ElementStore, (id: string) => boolean>();

/** Installs the viewport's local layer visibility projection. */
export function setElbowVisibleLayers(
  store: ElementStore,
  isVisible: (id: string) => boolean,
): void {
  visibleLayers.set(store, isVisible);
  invalidateElbowRoutes(store, null);
}

function cacheFor(store: ElementStore): WeakMap<ArrowElement, CacheEntry> {
  let cache = caches.get(store);
  if (!cache) {
    cache = new WeakMap();
    caches.set(store, cache);
  }
  return cache;
}

/** Returns a store-local obstacle-aware route without changing document state. */
export function getElbowRoute(store: ElementStore | null, arrow: ArrowElement) {
  if (arrow.routing !== 'elbow') return null;
  if (!store) return routeElbowArrow(arrow, null, null, []);
  const cache = cacheFor(store);
  const cached = cache.get(arrow);
  if (cached && !cached.dirty) return cached.route;
  const region = getElbowRouteBounds(arrow);
  const obstacles: Bounds[] = [];
  for (const element of store.queryRect(region)) {
    if (!(visibleLayers.get(store)?.(element.layerId) ?? true)) continue;
    if (!isObstacle(element, arrow)) continue;
    const bounds = getElementVisualBounds(element, store.elementRegistry);
    if (bounds) obstacles.push(bounds);
  }
  const fromBounds = arrow.fromBinding ? getBounds(store, arrow.fromBinding.elementId) : null;
  const toBounds = arrow.toBinding ? getBounds(store, arrow.toBinding.elementId) : null;
  const route = routeElbowArrow(arrow, fromBounds, toBounds, obstacles);
  cache.set(arrow, { route, region, dirty: false });
  return route;
}

function getBounds(store: ElementStore, id: string): Bounds | null {
  const element = store.getById(id);
  return element ? getElementBounds(element, store.elementRegistry) : null;
}

function isObstacle(element: CanvasElement, arrow: ArrowElement): boolean {
  if (element.type === 'arrow' || element.type === 'stroke') return false;
  if (element.id === arrow.fromBinding?.elementId || element.id === arrow.toBinding?.elementId)
    return false;
  return true;
}

/** Marks cached local routes affected by a scene change stale. */
export function invalidateElbowRoutes(store: ElementStore, bounds: Bounds | null): void {
  const cache = caches.get(store);
  if (!cache) return;
  for (const arrow of store.getElementsByType('arrow')) {
    if (arrow.routing !== 'elbow') continue;
    const entry = cache.get(arrow);
    if (entry && (!bounds || boundsIntersect(entry.region, bounds))) entry.dirty = true;
  }
}
