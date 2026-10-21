import type { BaseElement, Point } from '@fieldnotes/core';

/** Who may read a movement record: everyone, or only the DM. */
export type MovementVisibility = 'all' | 'dm';

/** A movement mode (walk, fly, dash); `counts: false` moves without spending distance. */
export interface MovementKind {
  readonly id: string;
  readonly label?: string;
  readonly counts: boolean;
  readonly maxFeet?: number;
}

/** Per-token movement spent in the current epoch, persisted and synced as `vtt:movement`. */
export interface MovementRecordElement extends BaseElement {
  type: 'movement';
  targetId: string;
  epoch: string;
  feet: number;
  /** Square-grid diagonals so far, so the alternate rule's parity survives across moves. */
  diagonals: number;
  visibility: MovementVisibility;
  /** Runs of points; a placement starts a new run. */
  trail: Point[][];
}

/** Most trail points a record keeps, across all runs. */
export const MOVEMENT_TRAIL_MAX_POINTS = 64;
