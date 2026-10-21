import type { Point } from '@fieldnotes/core';
import { drawLabelPill, worldUnitsPerCssPx } from './screen-scale';

function formatDistanceLabel(feet: number): string {
  return `${Math.round(feet)} ft`;
}

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
  const k = worldUnitsPerCssPx(ctx);
  ctx.lineWidth = 2 * k;
  let prev = first;
  for (let i = 1; i < m.points.length; i++) {
    const next = m.points[i];
    if (next === undefined) break;
    ctx.strokeStyle = m.segmentColors[i - 1] ?? m.color;
    ctx.setLineDash([8 * k, 4 * k]);
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
    ctx.arc(p.x, p.y, 4 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  if (m.points.length >= 2) drawLabelPill(ctx, formatDistanceLabel(m.feet), prev, {});
  ctx.restore();
}
