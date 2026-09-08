import type { Bounds } from '@fieldnotes/core';

export const FOG_SYNC_PROTOCOL_VERSION = 1;
export const FOG_PATCH_MAX_TILES = 64;
export const FOG_MAX_TILES = 256;
export const FOG_TILE_CELLS = 128;

export interface FogDefinitionV1 {
  readonly version: 1;
  readonly generation: string;
  readonly bounds: Bounds;
  readonly cellSize: number;
  readonly tileCells: 128;
  readonly base: 'covered' | 'revealed';
}

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
  return a.version !== b.version ? a.version > b.version : a.editor > b.editor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

function isValidDefinition(value: unknown): value is FogDefinitionV1 {
  if (!isRecord(value) || !isRecord(value['bounds'])) return false;
  const bounds = value['bounds'];
  return (
    value['version'] === 1 &&
    isBoundedString(value['generation'], 128) &&
    isFiniteNumber(bounds['x']) &&
    isFiniteNumber(bounds['y']) &&
    isFiniteNumber(bounds['w']) &&
    (bounds['w'] as number) > 0 &&
    isFiniteNumber(bounds['h']) &&
    (bounds['h'] as number) > 0 &&
    isFiniteNumber(value['cellSize']) &&
    (value['cellSize'] as number) > 0 &&
    value['tileCells'] === FOG_TILE_CELLS &&
    (value['base'] === 'covered' || value['base'] === 'revealed')
  );
}

export function isValidFogMetaRecord(value: unknown): value is FogMetaRecord {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value['version']) &&
    (value['version'] as number) >= 1 &&
    isBoundedString(value['editor'], 128) &&
    (value['definition'] === undefined || isValidDefinition(value['definition']))
  );
}

const FOG_TILE_BYTES = (FOG_TILE_CELLS * FOG_TILE_CELLS) / 8;
const FOG_CANONICAL_B64_LENGTH = Math.ceil(FOG_TILE_BYTES / 3) * 4;
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let index = 0; index < B64_CHARS.length; index += 1) {
  B64_LOOKUP[B64_CHARS.charCodeAt(index)] = index;
}

function isCanonicalTileData(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== FOG_CANONICAL_B64_LENGTH ||
    !/^[A-Za-z0-9+/]+=$/.test(value)
  ) {
    return false;
  }
  const finalSextet = B64_CHARS.indexOf(value[value.length - 2] ?? '');
  return finalSextet >= 0 && (finalSextet & 0b11) === 0;
}

function decodeBase64(value: string): Uint8Array {
  const bytes = new Uint8Array(FOG_TILE_BYTES);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = B64_LOOKUP[value.charCodeAt(index)] as number;
    const b = B64_LOOKUP[value.charCodeAt(index + 1)] as number;
    const c = value[index + 2] === '=' ? 0 : (B64_LOOKUP[value.charCodeAt(index + 2)] as number);
    const d = value[index + 3] === '=' ? 0 : (B64_LOOKUP[value.charCodeAt(index + 3)] as number);
    bytes[output] = (a << 2) | (b >> 4);
    output += 1;
    if (output < bytes.length) {
      bytes[output] = ((b << 4) | (c >> 2)) & 0xff;
      output += 1;
    }
    if (output < bytes.length) {
      bytes[output] = ((c << 6) | d) & 0xff;
      output += 1;
    }
  }
  return bytes;
}

function isCanonicalForDefinition(tile: FogTileRecord, definition: FogDefinitionV1): boolean {
  if (tile.data === undefined) return true;
  const bytes = decodeBase64(tile.data);
  const baseByte = definition.base === 'revealed' ? 0xff : 0;
  if (bytes.every((value) => value === baseByte)) return false;
  const tileWorldX = tile.x * FOG_TILE_CELLS * definition.cellSize;
  const tileWorldY = tile.y * FOG_TILE_CELLS * definition.cellSize;
  const right = definition.bounds.x + definition.bounds.w;
  const bottom = definition.bounds.y + definition.bounds.h;
  for (let row = 0; row < FOG_TILE_CELLS; row += 1) {
    for (let column = 0; column < FOG_TILE_CELLS; column += 1) {
      const worldX = tileWorldX + column * definition.cellSize;
      const worldY = tileWorldY + row * definition.cellSize;
      if (
        worldX >= definition.bounds.x &&
        worldY >= definition.bounds.y &&
        worldX < right &&
        worldY < bottom
      ) {
        continue;
      }
      const bit = row * FOG_TILE_CELLS + column;
      const byte = bytes[bit >> 3] as number;
      const revealed = ((byte >> (7 - (bit & 7))) & 1) === 1;
      if (revealed !== (definition.base === 'revealed')) return false;
    }
  }
  return true;
}

export function isValidFogTileRecord(value: unknown): value is FogTileRecord {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value['generation'], 128) &&
    Number.isSafeInteger(value['x']) &&
    Number.isSafeInteger(value['y']) &&
    Number.isSafeInteger(value['version']) &&
    (value['version'] as number) >= 1 &&
    isBoundedString(value['editor'], 128) &&
    (value['data'] === undefined || isCanonicalTileData(value['data']))
  );
}

function tileIntersectsDefinition(tile: FogTileRecord, definition: FogDefinitionV1): boolean {
  const size = FOG_TILE_CELLS * definition.cellSize;
  const x = tile.x * size;
  const y = tile.y * size;
  return !(
    x + size <= definition.bounds.x ||
    y + size <= definition.bounds.y ||
    x >= definition.bounds.x + definition.bounds.w ||
    y >= definition.bounds.y + definition.bounds.h
  );
}

export function isValidFogSnapshot(value: unknown): value is FogSnapshot {
  if (!isRecord(value) || !isValidFogMetaRecord(value['meta']) || !Array.isArray(value['tiles'])) {
    return false;
  }
  const meta = value['meta'];
  if (value['tiles'].length > FOG_MAX_TILES || (!meta.definition && value['tiles'].length > 0)) {
    return false;
  }
  const seen = new Set<string>();
  for (const raw of value['tiles']) {
    if (!isValidFogTileRecord(raw)) return false;
    if (!meta.definition || raw.generation !== meta.definition.generation) return false;
    if (!tileIntersectsDefinition(raw, meta.definition)) return false;
    if (!isCanonicalForDefinition(raw, meta.definition)) return false;
    const key = `${raw.x},${raw.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
