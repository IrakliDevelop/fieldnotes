import type { Point } from '../core/types';

/**
 * Sender identity carried on every awareness frame. `id` is the app's stable
 * peer id (a character id, a user id); `name`, `color`, and `role` are
 * self-asserted display data. Receivers MUST treat `name` as untrusted text
 * (render through canvas text or `textContent`, never as HTML) and MUST NOT
 * gate anything security-relevant on any of these fields — the relay does not
 * authenticate presence payloads.
 */
export interface AwarenessIdentity {
  readonly id: string;
  readonly name?: string;
  readonly color?: string;
  readonly role?: string;
}

/**
 * The wire shape of one awareness frame. Every frame is the sender's COMPLETE
 * state (identity + whatever it publishes), so any coalescer that keeps only
 * the newest frame — the relay's per-kind throttle lane, a slow consumer — is
 * correct by construction: latest wins. Absent fields mean "none / not
 * published"; there is no delta encoding. A `cleared` frame says the sender is
 * going away (receivers drop it now instead of waiting for stale expiry).
 * Presence only: never elements, undo history, persisted canvas state, or
 * durable operations.
 */
export interface AwarenessPresence extends AwarenessIdentity {
  readonly kind: 'awareness';
  /** World-space pointer position; absent = no cursor to show. */
  readonly cursor?: Point;
  /** Selected element ids the sender chose to publish; absent = none. */
  readonly selection?: readonly string[];
  /** Active tool name; absent = not published. */
  readonly tool?: string;
  readonly cleared?: true;
}

export const AWARENESS_PRESENCE_KIND = 'awareness';

/** Cap on `selection` entries; longer payloads are rejected outright. */
export const AWARENESS_MAX_SELECTION = 256;

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 64;
const MAX_COLOR_LENGTH = 64;
const MAX_ROLE_LENGTH = 32;
const MAX_TOOL_LENGTH = 64;

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isOptionalBoundedString(value: unknown, max: number): boolean {
  return value === undefined || isBoundedString(value, max);
}

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

/**
 * Wire-boundary guard, fail closed: any violated cap rejects the whole frame
 * (nothing is clamped or sanitised). Unknown extra fields are tolerated so a
 * newer sender can add fields without breaking older receivers.
 */
export function isAwarenessPresence(data: unknown): data is AwarenessPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    id?: unknown;
    name?: unknown;
    color?: unknown;
    role?: unknown;
    cursor?: unknown;
    selection?: unknown;
    tool?: unknown;
    cleared?: unknown;
  };
  if (payload.kind !== AWARENESS_PRESENCE_KIND) return false;
  if (!isBoundedString(payload.id, MAX_ID_LENGTH) || payload.id.length === 0) return false;
  if ('cleared' in payload) return payload.cleared === true;
  if (!isOptionalBoundedString(payload.name, MAX_NAME_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.color, MAX_COLOR_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.role, MAX_ROLE_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.tool, MAX_TOOL_LENGTH)) return false;
  if (payload.cursor !== undefined && !isFinitePoint(payload.cursor)) return false;
  if (payload.selection !== undefined) {
    if (!Array.isArray(payload.selection)) return false;
    if (payload.selection.length > AWARENESS_MAX_SELECTION) return false;
    // `for…of` visits holes (as `undefined`) where `.every` would skip them.
    for (const id of payload.selection as readonly unknown[]) {
      if (!isBoundedString(id, MAX_ID_LENGTH) || id.length === 0) return false;
    }
  }
  return true;
}
