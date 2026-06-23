import type { Point } from '../core/types';

export function withRotation(
  ctx: CanvasRenderingContext2D,
  el: { rotation?: number },
  center: Point,
  draw: () => void,
): void {
  const angle = el.rotation ?? 0;
  if (angle === 0) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.translate(-center.x, -center.y);
  draw();
  ctx.restore();
}
