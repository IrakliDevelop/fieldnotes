import type { Bounds } from '../core/types';
import { rotatedAABB } from '../core/geometry';
import type { CanvasElement } from './types';
import type { ElementRegistry } from './element-registry';
import { getElementBounds } from './element-bounds';
import { getDefaultElementRegistry } from './default-registry';

function getStrokeBounds(el: CanvasElement): Bounds | null {
  if (el.type !== 'stroke') return null;
  if (el.points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of el.points) {
    const px = el.position.x + p.x;
    const py = el.position.y + p.y;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }

  const pad = el.width / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + el.width,
    h: maxY - minY + el.width,
  };
}

/** World-space rect an element occupies in exports, including rotation and stroke width. */
export function getElementRect(
  el: CanvasElement,
  registry: ElementRegistry = getDefaultElementRegistry(),
): Bounds | null {
  switch (el.type) {
    case 'stroke': {
      const r = getStrokeBounds(el);
      return r ? rotatedAABB(r, el.rotation ?? 0) : r;
    }
    case 'arrow': {
      const b = getElementBounds(el, registry);
      if (!b) return null;
      const pad = el.width / 2 + 14;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case 'note':
    case 'image':
    case 'html':
    case 'text':
    case 'shape':
      if ('size' in el) {
        return rotatedAABB(
          { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h },
          el.rotation ?? 0,
        );
      }
      return null;
    case 'extension':
      return registry.getAdapter(el.extensionType)?.bounds(el) ?? null;
    default:
      return null;
  }
}
