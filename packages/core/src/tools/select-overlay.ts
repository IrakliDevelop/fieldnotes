import type { Bounds, Point } from '../core/types';
import type { CanvasElement, ArrowElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { SnapGuide } from '../elements/snap-guides';
import { getElementBounds } from '../elements/element-bounds';
import { rotatePoint } from '../core/geometry';
import { lineEndpoints } from '../elements/shape-geometry';
import { renderArrowHandles } from './arrow-handles';

export type HandlePosition = 'nw' | 'ne' | 'sw' | 'se';

export const HANDLE_SIZE = 8;
export const HANDLE_HIT_PADDING = 4;
export const SELECTION_PAD = 4;
export const ROTATE_HANDLE_OFFSET = 24;
export const ROTATABLE_TYPES = new Set(['note', 'text', 'image', 'html', 'shape', 'stroke']);

export const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

export interface OverlayLayout {
  center: Point;
  corners: [HandlePosition, Point][];
  rotateHandle: Point;
  angle: number;
}

export function getOverlayLayout(el: CanvasElement, zoom: number): OverlayLayout | null {
  const bounds = getElementBounds(el);
  if (!bounds) return null;
  const angle = el.rotation ?? 0;
  const pad = SELECTION_PAD / zoom;
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const raw: [HandlePosition, Point][] = [
    ['nw', { x: bounds.x - pad, y: bounds.y - pad }],
    ['ne', { x: bounds.x + bounds.w + pad, y: bounds.y - pad }],
    ['sw', { x: bounds.x - pad, y: bounds.y + bounds.h + pad }],
    ['se', { x: bounds.x + bounds.w + pad, y: bounds.y + bounds.h + pad }],
  ];
  const corners = raw.map(
    ([h, p]) => [h, rotatePoint(p, center, angle)] as [HandlePosition, Point],
  );
  const topMid = { x: center.x, y: bounds.y - pad - ROTATE_HANDLE_OFFSET / zoom };
  const rotateHandle = rotatePoint(topMid, center, angle);
  return { center, corners, rotateHandle, angle };
}

export function templateAimKnob(
  el: CanvasElement,
  zoom: number,
): { origin: Point; knob: Point } | null {
  if (el.type !== 'template') return null;
  if (
    el.templateShape !== 'cone' &&
    el.templateShape !== 'line' &&
    el.templateShape !== 'rectangle'
  )
    return null;
  const gap = ROTATE_HANDLE_OFFSET / zoom;
  const dist = el.radius + gap;
  const origin = el.position;
  return {
    origin,
    knob: {
      x: origin.x + dist * Math.cos(el.angle),
      y: origin.y + dist * Math.sin(el.angle),
    },
  };
}

export function getHandlePositions(bounds: Bounds): [HandlePosition, Point][] {
  return [
    ['nw', { x: bounds.x, y: bounds.y }],
    ['ne', { x: bounds.x + bounds.w, y: bounds.y }],
    ['sw', { x: bounds.x, y: bounds.y + bounds.h }],
    ['se', { x: bounds.x + bounds.w, y: bounds.y + bounds.h }],
  ];
}

export function topMidpoint(layout: { corners: [HandlePosition, Point][] }): Point {
  const nw = layout.corners.find(([h]) => h === 'nw')?.[1] ?? { x: 0, y: 0 };
  const ne = layout.corners.find(([h]) => h === 'ne')?.[1] ?? { x: 0, y: 0 };
  return { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
}

export function drawLockBadge(ctx: CanvasRenderingContext2D, at: Point, zoom: number): void {
  const r = 9 / zoom;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();
  const bw = 8 / zoom;
  const bh = 6 / zoom;
  ctx.fillStyle = '#2196F3';
  ctx.fillRect(at.x - bw / 2, at.y - bh / 2 + 1 / zoom, bw, bh);
  ctx.beginPath();
  ctx.arc(at.x, at.y - bh / 2 + 1 / zoom, 2.5 / zoom, Math.PI, 0);
  ctx.lineWidth = 1.4 / zoom;
  ctx.stroke();
  ctx.restore();
}

export function renderMarquee(ctx: CanvasRenderingContext2D, rect: Bounds): void {
  ctx.save();
  ctx.strokeStyle = '#2196F3';
  ctx.fillStyle = 'rgba(33, 150, 243, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

export function renderBindingHighlights(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  zoom: number,
  store: ElementStore,
): void {
  if (!arrow.fromBinding && !arrow.toBinding) return;

  const pad = SELECTION_PAD / zoom;

  ctx.save();
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([]);

  const drawn = new Set<string>();
  for (const binding of [arrow.fromBinding, arrow.toBinding]) {
    if (!binding || drawn.has(binding.elementId)) continue;
    drawn.add(binding.elementId);

    const target = store.getById(binding.elementId);
    if (!target) continue;

    const bounds = getElementBounds(target);
    if (!bounds) continue;

    ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
  }

  ctx.restore();
}

export function renderSelectionBoxes(
  ctx: CanvasRenderingContext2D,
  p: { selectedIds: string[]; store: ElementStore; zoom: number },
): void {
  if (p.selectedIds.length === 0) return;

  const zoom = p.zoom;
  const handleWorldSize = HANDLE_SIZE / zoom;

  ctx.save();
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);

  for (const id of p.selectedIds) {
    const el = p.store.getById(id);
    if (!el) continue;

    if (el.type === 'arrow') {
      renderArrowHandles(ctx, el, zoom);
      renderBindingHighlights(ctx, el, zoom, p.store);
      continue;
    }

    if (el.type === 'shape' && el.shape === 'line') {
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      const r = handleWorldSize / 2;
      for (const pt of lineEndpoints(el)) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      continue;
    }

    const bounds = getElementBounds(el);
    if (!bounds) continue;

    const layout = getOverlayLayout(el, zoom);
    if (!layout) continue;

    const pad = SELECTION_PAD / zoom;
    if (layout.angle === 0) {
      ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
    } else {
      const ordered = (['nw', 'ne', 'se', 'sw'] as HandlePosition[])
        .map((h) => layout.corners.find(([c]) => c === h)?.[1])
        .filter((pp): pp is Point => !!pp);
      const [p0, ...others] = ordered;
      if (p0) {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (const pp of others) ctx.lineTo(pp.x, pp.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (!el.locked) {
      if ('size' in el) {
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        const corners = layout.angle === 0 ? getHandlePositions(bounds) : layout.corners;
        for (const [, pos] of corners) {
          ctx.fillRect(
            pos.x - handleWorldSize / 2,
            pos.y - handleWorldSize / 2,
            handleWorldSize,
            handleWorldSize,
          );
          ctx.strokeRect(
            pos.x - handleWorldSize / 2,
            pos.y - handleWorldSize / 2,
            handleWorldSize,
            handleWorldSize,
          );
        }
        ctx.setLineDash([4 / zoom, 4 / zoom]);
      } else if (el.type === 'template') {
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        const hx = bounds.x + bounds.w;
        const hy = bounds.y + bounds.h;
        ctx.fillRect(
          hx - handleWorldSize / 2,
          hy - handleWorldSize / 2,
          handleWorldSize,
          handleWorldSize,
        );
        ctx.strokeRect(
          hx - handleWorldSize / 2,
          hy - handleWorldSize / 2,
          handleWorldSize,
          handleWorldSize,
        );
        ctx.setLineDash([4 / zoom, 4 / zoom]);

        if (
          p.selectedIds.length === 1 &&
          (el.templateShape === 'cone' ||
            el.templateShape === 'line' ||
            el.templateShape === 'rectangle')
        ) {
          const aim = templateAimKnob(el, zoom);
          if (aim) {
            ctx.beginPath();
            ctx.moveTo(aim.origin.x, aim.origin.y);
            ctx.lineTo(aim.knob.x, aim.knob.y);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(aim.knob.x, aim.knob.y, handleWorldSize / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([4 / zoom, 4 / zoom]);
          }
        }
      }

      if (p.selectedIds.length === 1 && ROTATABLE_TYPES.has(el.type)) {
        const stemStart = topMidpoint(layout);
        const stemEnd = layout.rotateHandle;
        ctx.beginPath();
        ctx.moveTo(stemStart.x, stemStart.y);
        ctx.lineTo(stemEnd.x, stemEnd.y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(stemEnd.x, stemEnd.y, handleWorldSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([4 / zoom, 4 / zoom]);
      }
    }

    if (el.locked) {
      const ne = layout.corners.find(([h]) => h === 'ne')?.[1];
      if (ne) drawLockBadge(ctx, ne, zoom);
    }
  }

  ctx.restore();
}

export function renderGuideLines(
  ctx: CanvasRenderingContext2D,
  p: { guides: SnapGuide[]; rect: Bounds | null; currentWorld: Point; zoom: number },
): void {
  const zoom = p.zoom;
  const rect = p.rect; // cached at drag start (same source as the candidate query)
  ctx.save();
  ctx.strokeStyle = '#FF4081';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  for (const g of p.guides) {
    ctx.beginPath();
    if (g.axis === 'x') {
      const y0 = rect ? rect.y : p.currentWorld.y - 1e5;
      const y1 = rect ? rect.y + rect.h : p.currentWorld.y + 1e5;
      ctx.moveTo(g.position, y0);
      ctx.lineTo(g.position, y1);
    } else {
      const x0 = rect ? rect.x : p.currentWorld.x - 1e5;
      const x1 = rect ? rect.x + rect.w : p.currentWorld.x + 1e5;
      ctx.moveTo(x0, g.position);
      ctx.lineTo(x1, g.position);
    }
    ctx.stroke();
  }
  ctx.restore();
}
