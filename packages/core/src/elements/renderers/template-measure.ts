import type { Point } from '../../core/types';
import type { TemplateShape } from '../types';

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

  const directional =
    p.templateShape === 'cone' || p.templateShape === 'line' || p.templateShape === 'rectangle';
  const dir = directional ? p.angle : 0;
  const length = p.templateShape === 'square' ? p.radius / 2 : p.radius;
  const cos = Math.cos(dir);
  const sin = Math.sin(dir);
  const start = p.position;
  const end = { x: start.x + length * cos, y: start.y + length * sin };
  const midX = start.x + (length / 2) * cos;
  const midY = start.y + (length / 2) * sin;

  ctx.save();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1.5;
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const label = `${Math.round(p.feet)} ft`;
  const fontSize = Math.max(10, Math.min(14, p.radius * 0.15));
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const textY = midY - 4;

  const metrics = ctx.measureText(label);
  const padX = 4;
  const padY = 2;
  const textW = metrics.width + padX * 2;
  const textH = fontSize + padY * 2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.roundRect(midX - textW / 2, textY - textH, textW, textH, 3);
  ctx.fill();

  ctx.fillStyle = p.color;
  ctx.fillText(label, midX, textY - padY);

  ctx.restore();
}
