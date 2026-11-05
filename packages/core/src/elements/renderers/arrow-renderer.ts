import type { ArrowElement, ArrowStrokeStyle } from '../types';
import type { ElementStore } from '../element-store';
import { getArrowCurve, getArrowLabelAnchor, getArrowTangentAngle } from '../arrow-geometry';
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
  const resolveBounds = (id: string) => {
    const element = store?.getById(id);
    return element ? getElementBounds(element) : null;
  };
  const curve = getArrowCurve(arrow, resolveBounds);

  ctx.save();
  ctx.strokeStyle = arrow.color;
  ctx.lineWidth = arrow.width;
  ctx.lineCap = 'round';

  const dash = getArrowDashPattern(arrow.strokeStyle);
  if (dash.length > 0) ctx.setLineDash(dash);

  ctx.beginPath();
  ctx.moveTo(curve.from.x, curve.from.y);

  if (arrow.bend !== 0) {
    ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y);
  } else {
    ctx.lineTo(curve.to.x, curve.to.y);
  }
  ctx.stroke();

  renderArrowhead(
    ctx,
    arrow,
    curve.to,
    getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, curve.t1),
  );
  ctx.restore();
  renderArrowLabel(ctx, arrow, labelEditingId, resolveBounds);
}

function renderArrowLabel(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  labelEditingId: string | null,
  resolveBounds: (id: string) => { x: number; y: number; w: number; h: number } | null,
): void {
  if (!arrow.label || arrow.label.length === 0) return;
  if (arrow.id === labelEditingId) return;
  const mid = getArrowLabelAnchor(arrow, resolveBounds);
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
