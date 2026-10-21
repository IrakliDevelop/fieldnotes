import type { Point } from '@fieldnotes/core';
import type { TemplateShape } from '../elements/types';
import { drawLabelPill, worldUnitsPerCssPx } from '../screen-scale';

export interface TemplateFeetLabelParams {
  position: Point;
  radius: number;
  angle: number;
  templateShape: TemplateShape;
  feet: number;
  color: string;
}

export function renderTemplateFeetLabel(
  ctx: CanvasRenderingContext2D,
  p: TemplateFeetLabelParams,
): void {
  if (p.feet <= 0) return;
  const k = worldUnitsPerCssPx(ctx);
  const onScreenRadius = p.radius / k;
  // Below this the pill would cover the template it labels (e.g. on the minimap).
  if (onScreenRadius < 16) return;

  const directional =
    p.templateShape === 'cone' || p.templateShape === 'line' || p.templateShape === 'rectangle';
  const dir = directional ? p.angle : 0;
  const length = p.templateShape === 'square' ? p.radius / 2 : p.radius;
  const cos = Math.cos(dir);
  const sin = Math.sin(dir);
  const start = p.position;
  const end = { x: start.x + length * cos, y: start.y + length * sin };
  const mid = { x: start.x + (length / 2) * cos, y: start.y + (length / 2) * sin };

  ctx.save();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.setLineDash([4 * k, 4 * k]);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1.5 * k;
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const fontCssPx = Math.max(10, Math.min(14, onScreenRadius * 0.15));
  drawLabelPill(ctx, `${Math.round(p.feet)} ft`, mid, { fontCssPx });

  ctx.restore();
}
