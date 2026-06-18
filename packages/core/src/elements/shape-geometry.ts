import type { Point } from '../core/types';
import type { ShapeElement } from './types';

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
