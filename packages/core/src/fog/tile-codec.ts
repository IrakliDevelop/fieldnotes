import type { Bounds, Point } from '../core/types';
import type {
  FogBase,
  FogDefinitionV1,
  FogRegion,
  FogStateV1,
  FogTileV1,
  FogOperation,
} from './types';
import { FOG_TILE_CELLS, FOG_MAX_TILES } from './types';

const TILE_BYTES = (FOG_TILE_CELLS * FOG_TILE_CELLS) / 8; // 2048
const CANONICAL_B64_LENGTH = Math.ceil(TILE_BYTES / 3) * 4; // 2732

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

// ── Base64 codec ──

export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < len ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < len ? (bytes[i + 2] as number) : 0;
    result += B64_CHARS[(a >> 2) & 0x3f];
    result += B64_CHARS[((a << 4) | (b >> 4)) & 0x3f];
    result += i + 1 < len ? B64_CHARS[((b << 2) | (c >> 6)) & 0x3f] : '=';
    result += i + 2 < len ? B64_CHARS[c & 0x3f] : '=';
  }
  return result;
}

export function decodeBase64(str: string): Uint8Array {
  if (str.length % 4 !== 0) throw new Error('Invalid base64 length');
  let padCount = 0;
  if (str.length >= 2 && str[str.length - 1] === '=') {
    padCount++;
    if (str[str.length - 2] === '=') padCount++;
  }
  const byteLen = (str.length / 4) * 3 - padCount;
  const bytes = new Uint8Array(byteLen);
  let j = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = B64_LOOKUP[str.charCodeAt(i)] as number;
    const b = B64_LOOKUP[str.charCodeAt(i + 1)] as number;
    const c = str[i + 2] === '=' ? 0 : (B64_LOOKUP[str.charCodeAt(i + 2)] as number);
    const d = str[i + 3] === '=' ? 0 : (B64_LOOKUP[str.charCodeAt(i + 3)] as number);
    bytes[j++] = (a << 2) | (b >> 4);
    if (j < byteLen) bytes[j++] = ((b << 4) | (c >> 2)) & 0xff;
    if (j < byteLen) bytes[j++] = ((c << 6) | d) & 0xff;
  }
  return bytes;
}

// ── Tile primitives ──

export function createTileBytes(fill: boolean): Uint8Array {
  const bytes = new Uint8Array(TILE_BYTES);
  if (fill) bytes.fill(0xff);
  return bytes;
}

export function getBit(bytes: Uint8Array, col: number, row: number): boolean {
  const index = row * FOG_TILE_CELLS + col;
  const byteIndex = index >> 3;
  const bitIndex = 7 - (index & 7);
  return (((bytes[byteIndex] as number) >> bitIndex) & 1) === 1;
}

export function setBit(bytes: Uint8Array, col: number, row: number, value: boolean): void {
  const index = row * FOG_TILE_CELLS + col;
  const byteIndex = index >> 3;
  const bitIndex = 7 - (index & 7);
  if (value) {
    bytes[byteIndex] = (bytes[byteIndex] as number) | (1 << bitIndex);
  } else {
    bytes[byteIndex] = (bytes[byteIndex] as number) & ~(1 << bitIndex);
  }
}

export function isTileAllValue(bytes: Uint8Array, value: boolean): boolean {
  const expected = value ? 0xff : 0x00;
  for (let i = 0; i < TILE_BYTES; i++) {
    if (bytes[i] !== expected) return false;
  }
  return true;
}

function isBaseValue(base: FogBase): boolean {
  return base === 'revealed';
}

export function isTileBase(bytes: Uint8Array, base: FogBase): boolean {
  return isTileAllValue(bytes, isBaseValue(base));
}

// ── Canonical edge padding ──

function canonicalizeEdgePadding(
  bytes: Uint8Array,
  def: FogDefinitionV1,
  tileX: number,
  tileY: number,
): void {
  const baseVal = isBaseValue(def.base);
  const worldX = tileX * FOG_TILE_CELLS * def.cellSize;
  const worldY = tileY * FOG_TILE_CELLS * def.cellSize;
  const boundsRight = def.bounds.x + def.bounds.w;
  const boundsBottom = def.bounds.y + def.bounds.h;

  for (let row = 0; row < FOG_TILE_CELLS; row++) {
    for (let col = 0; col < FOG_TILE_CELLS; col++) {
      const cellWorldX = worldX + col * def.cellSize;
      const cellWorldY = worldY + row * def.cellSize;
      const outside =
        cellWorldX < def.bounds.x ||
        cellWorldY < def.bounds.y ||
        cellWorldX >= boundsRight ||
        cellWorldY >= boundsBottom;
      if (outside) {
        setBit(bytes, col, row, baseVal);
      }
    }
  }
}

// ── Validation ──

function isCanonicalBase64(str: string): boolean {
  if (str.length !== CANONICAL_B64_LENGTH) return false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i] as string;
    if (c === '=') {
      if (i < str.length - 2) return false;
    } else if (!B64_CHARS.includes(c)) {
      return false;
    }
  }
  return true;
}

function isSafeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isFiniteBounds(b: unknown): b is Bounds {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  return (
    typeof r['x'] === 'number' &&
    Number.isFinite(r['x']) &&
    typeof r['y'] === 'number' &&
    Number.isFinite(r['y']) &&
    isFinitePositive(r['w']) &&
    isFinitePositive(r['h'])
  );
}

function tileIntersectsBounds(x: number, y: number, def: FogDefinitionV1): boolean {
  const tileWorldX = x * FOG_TILE_CELLS * def.cellSize;
  const tileWorldY = y * FOG_TILE_CELLS * def.cellSize;
  const tileWorldW = FOG_TILE_CELLS * def.cellSize;
  const tileWorldH = FOG_TILE_CELLS * def.cellSize;
  return !(
    tileWorldX + tileWorldW <= def.bounds.x ||
    tileWorldY + tileWorldH <= def.bounds.y ||
    tileWorldX >= def.bounds.x + def.bounds.w ||
    tileWorldY >= def.bounds.y + def.bounds.h
  );
}

export function validateFogDefinition(def: unknown): asserts def is FogDefinitionV1 {
  if (typeof def !== 'object' || def === null) {
    throw new Error('Invalid fog definition: expected an object');
  }
  const d = def as Record<string, unknown>;
  if (d['version'] !== 1) throw new Error('Invalid fog definition: unsupported version');
  if (
    typeof d['generation'] !== 'string' ||
    d['generation'].length === 0 ||
    d['generation'].length > 128
  ) {
    throw new Error('Invalid fog definition: invalid generation');
  }
  if (!isFiniteBounds(d['bounds'])) {
    throw new Error('Invalid fog definition: invalid bounds');
  }
  if (!isFinitePositive(d['cellSize'])) {
    throw new Error('Invalid fog definition: invalid cellSize');
  }
  if (d['tileCells'] !== 128) {
    throw new Error('Invalid fog definition: tileCells must be 128');
  }
  if (d['base'] !== 'covered' && d['base'] !== 'revealed') {
    throw new Error('Invalid fog definition: invalid base');
  }
}

export function validateFogTile(tile: unknown, def: FogDefinitionV1): asserts tile is FogTileV1 {
  if (typeof tile !== 'object' || tile === null) {
    throw new Error('Invalid fog tile: expected an object');
  }
  const t = tile as Record<string, unknown>;
  if (!isSafeInteger(t['x']) || !isSafeInteger(t['y'])) {
    throw new Error('Invalid fog tile: coordinates must be safe integers');
  }
  if (!tileIntersectsBounds(t['x'] as number, t['y'] as number, def)) {
    throw new Error('Invalid fog tile: coordinates outside bounds');
  }
  if (typeof t['data'] !== 'string' || !isCanonicalBase64(t['data'])) {
    throw new Error('Invalid fog tile: invalid data');
  }
  const decoded = decodeBase64(t['data'] as string);
  if (decoded.length !== TILE_BYTES) {
    throw new Error('Invalid fog tile: decoded data wrong length');
  }
}

export function validateFogState(state: unknown): asserts state is FogStateV1 {
  if (typeof state !== 'object' || state === null) {
    throw new Error('Invalid fog state: expected an object');
  }
  const s = state as Record<string, unknown>;
  validateFogDefinition(s['definition']);
  const def = s['definition'] as FogDefinitionV1;
  if (!Array.isArray(s['tiles'])) {
    throw new Error('Invalid fog state: tiles must be an array');
  }
  const tiles = s['tiles'] as unknown[];
  if (tiles.length > FOG_MAX_TILES) {
    throw new Error(`Invalid fog state: too many tiles (${tiles.length} > ${FOG_MAX_TILES})`);
  }
  const seen = new Set<string>();
  for (const tile of tiles) {
    validateFogTile(tile, def);
    const t = tile as FogTileV1;
    const key = `${t.x},${t.y}`;
    if (seen.has(key)) {
      throw new Error(`Invalid fog state: duplicate tile at (${t.x}, ${t.y})`);
    }
    seen.add(key);
  }
}

// ── Recommended cell size ──

export function recommendedFogCellSize(bounds: Bounds): number {
  let cellSize = 1;
  while (true) {
    const tw = Math.ceil(bounds.w / (FOG_TILE_CELLS * cellSize));
    const th = Math.ceil(bounds.h / (FOG_TILE_CELLS * cellSize));
    if (tw * th <= FOG_MAX_TILES) return cellSize;
    cellSize++;
    if (cellSize > 10000) return cellSize;
  }
}

// ── Tile lookup ──

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function worldToCell(
  worldX: number,
  worldY: number,
  cellSize: number,
): { tx: number; ty: number; col: number; row: number } {
  const cellX = Math.floor(worldX / cellSize);
  const cellY = Math.floor(worldY / cellSize);
  const tx = Math.floor(cellX / FOG_TILE_CELLS);
  const ty = Math.floor(cellY / FOG_TILE_CELLS);
  let col = cellX - tx * FOG_TILE_CELLS;
  let row = cellY - ty * FOG_TILE_CELLS;
  if (col < 0) col += FOG_TILE_CELLS;
  if (row < 0) row += FOG_TILE_CELLS;
  return { tx, ty, col, row };
}

// ── Rasterization ──

export interface RasterResult {
  readonly changed: readonly FogTileV1[];
  readonly noop: boolean;
}

export function rasterizeRegion(
  state: FogStateV1,
  region: FogRegion,
  operation: FogOperation,
): RasterResult {
  const { definition } = state;
  const bitValue = operation === 'reveal';
  const tileMap = new Map<string, Uint8Array>();

  for (const tile of state.tiles) {
    tileMap.set(tileKey(tile.x, tile.y), decodeBase64(tile.data));
  }

  const baseFill = isBaseValue(definition.base);
  const affectedTiles = new Set<string>();

  const setCellIfInBounds = (worldX: number, worldY: number): void => {
    if (
      worldX < definition.bounds.x ||
      worldY < definition.bounds.y ||
      worldX >= definition.bounds.x + definition.bounds.w ||
      worldY >= definition.bounds.y + definition.bounds.h
    ) {
      return;
    }
    const { tx, ty, col, row } = worldToCell(worldX, worldY, definition.cellSize);
    if (!tileIntersectsBounds(tx, ty, definition)) return;
    const key = tileKey(tx, ty);
    let bytes = tileMap.get(key);
    if (!bytes) {
      bytes = createTileBytes(baseFill);
      tileMap.set(key, bytes);
    } else if (!affectedTiles.has(key)) {
      const clone = new Uint8Array(bytes);
      tileMap.set(key, clone);
      bytes = clone;
    }
    affectedTiles.add(key);
    setBit(bytes, col, row, bitValue);
  };

  switch (region.kind) {
    case 'brush':
      rasterizeBrush(region.points, region.radius, definition, setCellIfInBounds);
      break;
    case 'rectangle':
      rasterizeRectangle(region.from, region.to, definition, setCellIfInBounds);
      break;
    case 'polygon':
      rasterizePolygon(region.points, definition, setCellIfInBounds);
      break;
  }

  if (affectedTiles.size === 0) return { changed: [], noop: true };

  const changedTiles: FogTileV1[] = [];
  let hasChange = false;

  for (const key of affectedTiles) {
    const bytes = tileMap.get(key) as Uint8Array;
    const [txStr, tyStr] = key.split(',');
    const tx = Number(txStr);
    const ty = Number(tyStr);

    canonicalizeEdgePadding(bytes, definition, tx, ty);

    const newData = encodeBase64(bytes);
    const originalTile = state.tiles.find((t) => t.x === tx && t.y === ty);

    if (originalTile) {
      if (originalTile.data !== newData) {
        hasChange = true;
        changedTiles.push({ x: tx, y: ty, data: newData });
      }
    } else if (!isTileBase(bytes, definition.base)) {
      hasChange = true;
      changedTiles.push({ x: tx, y: ty, data: newData });
    }
  }

  if (!hasChange) return { changed: [], noop: true };

  return { changed: changedTiles, noop: false };
}

export function applyRasterResult(state: FogStateV1, result: RasterResult): FogStateV1 {
  if (result.noop) return state;

  const changedMap = new Map<string, FogTileV1>();
  for (const t of result.changed) changedMap.set(tileKey(t.x, t.y), t);

  const tiles: FogTileV1[] = [];
  const seen = new Set<string>();
  for (const tile of state.tiles) {
    const key = tileKey(tile.x, tile.y);
    seen.add(key);
    const changed = changedMap.get(key);
    if (changed) {
      const bytes = decodeBase64(changed.data);
      if (!isTileBase(bytes, state.definition.base)) {
        tiles.push(changed);
      }
    } else {
      tiles.push(tile);
    }
  }
  for (const t of result.changed) {
    const key = tileKey(t.x, t.y);
    if (seen.has(key)) continue;
    const bytes = decodeBase64(t.data);
    if (!isTileBase(bytes, state.definition.base)) {
      tiles.push(t);
    }
  }

  if (tiles.length > FOG_MAX_TILES) {
    throw new Error(`Fog tile cap exceeded: ${tiles.length} > ${FOG_MAX_TILES}`);
  }

  return { definition: state.definition, tiles };
}

// ── Brush rasterization ──

function sampleAndSimplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const sampled: Point[] = [points[0] as Point];
  let lastSampled = points[0] as Point;

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i] as Point;
    const dx = p.x - lastSampled.x;
    const dy = p.y - lastSampled.y;
    if (dx * dx + dy * dy >= tolerance * tolerance) {
      sampled.push(p);
      lastSampled = p;
    }
  }

  sampled.push(points[points.length - 1] as Point);
  return sampled;
}

function rasterizeBrush(
  points: readonly Point[],
  radius: number,
  def: FogDefinitionV1,
  setCell: (wx: number, wy: number) => void,
): void {
  if (points.length === 0) return;

  const simplified = sampleAndSimplify(points, def.cellSize * 0.5);

  for (let i = 0; i < simplified.length; i++) {
    const p = simplified[i] as Point;
    rasterizeDisc(p.x, p.y, radius, def, setCell);

    if (i > 0) {
      const prev = simplified[i - 1] as Point;
      rasterizeCapsuleSegment(prev.x, prev.y, p.x, p.y, radius, def, setCell);
    }
  }
}

function rasterizeDisc(
  cx: number,
  cy: number,
  radius: number,
  def: FogDefinitionV1,
  setCell: (wx: number, wy: number) => void,
): void {
  const minX = Math.max(def.bounds.x, cx - radius);
  const maxX = Math.min(def.bounds.x + def.bounds.w - 1, cx + radius);
  const minY = Math.max(def.bounds.y, cy - radius);
  const maxY = Math.min(def.bounds.y + def.bounds.h - 1, cy + radius);

  const startCol = Math.floor(minX / def.cellSize) * def.cellSize;
  const startRow = Math.floor(minY / def.cellSize) * def.cellSize;
  const r2 = radius * radius;

  for (let wy = startRow; wy <= maxY; wy += def.cellSize) {
    for (let wx = startCol; wx <= maxX; wx += def.cellSize) {
      const cellCenterX = wx + def.cellSize * 0.5;
      const cellCenterY = wy + def.cellSize * 0.5;
      const dx = cellCenterX - cx;
      const dy = cellCenterY - cy;
      if (dx * dx + dy * dy <= r2) {
        setCell(wx, wy);
      }
    }
  }
}

function rasterizeCapsuleSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
  def: FogDefinitionV1,
  setCell: (wx: number, wy: number) => void,
): void {
  const segDx = x2 - x1;
  const segDy = y2 - y1;
  const segLen2 = segDx * segDx + segDy * segDy;
  if (segLen2 === 0) return;

  const minX = Math.max(def.bounds.x, Math.min(x1, x2) - radius);
  const maxX = Math.min(def.bounds.x + def.bounds.w - 1, Math.max(x1, x2) + radius);
  const minY = Math.max(def.bounds.y, Math.min(y1, y2) - radius);
  const maxY = Math.min(def.bounds.y + def.bounds.h - 1, Math.max(y1, y2) + radius);

  const startCol = Math.floor(minX / def.cellSize) * def.cellSize;
  const startRow = Math.floor(minY / def.cellSize) * def.cellSize;
  const r2 = radius * radius;

  for (let wy = startRow; wy <= maxY; wy += def.cellSize) {
    for (let wx = startCol; wx <= maxX; wx += def.cellSize) {
      const cellCenterX = wx + def.cellSize * 0.5;
      const cellCenterY = wy + def.cellSize * 0.5;
      const t = Math.max(
        0,
        Math.min(1, ((cellCenterX - x1) * segDx + (cellCenterY - y1) * segDy) / segLen2),
      );
      const projX = x1 + t * segDx;
      const projY = y1 + t * segDy;
      const dx = cellCenterX - projX;
      const dy = cellCenterY - projY;
      if (dx * dx + dy * dy <= r2) {
        setCell(wx, wy);
      }
    }
  }
}

// ── Rectangle rasterization ──

function rasterizeRectangle(
  from: Point,
  to: Point,
  def: FogDefinitionV1,
  setCell: (wx: number, wy: number) => void,
): void {
  const minX = Math.max(def.bounds.x, Math.min(from.x, to.x));
  const maxX = Math.min(def.bounds.x + def.bounds.w - 1, Math.max(from.x, to.x));
  const minY = Math.max(def.bounds.y, Math.min(from.y, to.y));
  const maxY = Math.min(def.bounds.y + def.bounds.h - 1, Math.max(from.y, to.y));

  const startCol = Math.floor(minX / def.cellSize) * def.cellSize;
  const startRow = Math.floor(minY / def.cellSize) * def.cellSize;

  for (let wy = startRow; wy <= maxY; wy += def.cellSize) {
    for (let wx = startCol; wx <= maxX; wx += def.cellSize) {
      setCell(wx, wy);
    }
  }
}

// ── Polygon/lasso rasterization ──

function rasterizePolygon(
  points: readonly Point[],
  def: FogDefinitionV1,
  setCell: (wx: number, wy: number) => void,
): void {
  if (points.length < 3) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  minX = Math.max(def.bounds.x, minX);
  maxX = Math.min(def.bounds.x + def.bounds.w - 1, maxX);
  minY = Math.max(def.bounds.y, minY);
  maxY = Math.min(def.bounds.y + def.bounds.h - 1, maxY);

  const startCol = Math.floor(minX / def.cellSize) * def.cellSize;
  const startRow = Math.floor(minY / def.cellSize) * def.cellSize;

  for (let wy = startRow; wy <= maxY; wy += def.cellSize) {
    for (let wx = startCol; wx <= maxX; wx += def.cellSize) {
      const cx = wx + def.cellSize * 0.5;
      const cy = wy + def.cellSize * 0.5;
      if (pointInPolygon(cx, cy, points)) {
        setCell(wx, wy);
      }
    }
  }
}

function pointInPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i] as Point;
    const pj = polygon[j] as Point;
    if (pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}
