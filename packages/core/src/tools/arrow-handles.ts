import type { Point } from '../core/types';
import type { ArrowElement, CanvasElement } from '../elements/types';
import type { ToolContext } from './types';
import { getArrowMidpoint, getBendFromPoint } from '../elements/arrow-geometry';
import { findBindTarget, getElementCenter, getElementBounds } from '../elements/arrow-binding';

const BIND_THRESHOLD = 20;

export type ArrowHandle = 'start' | 'mid' | 'end';

const HANDLE_RADIUS = 5;
const HANDLE_HIT_PADDING = 4;

const ARROW_HANDLE_CURSORS: Record<ArrowHandle, string> = {
  start: 'crosshair',
  end: 'crosshair',
  mid: 'grab',
};

export function getArrowHandleCursor(handle: ArrowHandle, active: boolean): string {
  if (handle === 'mid' && active) return 'grabbing';
  return ARROW_HANDLE_CURSORS[handle];
}

export function getArrowHandlePositions(arrow: ArrowElement): [ArrowHandle, Point][] {
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
    if (!el || el.type !== 'arrow') continue;

    const handles = getArrowHandlePositions(el);
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
): void {
  const el = ctx.store.getById(elementId);
  if (!el || el.type !== 'arrow') return;

  const threshold = BIND_THRESHOLD / ctx.camera.zoom;

  const layerFilter = (candidate: CanvasElement) => candidate.layerId === el.layerId;

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

export function getArrowHandleDragTarget(
  handle: ArrowHandle,
  elementId: string,
  world: Point,
  ctx: ToolContext,
): { x: number; y: number; w: number; h: number } | null {
  if (handle === 'mid') return null;

  const el = ctx.store.getById(elementId);
  if (!el || el.type !== 'arrow') return null;

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
): void {
  const radius = HANDLE_RADIUS / zoom;
  const handles = getArrowHandlePositions(arrow);

  canvasCtx.setLineDash([]);
  canvasCtx.lineWidth = 1.5 / zoom;

  for (const [handle, pos] of handles) {
    canvasCtx.fillStyle = handle === 'mid' ? '#2196F3' : '#ffffff';
    canvasCtx.strokeStyle = '#2196F3';

    canvasCtx.beginPath();
    canvasCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.stroke();
  }
}
