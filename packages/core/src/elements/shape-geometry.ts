import type { Point, Size } from '../core/types';
import type { ShapeElement } from './types';

/** Inverse of lineEndpoints: two endpoints → a line shape's bbox + flip. */
export function lineFromEndpoints(a: Point, b: Point): { position: Point; size: Size; flip: boolean } {
  return {
    position: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    size: { w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
    flip: (b.x > a.x) !== (b.y > a.y),
  };
}

/** The two segment endpoints of a 'line' shape, from its bbox + flip. */
export function lineEndpoints(shape: ShapeElement): [Point, Point] {
  const { x, y } = shape.position;
  const { w, h } = shape.size;
  return shape.flip
    ? [
        { x, y: y + h },
        { x: x + w, y },
      ]
    : [
        { x, y },
        { x: x + w, y: y + h },
      ];
}
