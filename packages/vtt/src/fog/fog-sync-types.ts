import type { FogDefinitionV1, FogStateV1 } from './types';
import { FOG_MAX_TILES, FOG_TILE_CELLS } from './types';
import { validateFogDefinition, validateFogTile } from './tile-codec';

export { FOG_MAX_TILES, FOG_TILE_CELLS };

export const FOG_SYNC_PROTOCOL_VERSION = 1;
export const FOG_PATCH_MAX_TILES = 64;

export interface FogMetaRecord {
  readonly version: number;
  readonly editor: string;
  readonly definition?: FogDefinitionV1;
}

export interface FogTileRecord {
  readonly generation: string;
  readonly x: number;
  readonly y: number;
  readonly version: number;
  readonly editor: string;
  readonly data?: string;
}

export interface FogSnapshot {
  readonly meta: FogMetaRecord;
  readonly tiles: readonly FogTileRecord[];
}

export function isNewerFogRecord(
  a: { version: number; editor: string },
  b: { version: number; editor: string },
): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.editor > b.editor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLen: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLen &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

export function isValidFogMetaRecord(record: unknown): record is FogMetaRecord {
  if (!isRecord(record)) return false;
  if (
    !Number.isSafeInteger(record['version']) ||
    (record['version'] as number) < 1 ||
    typeof record['editor'] !== 'string' ||
    !isBoundedString(record['editor'], 128)
  ) {
    return false;
  }
  if (record['definition'] !== undefined) {
    try {
      validateFogDefinition(record['definition']);
    } catch {
      return false;
    }
  }
  return true;
}

const FOG_TILE_BYTES = (128 * 128) / 8;
const FOG_CANONICAL_B64_LENGTH = Math.ceil(FOG_TILE_BYTES / 3) * 4;
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_CHARS_RE = /^[A-Za-z0-9+/]+=$/;

function isCanonicalFogTileData(data: string): boolean {
  if (data.length !== FOG_CANONICAL_B64_LENGTH || !B64_CHARS_RE.test(data)) return false;
  const finalSextet = B64_CHARS.indexOf(data[data.length - 2] as string);
  return finalSextet >= 0 && (finalSextet & 0b11) === 0;
}

export function isValidFogTileRecord(record: unknown): record is FogTileRecord {
  if (!isRecord(record)) return false;
  if (
    !isBoundedString(record['generation'], 128) ||
    !Number.isSafeInteger(record['x']) ||
    !Number.isSafeInteger(record['y']) ||
    !Number.isSafeInteger(record['version']) ||
    (record['version'] as number) < 1 ||
    !isBoundedString(record['editor'], 128)
  ) {
    return false;
  }
  if (record['data'] === undefined) return true;
  if (typeof record['data'] !== 'string') return false;
  return isCanonicalFogTileData(record['data']);
}

function tileIntersectsDefinition(x: number, y: number, def: FogDefinitionV1): boolean {
  const tileWorldSize = FOG_TILE_CELLS * def.cellSize;
  const tileWorldX = x * tileWorldSize;
  const tileWorldY = y * tileWorldSize;
  return !(
    tileWorldX + tileWorldSize <= def.bounds.x ||
    tileWorldY + tileWorldSize <= def.bounds.y ||
    tileWorldX >= def.bounds.x + def.bounds.w ||
    tileWorldY >= def.bounds.y + def.bounds.h
  );
}

export function isValidFogSnapshot(snap: unknown): snap is FogSnapshot {
  if (!isRecord(snap)) return false;
  if (!isValidFogMetaRecord(snap['meta'])) return false;
  if (!Array.isArray(snap['tiles'])) return false;
  const meta = snap['meta'] as FogMetaRecord;
  const generation = meta.definition?.generation;
  const tiles = snap['tiles'] as unknown[];
  if (tiles.length > FOG_MAX_TILES) return false;
  if (!meta.definition && tiles.length > 0) return false;
  const seen = new Set<string>();
  for (const tile of tiles) {
    if (!isValidFogTileRecord(tile)) return false;
    const t = tile as FogTileRecord;
    if (generation !== undefined && t.generation !== generation) return false;
    if (meta.definition && !tileIntersectsDefinition(t.x, t.y, meta.definition)) return false;
    if (meta.definition && t.data !== undefined) {
      try {
        validateFogTile({ x: t.x, y: t.y, data: t.data }, meta.definition);
      } catch {
        return false;
      }
    }
    const key = `${t.x},${t.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ── Fog sync controller types ──

/**
 * Host-provided fog state manager. The controller uses this to read the
 * current fog definition/tiles, apply winning remote state, and listen for
 * local edits that need to be broadcast.
 */
export interface FogSyncManager {
  getState(): FogStateV1 | null;
  loadState(state: FogStateV1 | null, meta?: { origin?: string }): void;
  applyPatchDirect(
    patch: { tiles: readonly { x: number; y: number; data: string }[] },
    meta?: { origin?: string },
  ): void;
  on(
    event: 'change',
    listener: (event: {
      kind: string;
      tiles?: readonly { x: number; y: number }[];
      origin?: string;
    }) => void,
  ): () => void;
}

/** Options for constructing a FogSyncController. */
export interface FogSyncControllerOptions {
  clientId: string;
  manager: FogSyncManager;
  preserveLocalWhenRemoteMissing?: boolean;
  /** Restore session state from a previous controller (across reconnects). */
  sessionSnapshot?: FogSyncSessionSnapshot;
}

/** Serializable session state for cross-reconnect persistence. */
export interface FogSyncSessionSnapshot {
  readonly hubKnown: boolean;
  readonly pendingMeta?: FogMetaRecord;
  readonly pendingTiles: readonly FogTileRecord[];
  readonly metaMustReplay: boolean;
  readonly mustReplayTileKeys: readonly string[];
  readonly pendingState: FogStateV1 | null;
}

/** Fog op shapes emitted by the controller via the `sendOp` event. */
export type FogSyncOp =
  | { kind: 'fog-meta'; record: FogMetaRecord }
  | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] }
  | { kind: 'request-snapshot' };

/** Events emitted by the controller. */
export interface FogSyncControllerEvents {
  sendOp: (op: FogSyncOp) => void;
  stateChange: () => void;
}

/** Validate the clientId used for fog sync ordering. */
export function assertValidFogClientId(clientId: string): void {
  if (clientId.length === 0 || clientId.length > 128 || !/^[\x20-\x7e]+$/.test(clientId)) {
    throw new RangeError('fog sync requires clientId to be 1-128 printable ASCII characters');
  }
}
