import type { Point } from '@fieldnotes/core';

/** World units spanning one CSS pixel; every on-screen pass draws under `scale(dpr)·…·scale(zoom)`. */
export function worldUnitsPerCssPx(ctx: CanvasRenderingContext2D): number {
  if (typeof ctx.getTransform !== 'function') return 1;
  const t = ctx.getTransform();
  const k = globalThis.devicePixelRatio / Math.hypot(t.a, t.b);
  return Number.isFinite(k) && k > 0 ? k : 1;
}

/** Text on a rounded pill centred `offsetCssPx` above `at`, sized in CSS pixels at any zoom. */
export function drawLabelPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Point,
  opts: { fontCssPx?: number; textColor?: string; fillColor?: string; offsetCssPx?: number },
): void {
  const k = worldUnitsPerCssPx(ctx);
  const fontPx = (opts.fontCssPx ?? 14) * k;
  const padX = 6 * k;
  const padY = 4 * k;
  const y = at.y - (opts.offsetCssPx ?? 18) * k;
  ctx.font = `bold ${fontPx}px sans-serif`;
  const width = ctx.measureText(text).width;
  ctx.fillStyle = opts.fillColor ?? 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(
    at.x - width / 2 - padX,
    y - fontPx / 2 - padY,
    width + padX * 2,
    fontPx + padY * 2,
    4 * k,
  );
  ctx.fill();
  ctx.fillStyle = opts.textColor ?? '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, y);
}
