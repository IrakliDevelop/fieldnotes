import type { Bounds, Point } from '../core/types';

export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// `mapping` is the union of the content bounds and the visible viewport, so the
// minimap always frames both what exists and where the camera is looking.
export function computeMinimapTransform(
  mapping: Bounds,
  miniW: number,
  miniH: number,
  padding: number,
): MinimapTransform {
  const availW = Math.max(1, miniW - 2 * padding);
  const availH = Math.max(1, miniH - 2 * padding);
  const w = Math.max(mapping.w, 1);
  const h = Math.max(mapping.h, 1);
  const scale = Math.min(availW / w, availH / h);
  const offsetX = (miniW - mapping.w * scale) / 2 - mapping.x * scale;
  const offsetY = (miniH - mapping.h * scale) / 2 - mapping.y * scale;
  return { scale, offsetX, offsetY };
}

export function worldToMini(t: MinimapTransform, p: Point): Point {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

export function miniToWorld(t: MinimapTransform, p: Point): Point {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}
