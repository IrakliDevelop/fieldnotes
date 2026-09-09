import type { Point } from '../core/types';
import type { CanvasElement } from '../elements/types';
import { rotatePoint } from '../core/geometry';
import type { HandlePosition } from './select-overlay';

export const MIN_ELEMENT_SIZE = 20;

export function anchorOffset(handle: HandlePosition, w: number, h: number): Point {
  switch (handle) {
    case 'se':
      return { x: -w / 2, y: -h / 2 };
    case 'sw':
      return { x: w / 2, y: -h / 2 };
    case 'ne':
      return { x: -w / 2, y: h / 2 };
    case 'nw':
      return { x: w / 2, y: h / 2 };
    default:
      return { x: 0, y: 0 };
  }
}

export function computeResize(
  el: CanvasElement & { size: { w: number; h: number } },
  handle: HandlePosition,
  world: Point,
  lastWorld: Point,
  aspectRatio: number,
  lockAspect: boolean,
): { position: { x: number; y: number }; size: { w: number; h: number } } {
  const dx = world.x - lastWorld.x;
  const dy = world.y - lastWorld.y;

  let { x, y, w, h } = { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h };

  switch (handle) {
    case 'se':
      w += dx;
      h += dy;
      break;
    case 'sw':
      x += dx;
      w -= dx;
      h += dy;
      break;
    case 'ne':
      y += dy;
      w += dx;
      h -= dy;
      break;
    case 'nw':
      x += dx;
      y += dy;
      w -= dx;
      h -= dy;
      break;
  }

  if (lockAspect && aspectRatio > 0) {
    const absDw = Math.abs(w - el.size.w);
    const absDh = Math.abs(h - el.size.h);
    if (absDw >= absDh) {
      h = w / aspectRatio;
    } else {
      w = h * aspectRatio;
    }
    if (handle === 'nw' || handle === 'sw') {
      x = el.position.x + el.size.w - w;
    }
    if (handle === 'nw' || handle === 'ne') {
      y = el.position.y + el.size.h - h;
    }
  }

  if (w < MIN_ELEMENT_SIZE) {
    if (handle === 'nw' || handle === 'sw') x = el.position.x + el.size.w - MIN_ELEMENT_SIZE;
    w = MIN_ELEMENT_SIZE;
  }
  if (h < MIN_ELEMENT_SIZE) {
    if (handle === 'nw' || handle === 'ne') y = el.position.y + el.size.h - MIN_ELEMENT_SIZE;
    h = MIN_ELEMENT_SIZE;
  }

  return { position: { x, y }, size: { w, h } };
}

export function computeRotatedResize(
  el: CanvasElement & { size: { w: number; h: number } },
  handle: HandlePosition,
  angle: number,
  world: Point,
  lastWorld: Point,
  aspectRatio: number,
  lockAspect: boolean,
): { position: { x: number; y: number }; size: { w: number; h: number } } {
  const wdx = world.x - lastWorld.x;
  const wdy = world.y - lastWorld.y;

  // world delta → element local frame (inverse rotation of the vector)
  const cosN = Math.cos(-angle);
  const sinN = Math.sin(-angle);
  const ldx = wdx * cosN - wdy * sinN;
  const ldy = wdx * sinN + wdy * cosN;

  let w = el.size.w;
  let h = el.size.h;
  switch (handle) {
    case 'se':
      w += ldx;
      h += ldy;
      break;
    case 'sw':
      w -= ldx;
      h += ldy;
      break;
    case 'ne':
      w += ldx;
      h -= ldy;
      break;
    case 'nw':
      w -= ldx;
      h -= ldy;
      break;
  }

  if (lockAspect && aspectRatio > 0) {
    const absDw = Math.abs(w - el.size.w);
    const absDh = Math.abs(h - el.size.h);
    if (absDw >= absDh) h = w / aspectRatio;
    else w = h * aspectRatio;
  }
  w = Math.max(w, MIN_ELEMENT_SIZE);
  h = Math.max(h, MIN_ELEMENT_SIZE);

  // anchor (opposite corner) fixed in world space, computed from OLD geometry
  const oldCenter = { x: el.position.x + el.size.w / 2, y: el.position.y + el.size.h / 2 };
  const oldAnchorLocal = anchorOffset(handle, el.size.w, el.size.h);
  const anchorWorld = rotatePoint(
    { x: oldCenter.x + oldAnchorLocal.x, y: oldCenter.y + oldAnchorLocal.y },
    oldCenter,
    angle,
  );

  // new center so the anchor stays put: anchorWorld = newCenter + R(angle)·newAnchorLocal
  const newAnchorLocal = anchorOffset(handle, w, h);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotatedAnchor = {
    x: newAnchorLocal.x * cos - newAnchorLocal.y * sin,
    y: newAnchorLocal.x * sin + newAnchorLocal.y * cos,
  };
  const newCenter = { x: anchorWorld.x - rotatedAnchor.x, y: anchorWorld.y - rotatedAnchor.y };
  const position = { x: newCenter.x - w / 2, y: newCenter.y - h / 2 };

  return { position, size: { w, h } };
}
