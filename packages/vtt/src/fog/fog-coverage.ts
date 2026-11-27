import { getElementBounds } from '@fieldnotes/core';
import type { Bounds } from '@fieldnotes/core';
import type { SyncElement } from '@fieldnotes/sync';
import { movementRecordTypeDefinition } from '../movement/movement-record';
import { templateElementTypeDefinition } from '../template/template-definition';
import type { FogSnapshot } from './fog-sync-types';
import { decodeBase64 } from './tile-codec';
import { FOG_TILE_CELLS } from './types';

const SUMS_SIDE = FOG_TILE_CELLS + 1;

interface CoverageTile {
  readonly bytes: Uint8Array;
  revealedSums?: Uint16Array;
}

const decodedTiles = new WeakMap<FogSnapshot, Map<string, CoverageTile>>();

function tilesOf(snapshot: FogSnapshot): Map<string, CoverageTile> {
  let tiles = decodedTiles.get(snapshot);
  if (!tiles) {
    tiles = new Map();
    // A record without data is a tombstone: its cells take the base.
    for (const tile of snapshot.tiles) {
      if (tile.data !== undefined) {
        tiles.set(`${tile.x},${tile.y}`, { bytes: decodeBase64(tile.data) });
      }
    }
    decodedTiles.set(snapshot, tiles);
  }
  return tiles;
}

/** Summed-area table of revealed cells: entry (row, col) counts cells above and left of it. */
function revealedSums(tile: CoverageTile): Uint16Array {
  if (tile.revealedSums) return tile.revealedSums;
  const sums = new Uint16Array(SUMS_SIDE * SUMS_SIDE);
  const { bytes } = tile;
  let byteIndex = 0;
  // Row 0 and column 0 stay zero; bits are row-major, most significant bit first.
  for (let row = 1, i = SUMS_SIDE + 1; row < SUMS_SIDE; row++, i++) {
    let rowCount = 0;
    for (let end = byteIndex + FOG_TILE_CELLS / 8; byteIndex < end; byteIndex++) {
      const byte = bytes[byteIndex] as number;
      for (let bit = 7; bit >= 0; bit--, i++) {
        rowCount += (byte >> bit) & 1;
        sums[i] = (sums[i - SUMS_SIDE] as number) + rowCount;
      }
    }
  }
  tile.revealedSums = sums;
  return sums;
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
  const firstX = Math.floor(x / cellSize);
  const firstY = Math.floor(y / cellSize);
  const lastX = last(x, w);
  const lastY = last(y, h);
  // A size below float precision leaves no touched cell, which counts as covered.
  if (lastX < firstX || lastY < firstY) return true;
  const tiles = tilesOf(snapshot);
  const baseRevealed = definition.base === 'revealed';
  const lastTy = Math.floor(lastY / FOG_TILE_CELLS);
  const lastTx = Math.floor(lastX / FOG_TILE_CELLS);
  for (let ty = Math.floor(firstY / FOG_TILE_CELLS); ty <= lastTy; ty++) {
    const top = Math.max(firstY - ty * FOG_TILE_CELLS, 0);
    const bottom = Math.min(lastY - ty * FOG_TILE_CELLS, FOG_TILE_CELLS - 1) + 1;
    for (let tx = Math.floor(firstX / FOG_TILE_CELLS); tx <= lastTx; tx++) {
      const tile = tiles.get(`${tx},${ty}`);
      if (!tile) {
        if (baseRevealed) return false;
        continue;
      }
      const left = Math.max(firstX - tx * FOG_TILE_CELLS, 0);
      const right = Math.min(lastX - tx * FOG_TILE_CELLS, FOG_TILE_CELLS - 1) + 1;
      const sums = revealedSums(tile);
      const at = (row: number, col: number): number => sums[row * SUMS_SIDE + col] as number;
      if (at(bottom, right) - at(top, right) - at(bottom, left) + at(top, left) > 0) return false;
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
