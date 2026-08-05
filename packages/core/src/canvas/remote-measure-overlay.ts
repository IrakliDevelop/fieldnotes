import type { Point } from '../core/types';
import type { MeasureEmission } from '../tools/measure-tool';

/**
 * The wire shape of a shared-ruler presence payload. Presence data is untyped
 * on the wire, so hosts discriminate on `kind`; `isMeasurePresence` validates
 * a received payload before it reaches the overlay. Distance is
 * sender-authoritative: receivers render the payload's `feet`/`cells` and
 * never recompute from their own grid. Measurements are ephemeral by
 * contract: presence only — never elements, undo history, persisted canvas
 * state, or durable operations.
 */
export type MeasurePresence =
  | {
      readonly kind: 'measure';
      readonly start: Point;
      readonly end: Point;
      readonly cells: number;
      readonly feet: number;
      readonly color?: string;
    }
  | { readonly kind: 'measure'; readonly cleared: true };

export const MEASURE_PRESENCE_KIND = 'measure';

function isFinitePoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

export function isMeasurePresence(data: unknown): data is MeasurePresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    cleared?: unknown;
    start?: unknown;
    end?: unknown;
    cells?: unknown;
    feet?: unknown;
    color?: unknown;
  };
  if (payload.kind !== MEASURE_PRESENCE_KIND) return false;
  if ('cleared' in payload) return payload.cleared === true;
  if (!isFinitePoint(payload.start) || !isFinitePoint(payload.end)) return false;
  if (typeof payload.cells !== 'number' || !Number.isFinite(payload.cells)) return false;
  if (typeof payload.feet !== 'number' || !Number.isFinite(payload.feet)) return false;
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  return true;
}

/** Builds the presence payload for one local `MeasureTool` emission. */
export function toMeasurePresence(emission: MeasureEmission | null): MeasurePresence {
  if (emission === null) return { kind: MEASURE_PRESENCE_KIND, cleared: true };
  return {
    kind: MEASURE_PRESENCE_KIND,
    start: emission.start,
    end: emission.end,
    cells: emission.cells,
    feet: emission.feet,
    color: emission.color,
  };
}
