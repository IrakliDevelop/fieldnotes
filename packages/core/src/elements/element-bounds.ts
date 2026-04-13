import type { Bounds } from '../core/types';
import type { CanvasElement, TemplateElement } from './types';
import { getArrowControlPoint } from './arrow-geometry';

// Cache stroke bounds via WeakMap.
// May miss after ElementStore.update() creates new object via spread,
// acceptable since stroke points never change after commit.
const strokeBoundsCache = new WeakMap<CanvasElement, Bounds>();

export function getElementBounds(element: CanvasElement): Bounds | null {
  if (element.type === 'grid') return null;

  if ('size' in element) {
    return {
      x: element.position.x,
      y: element.position.y,
      w: element.size.w,
      h: element.size.h,
    };
  }

  if (element.type === 'stroke') {
    if (element.points.length === 0) return null;

    const cached = strokeBoundsCache.get(element);
    if (cached) return cached;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of element.points) {
      const px = p.x + element.position.x;
      const py = p.y + element.position.y;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }

    const bounds: Bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    strokeBoundsCache.set(element, bounds);
    return bounds;
  }

  if (element.type === 'arrow') {
    return getArrowBoundsAnalytical(element.from, element.to, element.bend);
  }

  if (element.type === 'template') {
    return getTemplateBounds(element);
  }

  return null;
}

function getArrowBoundsAnalytical(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bend: number,
): Bounds {
  if (bend === 0) {
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    return {
      x: minX,
      y: minY,
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    };
  }

  const cp = getArrowControlPoint(from, to, bend);

  let minX = Math.min(from.x, to.x);
  let maxX = Math.max(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxY = Math.max(from.y, to.y);

  // Analytical extrema for quadratic bezier: t = (P0 - P1) / (P0 - 2*P1 + P2)
  const tx = from.x - 2 * cp.x + to.x;
  if (tx !== 0) {
    const t = (from.x - cp.x) / tx;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const x = mt * mt * from.x + 2 * mt * t * cp.x + t * t * to.x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  const ty = from.y - 2 * cp.y + to.y;
  if (ty !== 0) {
    const t = (from.y - cp.y) / ty;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const y = mt * mt * from.y + 2 * mt * t * cp.y + t * t * to.y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function getTemplateBounds(el: TemplateElement): Bounds {
  const { x: cx, y: cy } = el.position;
  const r = el.radius;

  switch (el.templateShape) {
    case 'circle':
      return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };

    case 'square':
      return { x: cx - r / 2, y: cy - r / 2, w: r, h: r };

    case 'cone': {
      const halfAngle = Math.atan(0.5);
      const tipX = cx;
      const tipY = cy;
      const leftX = cx + r * Math.cos(el.angle - halfAngle);
      const leftY = cy + r * Math.sin(el.angle - halfAngle);
      const rightX = cx + r * Math.cos(el.angle + halfAngle);
      const rightY = cy + r * Math.sin(el.angle + halfAngle);
      const farX = cx + r * Math.cos(el.angle);
      const farY = cy + r * Math.sin(el.angle);

      const xs = [tipX, leftX, rightX, farX];
      const ys = [tipY, leftY, rightY, farY];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < xs.length; i++) {
        const px = xs[i];
        const py = ys[i];
        if (px !== undefined && px < minX) minX = px;
        if (px !== undefined && px > maxX) maxX = px;
        if (py !== undefined && py < minY) minY = py;
        if (py !== undefined && py > maxY) maxY = py;
      }

      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    case 'line': {
      const halfW = r / 12;
      const cos = Math.cos(el.angle);
      const sin = Math.sin(el.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;

      const x0 = cx + perpX;
      const y0 = cy + perpY;
      const x1 = cx + r * cos + perpX;
      const y1 = cy + r * sin + perpY;
      const x2 = cx + r * cos - perpX;
      const y2 = cy + r * sin - perpY;
      const x3 = cx - perpX;
      const y3 = cy - perpY;

      const minX = Math.min(x0, x1, x2, x3);
      const minY = Math.min(y0, y1, y2, y3);
      const maxX = Math.max(x0, x1, x2, x3);
      const maxY = Math.max(y0, y1, y2, y3);

      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
