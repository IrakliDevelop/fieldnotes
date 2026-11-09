import type { ArrowElement, ArrowStrokeStyle } from '../types';
import type { ElementStore } from '../element-store';
import { getArrowCurve, getArrowEndTangent, getArrowLabelAnchor } from '../arrow-geometry';
import { getElementBounds } from '../element-bounds';
import { getBoundText } from '../bound-text';
import { getElbowRoute } from '../elbow-cache';

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
): void {
  const resolveBounds = (id: string) => {
    const element = store?.getById(id);
    return element ? getElementBounds(element) : null;
  };
  const route = getElbowRoute(store, arrow);
  const curve = getArrowCurve(arrow, resolveBounds);

  ctx.save();
  ctx.strokeStyle = arrow.color;
  ctx.lineWidth = arrow.width;
  ctx.lineCap = 'round';

  const dash = getArrowDashPattern(arrow.strokeStyle);
  if (dash.length > 0) ctx.setLineDash(dash);

  ctx.beginPath();
  ctx.moveTo(route?.points[0]?.x ?? curve.from.x, route?.points[0]?.y ?? curve.from.y);

  if (route) {
    for (const point of route.points.slice(1)) ctx.lineTo(point.x, point.y);
  } else if (arrow.bend !== 0) {
    ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y);
  } else {
    ctx.lineTo(curve.to.x, curve.to.y);
  }
  ctx.stroke();

  const last = route?.points.at(-1) ?? curve.to;
  const angle = getArrowEndTangent(arrow, curve.t1, route?.points);
  if (angle !== null) {
    renderArrowhead(ctx, arrow, last, angle);
  }
  ctx.restore();
  renderArrowLabel(ctx, arrow, store, resolveBounds);
}

function renderArrowLabel(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  store: ElementStore | null,
  resolveBounds: (id: string) => { x: number; y: number; w: number; h: number } | null,
): void {
  const boundText = store && getBoundText(arrow, store);
  if (boundText) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const angle = boundText.rotation ?? 0;
    if (angle) {
      const x = boundText.position.x + boundText.size.w / 2;
      const y = boundText.position.y + boundText.size.h / 2;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.translate(-x, -y);
    }
    ctx.beginPath();
    ctx.roundRect(
      boundText.position.x - 4,
      boundText.position.y - 2,
      boundText.size.w + 8,
      boundText.size.h + 4,
      4,
    );
    ctx.fill();
    ctx.restore();
    return;
  }
  if (!arrow.label || arrow.label.length === 0) return;
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
