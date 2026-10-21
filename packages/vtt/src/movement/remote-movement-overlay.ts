import type { Point } from '@fieldnotes/core';
import { LingerOverlay } from '@fieldnotes/core';
import type { RemotePathOverlayHost, RemotePathOverlayOptions } from '../remote-path-overlay';
import type { MovementRenderModel } from './movement-render';
import { drawMovement } from './movement-render';
import type { MovementEmission } from './movement-tracker';

/** Presence `kind` for a live tracked drag. */
export const MOVEMENT_PRESENCE_KIND = 'movement';

/** Wire shape of a tracked-drag presence payload; never sent for DM-only movement. */
export type MovementPresence =
  | ({ readonly kind: 'movement'; readonly elementId: string } & MovementRenderModel)
  | { readonly kind: 'movement'; readonly cleared: true };

const MAX_POINTS = 256;
const MAX_CELLS = 512;
const MAX_STRING = 64;
const MAX_ELEMENT_ID = 256;

/** Payload for one local emission: cleared for `null`, `null` (do not send) for DM-only movement. */
export function toMovementPresence(emission: MovementEmission | null): MovementPresence | null {
  if (emission === null) return { kind: MOVEMENT_PRESENCE_KIND, cleared: true };
  if (emission.visibility === 'dm') return null;
  return { kind: MOVEMENT_PRESENCE_KIND, elementId: emission.elementId, ...emission.model };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isShortString(value: unknown, max = MAX_STRING): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// for…of, not `.every`: `.every` skips holes, letting a sparse array reach the renderer.
function isPointList(value: unknown): value is Point[] {
  if (!Array.isArray(value)) return false;
  for (const p of value as unknown[]) {
    if (!isRecord(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return false;
  }
  return true;
}

function isGrid(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type !== 'square' && value.type !== 'hex' && value.type !== 'none') return false;
  if (!isFiniteNumber(value.cellSize) || value.cellSize <= 0) return false;
  return (
    value.orientation === undefined ||
    value.orientation === 'pointy' ||
    value.orientation === 'flat'
  );
}

/** Validates an untrusted peer payload, including size caps, before it reaches the overlay. */
export function isMovementPresence(data: unknown): data is MovementPresence {
  if (!isRecord(data) || data.kind !== MOVEMENT_PRESENCE_KIND) return false;
  if ('cleared' in data) return data.cleared === true;
  if (!isShortString(data.elementId, MAX_ELEMENT_ID) || !isGrid(data.grid)) return false;
  if (!isShortString(data.label) || typeof data.over !== 'boolean') return false;
  const { trail, path, segmentColors, cells } = data;
  if (!isPointList(path) || !Array.isArray(trail)) return false;
  let points = path.length;
  for (const run of trail as unknown[]) {
    if (!isPointList(run)) return false;
    points += run.length;
  }
  if (points > MAX_POINTS) return false;
  if (!Array.isArray(segmentColors)) return false;
  if (segmentColors.length !== Math.max(0, path.length - 1)) return false;
  for (const color of segmentColors as unknown[]) {
    if (!isShortString(color)) return false;
  }
  if (!Array.isArray(cells) || cells.length > MAX_CELLS) return false;
  for (const cell of cells as unknown[]) {
    if (!isRecord(cell) || !isFiniteNumber(cell.x) || !isFiniteNumber(cell.y)) return false;
    if (!isShortString(cell.color)) return false;
  }
  return true;
}

/**
 * Renders peers' live tracked drags. A cleared payload removes the sender's
 * drag at once; `maxAgeMs` expiry (then `holdMs`/`fadeMs`) covers a sender
 * that vanishes. `color` is unused: payloads carry their own colors.
 */
export class RemoteMovementOverlay {
  private readonly overlay: LingerOverlay<MovementRenderModel>;

  constructor(host: RemotePathOverlayHost, options: RemotePathOverlayOptions = {}) {
    this.overlay = new LingerOverlay<MovementRenderModel>(host, options, (ctx, model, alpha) =>
      drawMovement(ctx, model, { alpha }),
    );
  }

  /** Applies `sender`'s presence payload; false for foreign or malformed data. */
  apply(sender: string, data: unknown): boolean {
    if (this.overlay.disposed || !isMovementPresence(data)) return false;
    if ('cleared' in data) this.overlay.remove(sender);
    else this.overlay.set(sender, data);
    return true;
  }

  /** Removes a sender's drag immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    this.overlay.remove(sender);
  }

  /** Removes every drag immediately. */
  clear(): void {
    this.overlay.clear();
  }

  /** Unregisters the overlay and cancels timers. Idempotent. */
  dispose(): void {
    this.overlay.dispose();
  }
}
