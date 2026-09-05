import type { ResolvedProceduralStyle } from './fog-style';
import { fogStyleCacheKey } from './fog-style';

const TILE_PX = 128;

export interface ProceduralTileData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function xorshift32(state: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function seedState(seed: number): number {
  return (seed * 2654435761 + 1) >>> 0 || 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function generateGradients(
  size: number,
  prngState: number,
): { gx: Float32Array; gy: Float32Array; state: number } {
  const count = size * size;
  const gx = new Float32Array(count);
  const gy = new Float32Array(count);
  let s = prngState;
  for (let i = 0; i < count; i++) {
    s = xorshift32(s);
    const angle = ((s >>> 0) / 0x100000000) * Math.PI * 2;
    gx[i] = Math.cos(angle);
    gy[i] = Math.sin(angle);
  }
  return { gx, gy, state: s };
}

function perlinNoise(
  px: number,
  py: number,
  gridSize: number,
  gx: Float32Array,
  gy: Float32Array,
): number {
  const gx0 = Math.floor(px) % gridSize;
  const gy0 = Math.floor(py) % gridSize;
  const gx1 = (gx0 + 1) % gridSize;
  const gy1 = (gy0 + 1) % gridSize;

  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);

  const sx = smoothstep(fx);
  const sy = smoothstep(fy);

  const dot = (ix: number, iy: number, dx: number, dy: number): number => {
    const idx = iy * gridSize + ix;
    return (gx[idx] as number) * dx + (gy[idx] as number) * dy;
  };

  const n00 = dot(gx0, gy0, fx, fy);
  const n10 = dot(gx1, gy0, fx - 1, fy);
  const n01 = dot(gx0, gy1, fx, fy - 1);
  const n11 = dot(gx1, gy1, fx - 1, fy - 1);

  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function layeredNoise(
  x: number,
  y: number,
  octaves: number,
  gridSize: number,
  gx: Float32Array,
  gy: Float32Array,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    value += perlinNoise(x * frequency, y * frequency, gridSize * frequency, gx, gy) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return (value / maxAmplitude + 1) * 0.5;
}

export function generateProceduralTile(style: ResolvedProceduralStyle): ProceduralTileData {
  const gridSize = 8;
  const maxFreq = gridSize * (1 << (style.detail - 1));
  const { gx, gy } = generateGradients(maxFreq, seedState(style.seed));

  const data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);

  const r = parseInt(style.tint.slice(1, 3), 16) || 0;
  const g = parseInt(style.tint.slice(3, 5), 16) || 0;
  const b = parseInt(style.tint.slice(5, 7), 16) || 0;

  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const nx = (px / TILE_PX) * gridSize;
      const ny = (py / TILE_PX) * gridSize;
      const n = layeredNoise(nx, ny, style.detail, gridSize, gx, gy);
      const alpha = Math.round(n * style.opacity * 255);
      const idx = (py * TILE_PX + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
  }

  return { data, width: TILE_PX, height: TILE_PX };
}

const tileCache = new Map<string, ProceduralTileData>();
const MAX_CACHED_TILES = 16;

export function getCachedProceduralTile(style: ResolvedProceduralStyle): ProceduralTileData {
  const key = fogStyleCacheKey(style);
  const cached = tileCache.get(key);
  if (cached) return cached;

  const tile = generateProceduralTile(style);

  if (tileCache.size >= MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next().value as string | undefined;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(key, tile);
  return tile;
}

export function clearProceduralTileCache(): void {
  tileCache.clear();
}

export { TILE_PX as PROCEDURAL_TILE_PX };
