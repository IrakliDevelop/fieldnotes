import type { Point } from './types';

/**
 * Snap a point to the nearest grid intersection. A generic primitive used by
 * the constraint service fallback; domain-aware snapping (hex, footprint) lives
 * in `@fieldnotes/vtt`.
 */
export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize || 0,
    y: Math.round(point.y / gridSize) * gridSize || 0,
  };
}
