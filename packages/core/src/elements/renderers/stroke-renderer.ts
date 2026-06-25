import type { StrokeElement } from '../types';
import { getStrokeRenderData } from '../stroke-cache';

export function renderStroke(ctx: CanvasRenderingContext2D, stroke: StrokeElement): void {
  if (stroke.points.length < 2) return;

  ctx.save();
  if (stroke.blendMode) ctx.globalCompositeOperation = stroke.blendMode;
  ctx.translate(stroke.position.x, stroke.position.y);
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.opacity;

  const data = getStrokeRenderData(stroke);
  if (data.buckets) {
    for (const bucket of data.buckets) {
      ctx.lineWidth = bucket.width;
      ctx.stroke(bucket.path);
    }
  } else {
    for (let i = 0; i < data.segments.length; i++) {
      const seg = data.segments[i];
      const w = data.widths[i];
      if (!seg || w === undefined) continue;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}
