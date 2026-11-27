import { getElementBounds } from '@fieldnotes/core';
import type { Bounds } from '@fieldnotes/core';
import type { SyncElement } from '@fieldnotes/sync';
import { movementRecordTypeDefinition } from '../movement/movement-record';
import { templateElementTypeDefinition } from '../template/template-definition';
import type { FogSnapshot } from './fog-sync-types';
import { decodeBase64, getBit } from './tile-codec';
import { FOG_TILE_CELLS } from './types';

const decodedTiles = new WeakMap<FogSnapshot, Map<string, Uint8Array>>();

function tilesOf(snapshot: FogSnapshot): Map<string, Uint8Array> {
  let tiles = decodedTiles.get(snapshot);
  if (!tiles) {
    tiles = new Map();
    // A record without data is a tombstone: its cells take the base.
    for (const tile of snapshot.tiles) {
      if (tile.data !== undefined) tiles.set(`${tile.x},${tile.y}`, decodeBase64(tile.data));
    }
    decodedTiles.set(snapshot, tiles);
  }
  return tiles;
}

/** True when `bounds` lies inside the fog bounds and every cell it touches is covered. */
export function isCoveredByFog(snapshot: FogSnapshot, bounds: Bounds): boolean {
  const definition = snapshot.meta.definition;
  if (!definition) return false;
  const { bounds: fog, cellSize } = definition;
  const { x, y, w, h } = bounds;
  if (!(x >= fog.x && y >= fog.y && x + w <= fog.x + fog.w && y + h <= fog.y + fog.h)) {
    return false;
  }
  // Cells are half-open, so an edge on a cell boundary does not touch the next cell.
  const last = (start: number, size: number): number =>
    size === 0 ? Math.floor(start / cellSize) : Math.ceil((start + size) / cellSize) - 1;
  const tiles = tilesOf(snapshot);
  const baseRevealed = definition.base === 'revealed';
  for (let cellY = Math.floor(y / cellSize); cellY <= last(y, h); cellY++) {
    const ty = Math.floor(cellY / FOG_TILE_CELLS);
    for (let cellX = Math.floor(x / cellSize); cellX <= last(x, w); cellX++) {
      const tx = Math.floor(cellX / FOG_TILE_CELLS);
      const bytes = tiles.get(`${tx},${ty}`);
      const revealed = bytes
        ? getBit(bytes, cellX - tx * FOG_TILE_CELLS, cellY - ty * FOG_TILE_CELLS)
        : baseRevealed;
      if (revealed) return false;
    }
  }
  return true;
}

/** Coverage of one wire element by the vtt rules; false when it cannot be judged. */
export function isElementCoveredByFog(snapshot: FogSnapshot, element: SyncElement): boolean {
  if (!snapshot.meta.definition) return false;
  if (element.type !== 'extension') {
    const bounds = getElementBounds(element);
    return bounds !== null && isCoveredByFog(snapshot, bounds);
  }
  if (element.extensionType === 'vtt:template') {
    const template = templateElementTypeDefinition;
    if (!template.validateData(element.data)) return false;
    const bounds = template.bounds(template.unwrap(element));
    return bounds !== null && isCoveredByFog(snapshot, bounds);
  }
  if (element.extensionType === 'vtt:movement') {
    if (!movementRecordTypeDefinition.validateData(element.data)) return false;
    // A validated trail has no empty runs; no point means the token has not moved yet.
    const point = movementRecordTypeDefinition.unwrap(element).trail.at(-1)?.at(-1);
    return !point || isCoveredByFog(snapshot, { x: point.x, y: point.y, w: 0, h: 0 });
  }
  return false;
}
