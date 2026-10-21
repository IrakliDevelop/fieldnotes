import { pickBaseFields } from '@fieldnotes/core';
import type {
  CanvasElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  Point,
} from '@fieldnotes/core';
import { MOVEMENT_TRAIL_MAX_POINTS } from './movement-types';
import type { MovementRecordElement, MovementVisibility } from './movement-types';

/** Id prefix of every movement record; the rest is the target element's id. */
export const MOVEMENT_RECORD_ID_PREFIX = 'vtt-movement:';

const VISIBILITIES: readonly unknown[] = ['all', 'dm'] satisfies MovementVisibility[];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function isTrail(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const runs: readonly unknown[] = value;
  let count = 0;
  for (const run of runs) {
    if (!Array.isArray(run) || run.length === 0) return false;
    count += run.length;
    // Checked before scanning so an oversized payload is rejected without walking it.
    if (count > MOVEMENT_TRAIL_MAX_POINTS || !run.every(isPoint)) return false;
  }
  return true;
}

/** Element type for per-token movement records: persisted and synced, never drawn or hit. */
export const movementRecordTypeDefinition: ElementTypeDefinition<MovementRecordElement> = {
  type: 'vtt:movement',
  legacyTypes: [],
  dataVersion: 1,

  decodeLegacy(): MovementRecordElement {
    throw new Error('vtt:movement has no legacy form');
  },

  validateData(data: Record<string, unknown>): boolean {
    const { targetId, epoch, feet, diagonals, visibility, trail } = data;
    return (
      typeof targetId === 'string' &&
      typeof epoch === 'string' &&
      isFiniteNumber(feet) &&
      feet >= 0 &&
      typeof diagonals === 'number' &&
      Number.isSafeInteger(diagonals) &&
      diagonals >= 0 &&
      VISIBILITIES.includes(visibility) &&
      isTrail(trail)
    );
  },

  unwrap(el: ExtensionElementEnvelope): MovementRecordElement {
    return {
      ...pickBaseFields(el),
      type: 'movement',
      targetId: el.data['targetId'] as string,
      epoch: el.data['epoch'] as string,
      feet: el.data['feet'] as number,
      diagonals: el.data['diagonals'] as number,
      visibility: el.data['visibility'] as MovementVisibility,
      trail: el.data['trail'] as Point[][],
    };
  },

  wrap(el: MovementRecordElement): ExtensionElementEnvelope {
    return {
      ...pickBaseFields(el),
      type: 'extension',
      extensionType: 'vtt:movement',
      data: {
        targetId: el.targetId,
        epoch: el.epoch,
        feet: el.feet,
        diagonals: el.diagonals,
        visibility: el.visibility,
        trail: el.trail,
      },
    };
  },

  bounds(): null {
    return null;
  },
};

/** Id of the movement record that tracks `targetId`. */
export function movementRecordId(targetId: string): string {
  return MOVEMENT_RECORD_ID_PREFIX + targetId;
}

/** A fresh, locked record on the target's layer with nothing spent yet. */
export function createMovementRecord(input: {
  target: CanvasElement;
  epoch: string;
  visibility: MovementVisibility;
}): MovementRecordElement {
  return {
    id: movementRecordId(input.target.id),
    type: 'movement',
    position: { x: 0, y: 0 },
    index: '',
    version: 0,
    locked: true,
    layerId: input.target.layerId,
    targetId: input.target.id,
    epoch: input.epoch,
    feet: 0,
    diagonals: 0,
    visibility: input.visibility,
    trail: [],
  };
}

/** Visibility of a stored or wire `vtt:movement` envelope; `undefined` for anything else. */
export function getMovementVisibility(element: unknown): MovementVisibility | undefined {
  if (
    !isObject(element) ||
    element['type'] !== 'extension' ||
    element['extensionType'] !== movementRecordTypeDefinition.type
  ) {
    return undefined;
  }
  const data = element['data'];
  if (!isObject(data) || !movementRecordTypeDefinition.validateData(data)) return undefined;
  return data['visibility'] as MovementVisibility;
}

/** Player moves are always shared; DM moves follow the override, else the table default. */
export function resolveMovementVisibility(input: {
  controller: 'dm' | 'player';
  shareDmDefault: boolean;
  override?: 'share' | 'hide';
}): MovementVisibility {
  if (input.controller === 'player') return 'all';
  const share = input.override === undefined ? input.shareDmDefault : input.override === 'share';
  return share ? 'all' : 'dm';
}

/** Adds `run` as a new run or onto the last one, keeping the newest points up to the cap. */
export function appendTrail(
  trail: readonly (readonly Point[])[],
  run: readonly Point[],
  newRun: boolean,
): Point[][] {
  const last = trail[trail.length - 1];
  const runs =
    newRun || last === undefined ? [...trail, run] : [...trail.slice(0, -1), [...last, ...run]];
  const kept: Point[][] = [];
  let budget = MOVEMENT_TRAIL_MAX_POINTS;
  for (const points of runs.reverse()) {
    if (budget === 0) break;
    const tail = points.slice(-budget);
    if (tail.length > 0) kept.unshift(tail);
    budget -= tail.length;
  }
  return kept;
}
