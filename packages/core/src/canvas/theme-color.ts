interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

let context: CanvasRenderingContext2D | null | undefined;
let canvasUnavailable = false;

const FALLBACK_BOARD_LIGHTNESS = 0.2395;
const FALLBACK_BOARD: Rgba = { r: 30, g: 31, b: 34, a: 1 };
const CACHE_LIMIT = 4096;

function isSentinel(color: string): boolean {
  return ['none', 'transparent', '', 'currentcolor'].includes(color.toLowerCase());
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function parsePart(value: string, max: number): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(value.endsWith('%') ? (parsed / 100) * max : parsed, 0, max);
}

function parseAlpha(value: string | undefined): number | null {
  return value === undefined ? 1 : parsePart(value, 1);
}

function parseHex(input: string): Rgba | null {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(input);
  if (!match) return null;
  const hex = match[1];
  if (hex === undefined) return null;
  const expanded = hex.length < 5 ? [...hex].map((part) => part + part).join('') : hex;
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: alpha,
  };
}

function parseRgb(input: string): Rgba | null {
  const match = /^rgba?\((.*)\)$/i.exec(input.trim());
  if (!match) return null;
  const body = match[1]?.trim();
  if (!body) return null;
  const [channels, alpha] = body.split('/').map((part) => part.trim());
  if (body.split('/').length > 2 || channels === undefined) return null;
  const parts = channels.includes(',')
    ? channels.split(',').map((part) => part.trim())
    : channels.split(/\s+/);
  const channelAlpha = alpha ?? (parts.length === 4 ? parts.pop() : undefined);
  if (parts.length !== 3) return null;
  const r = parsePart(parts[0] ?? '', 255);
  const g = parsePart(parts[1] ?? '', 255);
  const b = parsePart(parts[2] ?? '', 255);
  const a = parseAlpha(channelAlpha);
  return r === null || g === null || b === null || a === null ? null : { r, g, b, a };
}

function parseHsl(input: string): Rgba | null {
  const match = /^hsla?\((.*)\)$/i.exec(input.trim());
  if (!match) return null;
  const body = match[1]?.trim();
  if (!body) return null;
  const [channels, alpha] = body.split('/').map((part) => part.trim());
  if (body.split('/').length > 2 || channels === undefined) return null;
  const parts = channels.includes(',')
    ? channels.split(',').map((part) => part.trim())
    : channels.split(/\s+/);
  const channelAlpha = alpha ?? (parts.length === 4 ? parts.pop() : undefined);
  if (parts.length !== 3) return null;
  const hueValue = parts[0] ?? '';
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(hueValue)) return null;
  const hue = ((Number.parseFloat(hueValue) % 360) + 360) % 360;
  const saturation = parsePart(parts[1] ?? '', 1);
  const lightness = parsePart(parts[2] ?? '', 1);
  const a = parseAlpha(channelAlpha);
  if (!Number.isFinite(hue) || saturation === null || lightness === null || a === null) return null;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const matchHue = hue;
  const [r, g, b] =
    matchHue < 60
      ? [chroma, second, 0]
      : matchHue < 120
        ? [second, chroma, 0]
        : matchHue < 180
          ? [0, chroma, second]
          : matchHue < 240
            ? [0, second, chroma]
            : matchHue < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return { r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255, a };
}

function parseLiteralColor(input: string): Rgba | null {
  return parseHex(input.trim()) ?? parseRgb(input) ?? parseHsl(input);
}

function normalizedColor(input: string): Rgba | null {
  const direct = parseLiteralColor(input);
  if (direct) return direct;
  if (canvasUnavailable || typeof document === 'undefined') return null;
  if (context === undefined) {
    context = document.createElement('canvas').getContext('2d');
    if (!context) {
      canvasUnavailable = true;
      return null;
    }
  }
  const activeContext = context;
  if (!activeContext) return null;
  activeContext.fillStyle = '#010203';
  activeContext.fillStyle = input;
  const normalized = activeContext.fillStyle;
  return normalized === '#010203' ? null : parseLiteralColor(normalized);
}

/** Parses a CSS colour used by the theme implementation. */
export function parseColor(input: string): Rgba | null {
  return normalizedColor(input);
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function gamma(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function toOklab(color: Rgba): Oklab {
  const r = linear(color.r / 255);
  const g = linear(color.g / 255);
  const b = linear(color.b / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function fromOklab(lab: Oklab, alpha: number): Rgba {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return {
    r: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    g: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    b: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
    a: alpha,
  };
}

function inGamut(color: Rgba): boolean {
  return (
    color.r >= 0 &&
    color.r <= 255 &&
    color.g >= 0 &&
    color.g <= 255 &&
    color.b >= 0 &&
    color.b <= 255
  );
}

function format(color: Rgba): string {
  const r = Math.round(clamp(color.r, 0, 255));
  const g = Math.round(clamp(color.g, 0, 255));
  const b = Math.round(clamp(color.b, 0, 255));
  if (color.a === 1)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  return `rgba(${r}, ${g}, ${b}, ${Number(color.a.toFixed(3))})`;
}

/** Returns the OKLab lightness of a parsed colour. */
export function oklabLightness(color: string): number {
  const parsed = normalizedColor(color);
  return parsed ? toOklab(parsed).l : FALLBACK_BOARD_LIGHTNESS;
}

/** Flips an OKLab lightness through the specified grey-channel curve. */
export function flip(lightness: number): number {
  return Math.cbrt(linear(0.93 - 0.86 * gamma(lightness ** 3)));
}

function adaptParsed(color: Rgba, boardLightness: number): Rgba {
  const lab = toOklab(color);
  const chroma = Math.hypot(lab.a, lab.b);
  const hue = Math.atan2(lab.b, lab.a);
  const lightness =
    Math.abs(flip(lab.l) - boardLightness) < 0.2 ? Math.min(1, boardLightness + 0.2) : flip(lab.l);
  let adaptedChroma = chroma;
  let result = fromOklab(
    { l: lightness, a: adaptedChroma * Math.cos(hue), b: adaptedChroma * Math.sin(hue) },
    color.a,
  );
  while (!inGamut(result) && adaptedChroma > 0.000001) {
    adaptedChroma *= 0.9;
    result = fromOklab(
      { l: lightness, a: adaptedChroma * Math.cos(hue), b: adaptedChroma * Math.sin(hue) },
      color.a,
    );
  }
  return result;
}

/** Adapts one colour for a dark board. */
export function adaptColor(color: string, boardColor: string): string {
  if (isSentinel(color)) return color;
  const parsed = normalizedColor(color);
  if (!parsed) return color;
  return format(adaptParsed(parsed, resolveBoard(boardColor).lightness));
}

function resolveBoard(boardColor: string): { readonly color: Rgba; readonly lightness: number } {
  if (isSentinel(boardColor)) return { color: FALLBACK_BOARD, lightness: FALLBACK_BOARD_LIGHTNESS };
  const parsed = normalizedColor(boardColor);
  return parsed
    ? { color: parsed, lightness: toOklab(parsed).l }
    : { color: FALLBACK_BOARD, lightness: FALLBACK_BOARD_LIGHTNESS };
}

function contrast(a: Rgba, b: Rgba): number {
  const luminance = (color: Rgba) =>
    0.2126 * linear(color.r / 255) +
    0.7152 * linear(color.g / 255) +
    0.0722 * linear(color.b / 255);
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

/** Creates bounded colour caches for one dark board. */
export function createAdapter(boardColor: string) {
  const board = resolveBoard(boardColor);
  const adaptCache = new Map<string, string>();
  const adaptOnCache = new Map<string, string>();
  const adapt = (color: string): string => {
    const cached = adaptCache.get(color);
    if (cached !== undefined) return cached;
    const adapted = isSentinel(color)
      ? color
      : (() => {
          const parsed = normalizedColor(color);
          return parsed ? format(adaptParsed(parsed, board.lightness)) : color;
        })();
    if (adaptCache.size === CACHE_LIMIT) adaptCache.clear();
    adaptCache.set(color, adapted);
    return adapted;
  };
  const adaptOn = (text: string, background: string): string => {
    const key = `${text}\u0000${background}`;
    const cached = adaptOnCache.get(key);
    if (cached !== undefined) return cached;
    const store = (value: string) => {
      if (adaptOnCache.size === CACHE_LIMIT) adaptOnCache.clear();
      adaptOnCache.set(key, value);
      return value;
    };
    if (isSentinel(text)) return store(text);
    const originalText = normalizedColor(text);
    if (originalText?.a === 0) return store(text);
    const adaptedText = normalizedColor(adapt(text));
    if (!adaptedText) return store(text);
    const adaptedBackground = isSentinel(background) ? null : normalizedColor(adapt(background));
    const contrastBackground = adaptedBackground
      ? composite(adaptedBackground, board.color)
      : board.color;
    const score = (candidate: Rgba): string | null => {
      const value = format(candidate);
      const parsed = normalizedColor(value);
      if (!parsed || contrast(composite(parsed, contrastBackground), contrastBackground) < 4.5)
        return null;
      return value;
    };
    const find = (alpha: number): string | null => {
      const initial = score({ ...adaptedText, a: alpha });
      if (initial) return initial;
      const lab = toOklab(adaptedText);
      const chroma = Math.hypot(lab.a, lab.b);
      const hue = Math.atan2(lab.b, lab.a);
      for (let step = 1; step <= 100; step++) {
        for (const lightness of [
          Math.min(1, lab.l + step * 0.01),
          Math.max(0, lab.l - step * 0.01),
        ]) {
          let c = chroma;
          let candidate = fromOklab(
            { l: lightness, a: c * Math.cos(hue), b: c * Math.sin(hue) },
            alpha,
          );
          while (!inGamut(candidate) && c > 0.000001) {
            c *= 0.9;
            candidate = fromOklab(
              { l: lightness, a: c * Math.cos(hue), b: c * Math.sin(hue) },
              alpha,
            );
          }
          const result = score(candidate);
          if (result) return result;
        }
      }
      return null;
    };
    const result = find(adaptedText.a) ?? (adaptedText.a < 1 ? find(1) : null);
    if (result) return store(result);
    const black = '#000000';
    const white = '#ffffff';
    const fallback =
      contrast({ r: 255, g: 255, b: 255, a: 1 }, contrastBackground) >=
      contrast({ r: 0, g: 0, b: 0, a: 1 }, contrastBackground)
        ? white
        : black;
    return store(fallback);
  };
  return { adapt, adaptOn, cacheSize: () => adaptCache.size };
}
