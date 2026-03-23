import type { Point } from './types';

export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize || 0,
    y: Math.round(point.y / gridSize) * gridSize || 0,
  };
}
