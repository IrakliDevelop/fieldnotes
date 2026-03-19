import type { Point } from '../core/types';
import type { ArrowElement } from '../elements/types';
import type { ToolContext } from './types';
import { getArrowMidpoint, getBendFromPoint } from '../elements/arrow-geometry';

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

  switch (handle) {
    case 'start':
      ctx.store.update(elementId, {
        from: { x: world.x, y: world.y },
        position: { x: world.x, y: world.y },
      });
      break;
    case 'end':
      ctx.store.update(elementId, {
        to: { x: world.x, y: world.y },
      });
      break;
    case 'mid': {
      const bend = getBendFromPoint(el.from, el.to, world);
      ctx.store.update(elementId, { bend });
      break;
    }
  }

  ctx.requestRender();
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
