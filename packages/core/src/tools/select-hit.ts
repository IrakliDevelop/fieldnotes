import type { Bounds, Point } from '../core/types';
import type { ToolContext } from './types';
import { distSqToSegment, rotatePoint, rotatedAABB } from '../core/geometry';
import type { CanvasElement } from '../elements/types';
import { isNearBezier } from '../elements/arrow-geometry';
import { getElementBounds } from '../elements/element-bounds';
import { hitTestStroke } from '../elements/stroke-hit';
import { lineEndpoints } from '../elements/shape-geometry';
import type { HandlePosition } from './select-overlay';
import { getDefaultElementRegistry } from '../elements/default-registry';
import {
  HANDLE_SIZE,
  HANDLE_HIT_PADDING,
  ROTATABLE_TYPES,
  getOverlayLayout,
} from './select-overlay';

export function hitTest(
  world: Point,
  ctx: ToolContext,
  match?: (element: CanvasElement) => boolean,
): CanvasElement | null {
  // Inflate query by hit radius so strokes/arrows near the point are included
  const r = 10;
  const candidates = ctx.store
    .queryRect({ x: world.x - r, y: world.y - r, w: r * 2, h: r * 2 })
    .reverse();
  for (const el of candidates) {
    if (ctx.isLayerVisible && !ctx.isLayerVisible(el.layerId)) continue;
    if (ctx.isLayerLocked && ctx.isLayerLocked(el.layerId)) continue;
    if (match && !match(el)) continue;
    if (isInsideBounds(world, el, ctx)) return el;
  }
  return null;
}

export function isInsideBounds(point: Point, el: CanvasElement, ctx?: ToolContext): boolean {
  if (el.type === 'extension') {
    const registry = ctx?.elementRegistry ?? getDefaultElementRegistry();
    const adapter = registry.getAdapter(el.extensionType);
    if (!adapter || adapter.fullCanvas) return false;
    if (adapter.hitTest) return adapter.hitTest(el, point);
    const bounds = adapter.bounds(el);
    return (
      !!bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.w &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.h
    );
  }
  const angle = el.rotation ?? 0;
  if (angle !== 0) {
    const b = getElementBounds(el);
    if (b) {
      point = rotatePoint(point, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, -angle);
    }
  }
  if (el.type === 'shape' && el.shape === 'line') {
    const [a, b] = lineEndpoints(el);
    const threshold = Math.max(el.strokeWidth / 2, 6);
    return distSqToSegment(point, a, b) <= threshold * threshold;
  }
  if ('size' in el) {
    const s = el.size;
    return (
      point.x >= el.position.x &&
      point.x <= el.position.x + s.w &&
      point.y >= el.position.y &&
      point.y <= el.position.y + s.h
    );
  }

  if (el.type === 'stroke') {
    return hitTestStroke(el, point, 10);
  }

  if (el.type === 'arrow') {
    return isNearBezier(point, el.from, el.to, el.bend, 10);
  }

  return false;
}

export function hitTestExtensionHandle(
  world: Point,
  ctx: ToolContext,
  selectedIds: string[],
): { elementId: string; handleId: string; cursor: string } | null {
  for (const id of selectedIds) {
    const element = ctx.store.getById(id);
    if (
      !element ||
      element.type !== 'extension' ||
      element.locked ||
      (ctx.isLayerLocked?.(element.layerId) ?? false)
    )
      continue;
    const adapter = ctx.elementRegistry?.getAdapter(element.extensionType);
    const handle = adapter?.hitTestHandle?.(element, world, {
      zoom: ctx.camera.zoom,
      shiftKey: false,
      selectedCount: selectedIds.length,
      snap: { enabled: ctx.snapToGrid === true, size: ctx.gridSize, mode: ctx.gridType },
    });
    if (handle) return { elementId: id, handleId: handle.id, cursor: handle.cursor };
  }
  return null;
}

export function hitTestResizeHandle(
  world: Point,
  ctx: ToolContext,
  selectedIds: string[],
): { elementId: string; handle: HandlePosition } | null {
  if (selectedIds.length === 0) return null;

  const zoom = ctx.camera.zoom;
  const handleHalf = (HANDLE_SIZE / 2 + HANDLE_HIT_PADDING) / zoom;

  for (const id of selectedIds) {
    const el = ctx.store.getById(id);
    if (!el || !('size' in el)) continue;
    if (el.locked) continue;
    if (el.type === 'shape' && el.shape === 'line') continue;

    const layout = getOverlayLayout(el, zoom, ctx.elementRegistry);
    if (!layout) continue;
    for (const [handle, pos] of layout.corners) {
      if (Math.abs(world.x - pos.x) <= handleHalf && Math.abs(world.y - pos.y) <= handleHalf) {
        return { elementId: id, handle };
      }
    }
  }

  return null;
}

export function hitTestRotateHandle(
  world: Point,
  ctx: ToolContext,
  selectedIds: string[],
): { elementId: string } | null {
  if (selectedIds.length !== 1) return null;
  const id = selectedIds[0];
  if (!id) return null;
  const el = ctx.store.getById(id);
  if (!el || el.locked || !ROTATABLE_TYPES.has(el.type)) return null;
  const layout = getOverlayLayout(el, ctx.camera.zoom, ctx.elementRegistry);
  if (!layout) return null;
  const r = (HANDLE_SIZE / 2 + HANDLE_HIT_PADDING) / ctx.camera.zoom;
  const dx = world.x - layout.rotateHandle.x;
  const dy = world.y - layout.rotateHandle.y;
  return dx * dx + dy * dy <= r * r ? { elementId: id } : null;
}

export function hitTestLineHandles(
  world: Point,
  ctx: ToolContext,
  selectedIds: string[],
): { elementId: string; fixed: Point } | null {
  if (selectedIds.length === 0) return null;
  const zoom = ctx.camera.zoom;
  const r = (HANDLE_SIZE / 2 + HANDLE_HIT_PADDING) / zoom;
  const r2 = r * r;
  for (const id of selectedIds) {
    const el = ctx.store.getById(id);
    if (
      !el ||
      el.type !== 'shape' ||
      el.shape !== 'line' ||
      el.locked ||
      (ctx.isLayerLocked?.(el.layerId) ?? false)
    )
      continue;
    const [a, b] = lineEndpoints(el);
    if ((world.x - a.x) ** 2 + (world.y - a.y) ** 2 <= r2) return { elementId: id, fixed: b };
    if ((world.x - b.x) ** 2 + (world.y - b.y) ** 2 <= r2) return { elementId: id, fixed: a };
  }
  return null;
}

export function findElementsInRect(marquee: Bounds, ctx: ToolContext): string[] {
  const candidates = ctx.store.queryRect(marquee);
  const ids: string[] = [];
  for (const el of candidates) {
    if (ctx.isLayerVisible && !ctx.isLayerVisible(el.layerId)) continue;
    if (ctx.isLayerLocked && ctx.isLayerLocked(el.layerId)) continue;
    if (
      el.type === 'extension' &&
      (ctx.elementRegistry ?? getDefaultElementRegistry()).getAdapter(el.extensionType)?.fullCanvas
    ) {
      continue;
    }
    const bounds =
      el.type === 'extension'
        ? (ctx.elementRegistry ?? getDefaultElementRegistry())
            .getAdapter(el.extensionType)
            ?.bounds(el)
        : getElementBounds(el);
    if (bounds && rectsOverlap(marquee, rotatedAABB(bounds, el.rotation ?? 0))) {
      ids.push(el.id);
    }
  }
  return ids;
}

export function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
