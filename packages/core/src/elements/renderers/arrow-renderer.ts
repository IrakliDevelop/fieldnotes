import type { ArrowElement, ArrowStrokeStyle } from '../types';
import type { ElementStore } from '../element-store';
import { getArrowRenderGeometry } from '../arrow-render-cache';
import { getArrowMidpoint } from '../arrow-geometry';
import { getEdgeIntersection } from '../arrow-binding';
import { getElementBounds } from '../element-bounds';

const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;
const ARROW_LABEL_FONT_SIZE = 14;

export function getArrowDashPattern(strokeStyle: ArrowStrokeStyle | undefined): number[] {
  switch (strokeStyle) {
    case 'dashed':
      return [8, 4];
    case 'dotted':
      return [2, 4];
    default:
      return [];
  }
}

export function renderArrow(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  store: ElementStore | null,
  labelEditingId: string | null,
): void {
  const geometry = getArrowRenderGeometry(arrow);
  const { visualFrom, visualTo } = getVisualEndpoints(arrow, geometry, store);

  ctx.save();
  ctx.strokeStyle = arrow.color;
  ctx.lineWidth = arrow.width;
  ctx.lineCap = 'round';

  const dash = getArrowDashPattern(arrow.strokeStyle);
  if (dash.length > 0) ctx.setLineDash(dash);

  ctx.beginPath();
  ctx.moveTo(visualFrom.x, visualFrom.y);

  if (arrow.bend !== 0) {
    const cp = geometry.controlPoint;
    if (cp) {
      ctx.quadraticCurveTo(cp.x, cp.y, visualTo.x, visualTo.y);
    }
  } else {
    ctx.lineTo(visualTo.x, visualTo.y);
  }
  ctx.stroke();

  renderArrowhead(ctx, arrow, visualTo, geometry.tangentEnd);
  ctx.restore();
  renderArrowLabel(ctx, arrow, labelEditingId);
}

function renderArrowLabel(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  labelEditingId: string | null,
): void {
  if (!arrow.label || arrow.label.length === 0) return;
  if (arrow.id === labelEditingId) return;
  const mid = getArrowMidpoint(arrow.from, arrow.to, arrow.bend);
  ctx.save();
  ctx.font = `${ARROW_LABEL_FONT_SIZE}px system-ui, sans-serif`;
  const metrics = ctx.measureText(arrow.label);
  const padX = 6;
  const padY = 4;
  const w = metrics.width + padX * 2;
  const h = ARROW_LABEL_FONT_SIZE + padY * 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.roundRect(mid.x - w / 2, mid.y - h / 2, w, h, 4);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(arrow.label, mid.x, mid.y);
  ctx.restore();
}

function renderArrowhead(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  tip: { x: number; y: number },
  angle: number,
): void {
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE),
    tip.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE),
  );
  ctx.lineTo(
    tip.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE),
    tip.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE),
  );
  ctx.closePath();
  ctx.fillStyle = arrow.color;
  ctx.fill();
}

export function getVisualEndpoints(
  arrow: ArrowElement,
  geometry: ReturnType<typeof getArrowRenderGeometry>,
  store: ElementStore | null,
): {
  visualFrom: { x: number; y: number };
  visualTo: { x: number; y: number };
} {
  let visualFrom = arrow.from;
  let visualTo = arrow.to;

  if (!store) return { visualFrom, visualTo };

  if (arrow.fromBinding) {
    const el = store.getById(arrow.fromBinding.elementId);
    if (el) {
      const bounds = getElementBounds(el);
      if (bounds) {
        const tangentAngle = geometry.tangentStart;
        const rayTarget = {
          x: arrow.from.x + Math.cos(tangentAngle) * 1000,
          y: arrow.from.y + Math.sin(tangentAngle) * 1000,
        };
        visualFrom = getEdgeIntersection(bounds, rayTarget);
      }
    }
  }

  if (arrow.toBinding) {
    const el = store.getById(arrow.toBinding.elementId);
    if (el) {
      const bounds = getElementBounds(el);
      if (bounds) {
        const tangentAngle = geometry.tangentEnd;
        // Reverse tangent — at t=1 tangent points away from curve body,
        // but we need the ray from center back toward the curve
        const rayTarget = {
          x: arrow.to.x - Math.cos(tangentAngle) * 1000,
          y: arrow.to.y - Math.sin(tangentAngle) * 1000,
        };
        visualTo = getEdgeIntersection(bounds, rayTarget);
      }
    }
  }

  return { visualFrom, visualTo };
}
