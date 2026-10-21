import type { Point } from '@fieldnotes/core';
import { drawLabelPill, worldUnitsPerCssPx } from './screen-scale';

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
  const k = worldUnitsPerCssPx(ctx);

  ctx.strokeStyle = m.color;
  ctx.setLineDash([8 * k, 4 * k]);
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(m.start.x, m.start.y);
  ctx.lineTo(m.end.x, m.end.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = m.color;
  const dotRadius = 4 * k;
  ctx.beginPath();
  ctx.arc(m.start.x, m.start.y, dotRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(m.end.x, m.end.y, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  const mid = { x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2 };
  drawLabelPill(ctx, formatMeasureLabel(m.feet), mid, { offsetCssPx: 0 });

  ctx.restore();
}
