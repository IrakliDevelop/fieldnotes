import type { Bounds, Point } from '../core/types';

export const FOG_STATE_VERSION = 1;
export const FOG_TILE_CELLS = 128;
export const FOG_MAX_TILES = 256;

export type FogBase = 'covered' | 'revealed';

export interface FogDefinitionV1 {
  readonly version: 1;
  readonly generation: string;
  readonly bounds: Bounds;
  readonly cellSize: number;
  readonly tileCells: 128;
  readonly base: FogBase;
}

export interface FogTileV1 {
  readonly x: number;
  readonly y: number;
  readonly data: string;
}

export interface FogStateV1 {
  readonly definition: FogDefinitionV1;
  readonly tiles: readonly FogTileV1[];
}

export type FogViewMode = 'off' | 'editor' | 'player';
export type FogOperation = 'reveal' | 'conceal';

export type FogRegion =
  | { kind: 'brush'; points: readonly Point[]; radius: number }
  | { kind: 'rectangle'; from: Point; to: Point }
  | { kind: 'polygon'; points: readonly Point[] };

export interface FogToolOptions {
  operation?: FogOperation;
  shape?: 'brush' | 'rectangle' | 'polygon';
  radius?: number;
}

export interface FogPatch {
  readonly tiles: readonly FogTileV1[];
}

export interface FogChangeEvent {
  readonly kind: 'tiles' | 'definition' | 'reset' | 'disable';
  readonly tiles?: readonly { readonly x: number; readonly y: number }[];
  readonly origin?: string;
}

export interface FogViewEvent {
  readonly mode: FogViewMode;
}
