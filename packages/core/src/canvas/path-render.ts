import type { Point } from '../core/types';
import { formatMeasureLabel } from './measure-render';

export interface PathRenderModel {
  readonly points: readonly Point[];
  /** One entry per segment (`points.length - 1`); missing entries use `color`. */
  readonly segmentColors: readonly string[];
  readonly color: string;
  readonly feet: number;
}

/**
 * Colour per segment from cumulative feet at each point: the first band
 * (ascending `feet`) that still covers the segment's END total wins; beyond
 * every band the base colour is used. Shared by the local tool and the remote
 * overlay so a sender's bands render identically everywhere.
 */
export function resolveSegmentColors(
  cumulativeFeet: readonly number[],
  bands: readonly { feet: number; color: string }[],
  color: string,
): string[] {
  const sorted = [...bands].sort((a, b) => a.feet - b.feet);
  const out: string[] = [];
  for (let i = 1; i < cumulativeFeet.length; i++) {
    const end = cumulativeFeet[i] ?? 0;
    const band = sorted.find((b) => b.feet >= end);
    out.push(band ? band.color : color);
  }
  return out;
}

const LABEL_OFFSET_Y = 18;

/** Dashed polyline with waypoint dots and a running-total label at the last point. */
export function drawPath(
  ctx: CanvasRenderingContext2D,
  m: PathRenderModel,
  opts: { alpha?: number } = {},
): void {
  const first = m.points[0];
  if (first === undefined) return;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.lineWidth = 2;
  let prev = first;
  for (let i = 1; i < m.points.length; i++) {
    const next = m.points[i];
    if (next === undefined) break;
    ctx.strokeStyle = m.segmentColors[i - 1] ?? m.color;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    prev = next;
  }
  ctx.setLineDash([]);
  ctx.fillStyle = m.color;
  for (const p of m.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (m.points.length >= 2) {
    const last = prev;
    const label = formatMeasureLabel(m.feet);
    ctx.font = '14px sans-serif';
    const metrics = ctx.measureText(label);
    const padX = 6;
    const padY = 4;
    const textH = 14;
    const cx = last.x;
    const cy = last.y - LABEL_OFFSET_Y;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(
      cx - metrics.width / 2 - padX,
      cy - textH / 2 - padY,
      metrics.width + padX * 2,
      textH + padY * 2,
      4,
    );
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
  }
  ctx.restore();
}
