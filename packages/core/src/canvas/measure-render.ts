import type { Point } from '../core/types';

/** Label parity contract: local tool and remote overlay must format identically. */
export function formatMeasureLabel(feet: number): string {
  return `${Math.round(feet)} ft`;
}

export interface MeasureRenderModel {
  readonly start: Point;
  readonly end: Point;
  readonly feet: number;
  readonly color: string;
}

/**
 * Draws one measurement — dashed segment, endpoint dots, rounded-pill distance
 * label — in world space. Shared by `MeasureTool.renderOverlay` and
 * `RemoteMeasureOverlay` so local and remote rulers stay pixel-identical.
 */
export function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  m: MeasureRenderModel,
  opts: { alpha?: number } = {},
): void {
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  ctx.strokeStyle = m.color;
  ctx.setLineDash([8, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m.start.x, m.start.y);
  ctx.lineTo(m.end.x, m.end.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = m.color;
  const dotRadius = 4;
  ctx.beginPath();
  ctx.arc(m.start.x, m.start.y, dotRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(m.end.x, m.end.y, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  const label = formatMeasureLabel(m.feet);
  const midX = (m.start.x + m.end.x) / 2;
  const midY = (m.start.y + m.end.y) / 2;
  ctx.font = '14px sans-serif';
  const metrics = ctx.measureText(label);
  const padX = 6;
  const padY = 4;
  const textH = 14;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(
    midX - metrics.width / 2 - padX,
    midY - textH / 2 - padY,
    metrics.width + padX * 2,
    textH + padY * 2,
    4,
  );
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX, midY);

  ctx.restore();
}
