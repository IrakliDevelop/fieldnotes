import type { CameraView } from './camera-view';

/**
 * The wire shape of a focus-request presence payload. Focus is ephemeral by
 * contract: presence frames only — never elements, undo history, persisted
 * canvas state, or durable operations. A frame that arrives while a client is
 * offline is dropped, never queued, and late joiners are never retro-focused.
 *
 * `audience` is a delivery hint, NOT a security boundary: the relay broadcasts
 * presence room-wide and receivers filter by their own role. The payload is a
 * map rectangle, not secret data; hidden elements stay behind relay `canRead`.
 */
export interface FocusPresence {
  readonly kind: 'focus';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly audience: FocusAudience;
  readonly color?: string;
}

export type FocusAudience = 'all' | 'players' | 'display';

export const FOCUS_PRESENCE_KIND = 'focus';

const AUDIENCES: readonly FocusAudience[] = ['all', 'players', 'display'];

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The only trust boundary between untyped wire data and the canvas. Mirrors
 * `isPingPresence`: every field is validated, and `color` is rejected when
 * defined but not a string, because it flows into canvas styling.
 *
 * These rules deliberately match `CameraView` validation, so a payload that
 * passes here can never make the animator's synchronous target validation
 * throw on the receive path.
 */
export function isFocusPresence(data: unknown): data is FocusPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    x?: unknown;
    y?: unknown;
    w?: unknown;
    h?: unknown;
    audience?: unknown;
    color?: unknown;
  };
  if (payload.kind !== FOCUS_PRESENCE_KIND) return false;
  if (!isFiniteNumber(payload.x) || !isFiniteNumber(payload.y)) return false;
  if (!isPositiveFinite(payload.w) || !isPositiveFinite(payload.h)) return false;
  if (typeof payload.audience !== 'string' || !AUDIENCES.some((a) => a === payload.audience)) {
    return false;
  }
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  return true;
}

/** Builds the presence payload for one local focus request. */
export function toFocusPresence(
  view: CameraView,
  audience: FocusAudience,
  color?: string,
): FocusPresence {
  return {
    kind: FOCUS_PRESENCE_KIND,
    x: view.x,
    y: view.y,
    w: view.w,
    h: view.h,
    audience,
    ...(color === undefined ? {} : { color }),
  };
}
