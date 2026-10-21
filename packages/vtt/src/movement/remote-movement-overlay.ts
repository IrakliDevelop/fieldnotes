import type { Point } from '@fieldnotes/core';
import { LingerOverlay } from '@fieldnotes/core';
import type { RemotePathOverlayHost, RemotePathOverlayOptions } from '../remote-path-overlay';
import type { MovementCell, MovementRenderModel } from './movement-render';
import { drawMovement } from './movement-render';
import type { MovementEmission } from './movement-tracker';

/** Presence `kind` for a live tracked drag. */
export const MOVEMENT_PRESENCE_KIND = 'movement';

/** UTF-8 byte budget of the serialized payload, under the hub's default 4096-byte presence cap. */
export const MOVEMENT_PRESENCE_MAX_BYTES = 3800;

const encoder = new TextEncoder();

/**
 * Compact wire shape of a tracked drag; never sent for DM-only movement.
 * Coordinates are flat integer `x,y` pairs; colors are indices into `palette`.
 */
export type MovementPresence =
  | {
      readonly kind: 'movement';
      readonly elementId: string;
      readonly grid: MovementRenderModel['grid'];
      readonly palette: readonly string[];
      readonly path: readonly number[];
      /** Palette index per path segment. */
      readonly segments: readonly number[];
      /** Non-empty runs of flat `x,y` pairs. */
      readonly trail: readonly (readonly number[])[];
      /** Flat `x,y,paletteIndex` triplets. */
      readonly cells: readonly number[];
      readonly label: string;
      readonly over: boolean;
    }
  | { readonly kind: 'movement'; readonly cleared: true };

const MAX_POINTS = 256;
const MAX_CELLS = 512;
const MAX_PALETTE = 8;
const MAX_STRING = 64;
const MAX_ELEMENT_ID = 256;

function flatten(points: readonly Point[]): number[] {
  return points.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
}

/**
 * Payload for one local emission: cleared for `null`, `null` (do not send) for
 * DM-only movement. Over budget, trail runs drop oldest-first, then all cells.
 */
export function toMovementPresence(emission: MovementEmission | null): MovementPresence | null {
  if (emission === null) return { kind: MOVEMENT_PRESENCE_KIND, cleared: true };
  if (emission.visibility === 'dm') return null;
  const { model } = emission;
  const palette: string[] = [];
  const indexOf = (color: string): number => {
    const i = palette.indexOf(color);
    if (i !== -1) return i;
    // Band sets are far smaller than the cap; any overflow reuses the last color.
    if (palette.length === MAX_PALETTE) return MAX_PALETTE - 1;
    return palette.push(color) - 1;
  };
  const segments = model.segmentColors.map(indexOf);
  const trail = model.trail.filter((run) => run.length > 0).map(flatten);
  let cells = model.cells.flatMap((c) => [Math.round(c.x), Math.round(c.y), indexOf(c.color)]);
  const encode = (): MovementPresence => ({
    kind: MOVEMENT_PRESENCE_KIND,
    elementId: emission.elementId,
    grid: model.grid,
    palette,
    path: flatten(model.path),
    segments,
    trail,
    cells,
    label: model.label,
    over: model.over,
  });
  const fits = (): boolean =>
    encoder.encode(JSON.stringify(encode())).length <= MOVEMENT_PRESENCE_MAX_BYTES;
  while (!fits() && trail.length > 0) trail.shift();
  if (!fits()) cells = [];
  return encode();
}

function isInt(value: unknown): value is number {
  return Number.isInteger(value);
}

function isShortString(value: unknown, max = MAX_STRING): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Not `.every`: it skips holes, letting a sparse array through.
function readPoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length % 2 !== 0) return null;
  const points: Point[] = [];
  for (let i = 0; i < value.length; i += 2) {
    const x: unknown = value[i];
    const y: unknown = value[i + 1];
    if (!isInt(x) || !isInt(y)) return null;
    points.push({ x, y });
  }
  return points;
}

function readGrid(value: unknown): MovementRenderModel['grid'] | null {
  if (!isRecord(value)) return null;
  const { type, cellSize, orientation } = value;
  if (type !== 'square' && type !== 'hex' && type !== 'none') return null;
  if (typeof cellSize !== 'number' || !Number.isFinite(cellSize) || cellSize <= 0) return null;
  if (orientation === undefined) return { type, cellSize };
  if (orientation !== 'pointy' && orientation !== 'flat') return null;
  return { type, cellSize, orientation };
}

function readPalette(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PALETTE) return null;
  const palette: string[] = [];
  for (const color of value as unknown[]) {
    if (!isShortString(color)) return null;
    palette.push(color);
  }
  return palette;
}

/** Validates an untrusted peer payload and decodes it; `null` when invalid or cleared. */
export function decodeMovementPresence(data: unknown): MovementRenderModel | null {
  if (!isRecord(data) || data.kind !== MOVEMENT_PRESENCE_KIND || 'cleared' in data) return null;
  const { label, over } = data;
  if (!isShortString(data.elementId, MAX_ELEMENT_ID) || !isShortString(label)) return null;
  if (typeof over !== 'boolean') return null;
  const grid = readGrid(data.grid);
  const palette = readPalette(data.palette);
  const path = readPoints(data.path);
  if (!grid || !palette || !path || !Array.isArray(data.trail)) return null;
  const colorAt = (index: unknown): string | undefined =>
    isInt(index) ? palette[index] : undefined;

  const trail: Point[][] = [];
  let points = path.length;
  for (const flat of data.trail as unknown[]) {
    const run = readPoints(flat);
    if (!run || run.length === 0) return null;
    points += run.length;
    trail.push(run);
  }
  if (points > MAX_POINTS) return null;

  const { segments, cells: flatCells } = data;
  if (!Array.isArray(segments) || segments.length !== Math.max(0, path.length - 1)) return null;
  const segmentColors: string[] = [];
  for (const index of segments as unknown[]) {
    const color = colorAt(index);
    if (color === undefined) return null;
    segmentColors.push(color);
  }

  if (!Array.isArray(flatCells) || flatCells.length % 3 !== 0) return null;
  if (flatCells.length > 3 * MAX_CELLS) return null;
  const cells: MovementCell[] = [];
  for (let i = 0; i < flatCells.length; i += 3) {
    const x: unknown = flatCells[i];
    const y: unknown = flatCells[i + 1];
    const color = colorAt(flatCells[i + 2]);
    if (!isInt(x) || !isInt(y) || color === undefined) return null;
    cells.push({ x, y, color });
  }
  return { grid, trail, path, segmentColors, cells, label, over };
}

function isClearedPresence(data: unknown): boolean {
  return isRecord(data) && data.kind === MOVEMENT_PRESENCE_KIND && data.cleared === true;
}

/** Validates an untrusted peer payload, including size caps, before it reaches the overlay. */
export function isMovementPresence(data: unknown): data is MovementPresence {
  return isClearedPresence(data) || decodeMovementPresence(data) !== null;
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
    if (this.overlay.disposed) return false;
    if (isClearedPresence(data)) {
      this.overlay.remove(sender);
      return true;
    }
    const model = decodeMovementPresence(data);
    if (!model) return false;
    this.overlay.set(sender, model);
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
