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
  const obstacles: { id: string; bounds: Bounds; distance: number }[] = [];
  for (const element of store.queryRect(region)) {
    if (!(visibleLayers.get(store)?.(element.layerId) ?? true)) continue;
    if (!isObstacle(store, element, arrow)) continue;
    const bounds = clippedBounds(store, element);
    if (!bounds) continue;
    obstacles.push({ id: element.id, bounds, distance: distanceToBounds(bounds, region) });
  }
  obstacles.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const fromBounds = arrow.fromBinding ? getBounds(store, arrow.fromBinding.elementId) : null;
  const toBounds = arrow.toBinding ? getBounds(store, arrow.toBinding.elementId) : null;
  const route = routeElbowArrow(
    arrow,
    fromBounds,
    toBounds,
    obstacles.slice(0, 32).map((obstacle) => obstacle.bounds),
  );
  cache.set(arrow, { route, region, dirty: false });
  return route;
}

function getBounds(store: ElementStore, id: string): Bounds | null {
  const element = store.getById(id);
  return element ? getElementBounds(element, store.elementRegistry) : null;
}

function isObstacle(store: ElementStore, element: CanvasElement, arrow: ArrowElement): boolean {
  if (element.type === 'arrow' || element.type === 'stroke') return false;
  if (element.type === 'shape' && element.shape === 'line') return false;
  if (element.id === arrow.fromBinding?.elementId || element.id === arrow.toBinding?.elementId)
    return false;
  if (element.parentId === arrow.id || element.id === arrow.id) return false;
  for (let parent = arrow.parentId; parent; parent = store.getById(parent)?.parentId) {
    if (parent === element.id) return false;
  }
  return true;
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
  const x = Math.max(region.x, Math.min(bounds.x + bounds.w, region.x + region.w));
  const y = Math.max(region.y, Math.min(bounds.y + bounds.h, region.y + region.h));
  return Math.hypot(bounds.x + bounds.w / 2 - x, bounds.y + bounds.h / 2 - y);
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
