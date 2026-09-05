export interface FogSolidStyle {
  kind?: 'solid';
  color: string;
}

export interface FogProceduralStyle {
  kind: 'procedural';
  /** Opaque base fill painted before the noise pattern. */
  backdrop: string;
  /** Tint color mixed into the noise pattern. Defaults to `backdrop`. */
  tint?: string;
  /** Overall noise opacity, 0–1. Default `0.6`. */
  opacity?: number;
  /** Pattern scale in world units per tile repeat. 64–1024. Default `256`. */
  scale?: number;
  /** Deterministic seed, 0–65535. Default `0`. */
  seed?: number;
  /** Noise detail / number of octaves, 1–4. Default `2`. */
  detail?: number;
}

export type FogStyle = FogSolidStyle | FogProceduralStyle;

const DEFAULT_PROCEDURAL_OPACITY = 0.6;
const DEFAULT_PROCEDURAL_SCALE = 256;
const DEFAULT_PROCEDURAL_SEED = 0;
const DEFAULT_PROCEDURAL_DETAIL = 2;

const MIN_SCALE = 64;
const MAX_SCALE = 1024;
const MIN_DETAIL = 1;
const MAX_DETAIL = 4;
const MAX_SEED = 65535;

export interface ResolvedSolidStyle {
  readonly kind: 'solid';
  readonly color: string;
}

export interface ResolvedProceduralStyle {
  readonly kind: 'procedural';
  readonly backdrop: string;
  readonly tint: string;
  readonly opacity: number;
  readonly scale: number;
  readonly seed: number;
  readonly detail: number;
}

export type ResolvedFogStyle = ResolvedSolidStyle | ResolvedProceduralStyle;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveFogStyle(
  style: FogStyle | undefined,
  legacyColor: string | undefined,
  defaultColor: string,
): ResolvedFogStyle {
  if (style && style.kind === 'procedural') {
    const opacity =
      style.opacity !== undefined ? clamp(style.opacity, 0, 1) : DEFAULT_PROCEDURAL_OPACITY;
    const scale =
      style.scale !== undefined
        ? clamp(style.scale, MIN_SCALE, MAX_SCALE)
        : DEFAULT_PROCEDURAL_SCALE;
    const seed =
      style.seed !== undefined
        ? clamp(Math.floor(style.seed), 0, MAX_SEED)
        : DEFAULT_PROCEDURAL_SEED;
    const detail =
      style.detail !== undefined
        ? clamp(Math.floor(style.detail), MIN_DETAIL, MAX_DETAIL)
        : DEFAULT_PROCEDURAL_DETAIL;
    return {
      kind: 'procedural',
      backdrop: style.backdrop,
      tint: style.tint ?? style.backdrop,
      opacity,
      scale,
      seed,
      detail,
    };
  }

  if (style && (!style.kind || style.kind === 'solid')) {
    return { kind: 'solid', color: style.color };
  }

  return { kind: 'solid', color: legacyColor ?? defaultColor };
}

export function fogStyleCacheKey(style: ResolvedFogStyle): string {
  if (style.kind === 'solid') return `s\0${style.color}`;
  return `p\0${style.backdrop}\0${style.tint}\0${style.opacity}\0${style.scale}\0${style.seed}\0${style.detail}`;
}
