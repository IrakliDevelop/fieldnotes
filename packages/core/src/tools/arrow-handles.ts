import type { Point } from '../core/types';
import type { ArrowElement, CanvasElement, TextElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { ToolContext } from './types';
import { getArrowMidpoint, getBendFromPoint } from '../elements/arrow-geometry';
import { findBindTarget, getElementCenter } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { getElbowRoute } from '../elements/elbow-cache';
import { DEFAULT_SELECTION_COLOR } from './selection-color';

const BIND_THRESHOLD = 20;

export type ArrowHandle = 'start' | 'mid' | 'end' | `segment:${number}`;

export interface ArrowHandleDrag {
  readonly fixedIndex?: number;
  readonly axis: 'x' | 'y';
  readonly insertIndex: number;
  readonly original: ArrowElement;
  readonly label?: { id: string; position: Point; size: { w: number; h: number } };
}

const HANDLE_RADIUS = 5;
const HANDLE_HIT_PADDING = 4;

const ARROW_HANDLE_CURSORS: Record<'start' | 'mid' | 'end', string> = {
  start: 'crosshair',
  end: 'crosshair',
  mid: 'grab',
};

export function getArrowHandleCursor(handle: ArrowHandle, active: boolean): string {
  if (handle === 'mid' || handle.startsWith('segment:')) return active ? 'grabbing' : 'grab';
  return handle === 'start' ? ARROW_HANDLE_CURSORS.start : ARROW_HANDLE_CURSORS.end;
}

export function getArrowHandlePositions(
  arrow: ArrowElement,
  store?: ElementStore,
): [ArrowHandle, Point][] {
  if (arrow.routing === 'elbow') {
    const route = getElbowRoute(store ?? null, arrow);
    if (!route) return [];
    const handles: [ArrowHandle, Point][] = [['start', route.points[0] ?? arrow.from]];
    for (let index = 1; index < route.points.length - 2; index += 1) {
      const from = route.points[index];
      const to = route.points[index + 1];
      if (!from || !to || (from.x === to.x && from.y === to.y)) continue;
      handles.push([`segment:${index}`, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }]);
    }
    handles.push(['end', route.points.at(-1) ?? arrow.to]);
    return handles;
  }
  const mid = getArrowMidpoint(arrow.from, arrow.to, arrow.bend);
  return [
    ['start', arrow.from],
    ['mid', mid],
    ['end', arrow.to],
  ];
}

export function hitTestArrowHandles(
  world: Point,
  selectedIds: string[],
  ctx: ToolContext,
): { elementId: string; handle: ArrowHandle } | null {
  if (selectedIds.length === 0) return null;

  const zoom = ctx.camera.zoom;
  const hitRadius = (HANDLE_RADIUS + HANDLE_HIT_PADDING) / zoom;

  for (const id of selectedIds) {
    const el = ctx.store.getById(id);
    if (!el || el.type !== 'arrow' || el.locked || (ctx.isLayerLocked?.(el.layerId) ?? false))
      continue;

    const handles = getArrowHandlePositions(el, ctx.store);
    for (const [handle, pos] of handles) {
      const dx = world.x - pos.x;
      const dy = world.y - pos.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return { elementId: id, handle };
      }
    }
  }

  return null;
}

export function applyArrowHandleDrag(
  handle: ArrowHandle,
  elementId: string,
  world: Point,
  ctx: ToolContext,
  drag?: ArrowHandleDrag,
): void {
  const el = ctx.store.getById(elementId);
  if (!el || el.type !== 'arrow' || el.locked || (ctx.isLayerLocked?.(el.layerId) ?? false)) return;

  const threshold = BIND_THRESHOLD / ctx.camera.zoom;

  const layerFilter = (candidate: CanvasElement) => candidate.layerId === el.layerId;

  if (handle.startsWith('segment:')) {
    if (!drag) return;
    const value = drag.axis === 'x' ? world.x : world.y;
    const fixed = drag.original.fixedSegments?.map((segment) => ({ ...segment })) ?? [];
    if (drag.fixedIndex === undefined)
      fixed.splice(drag.insertIndex, 0, { axis: drag.axis, value });
    else {
      const segment = fixed[drag.fixedIndex];
      if (!segment) return;
      fixed[drag.fixedIndex] = { ...segment, value };
    }
    ctx.store.update(elementId, { fixedSegments: fixed });
    ctx.requestRender();
    return;
  }

  switch (handle) {
    case 'start': {
      const excludeId = el.toBinding?.elementId;
      const target = findBindTarget(world, ctx.store, threshold, excludeId, layerFilter);
      if (target) {
        const center = getElementCenter(target);
        ctx.store.update(elementId, {
          from: center,
          position: center,
          fromBinding: { elementId: target.id },
        });
      } else {
        ctx.store.update(elementId, {
          from: { x: world.x, y: world.y },
          position: { x: world.x, y: world.y },
          fromBinding: undefined,
        });
      }
      break;
    }
    case 'end': {
      const excludeId = el.fromBinding?.elementId;
      const target = findBindTarget(world, ctx.store, threshold, excludeId, layerFilter);
      if (target) {
        const center = getElementCenter(target);
        ctx.store.update(elementId, {
          to: center,
          toBinding: { elementId: target.id },
        });
      } else {
        ctx.store.update(elementId, {
          to: { x: world.x, y: world.y },
          toBinding: undefined,
        });
      }
      break;
    }
    case 'mid': {
      const bend = getBendFromPoint(el.from, el.to, world);
      ctx.store.update(elementId, { bend });
      break;
    }
  }

  ctx.requestRender();
}

export function captureArrowHandleDrag(
  handle: ArrowHandle,
  elementId: string,
  ctx: ToolContext,
): ArrowHandleDrag | null {
  if (!handle.startsWith('segment:')) return null;
  const index = Number(handle.slice('segment:'.length));
  const arrow = ctx.store.getById(elementId);
  if (
    !Number.isInteger(index) ||
    !arrow ||
    arrow.type !== 'arrow' ||
    arrow.routing !== 'elbow' ||
    arrow.locked ||
    (ctx.isLayerLocked?.(arrow.layerId) ?? false)
  )
    return null;
  const route = getElbowRoute(ctx.store, arrow);
  const from = route?.points[index];
  const to = route?.points[index + 1];
  if (!route || !from || !to || (from.x === to.x && from.y === to.y)) return null;
  const fixedIndex = route.segments[index]?.fixedIndex;
  if (fixedIndex === undefined && (arrow.fixedSegments?.length ?? 0) >= 16) return null;
  const label = ctx.store
    .getChildren(arrow.id)
    .find((child): child is TextElement => child.type === 'text' && child.containerId === arrow.id);
  return {
    fixedIndex,
    axis: from.x === to.x ? 'x' : 'y',
    insertIndex: route.segments
      .slice(0, index)
      .filter((segment) => segment?.fixedIndex !== undefined).length,
    original: structuredClone(arrow),
    label: label
      ? { id: label.id, position: { ...label.position }, size: { ...label.size } }
      : undefined,
  };
}

export function restoreArrowHandleDrag(
  elementId: string,
  drag: ArrowHandleDrag,
  ctx: ToolContext,
): void {
  ctx.store.update(elementId, {
    ...drag.original,
    fromBinding: drag.original.fromBinding,
    toBinding: drag.original.toBinding,
    routing: drag.original.routing,
    fixedSegments: drag.original.fixedSegments,
  });
  if (drag.label)
    ctx.store.update(drag.label.id, { position: drag.label.position, size: drag.label.size });
  ctx.requestRender();
}

export function getArrowHandleDragTarget(
  handle: ArrowHandle,
  elementId: string,
  world: Point,
  ctx: ToolContext,
): { x: number; y: number; w: number; h: number } | null {
  if (handle === 'mid' || handle.startsWith('segment:')) return null;

  const el = ctx.store.getById(elementId);
  if (!el || el.type !== 'arrow' || el.locked || (ctx.isLayerLocked?.(el.layerId) ?? false)) {
    return null;
  }

  const threshold = BIND_THRESHOLD / ctx.camera.zoom;
  const excludeId = handle === 'start' ? el.toBinding?.elementId : el.fromBinding?.elementId;
  const layerFilter = (candidate: CanvasElement) => candidate.layerId === el.layerId;
  const target = findBindTarget(world, ctx.store, threshold, excludeId, layerFilter);
  if (!target) return null;

  return getElementBounds(target);
}

export function renderArrowHandles(
  canvasCtx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  zoom: number,
  color = DEFAULT_SELECTION_COLOR,
  store?: ElementStore,
): void {
  const radius = HANDLE_RADIUS / zoom;
  const handles = getArrowHandlePositions(arrow, store);

  canvasCtx.setLineDash([]);
  canvasCtx.lineWidth = 1.5 / zoom;

  for (const [handle, pos] of handles) {
    canvasCtx.fillStyle = handle === 'mid' ? color : '#ffffff';
    canvasCtx.strokeStyle = color;

    canvasCtx.beginPath();
    canvasCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.stroke();
  }
}

export function renderArrowHoverHandle(
  canvasCtx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  zoom: number,
  store?: ElementStore,
  color = DEFAULT_SELECTION_COLOR,
): void {
  const radius = HANDLE_RADIUS / zoom;
  canvasCtx.fillStyle = color;
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 1.5 / zoom;
  for (const [handle, position] of getArrowHandlePositions(arrow, store)) {
    if (handle === 'start' || handle === 'end') continue;
    canvasCtx.beginPath();
    canvasCtx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.stroke();
  }
}
