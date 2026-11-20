import { createAdapter, oklabLightness, parseColor } from './theme-color';

/** Concrete theme bases. */
export type ThemeBase = 'light' | 'dark';

/** Chrome colours as CSS values. */
export interface ThemeTokens {
  readonly board: string;
  readonly pattern: string;
  readonly selection: string;
  readonly handleFill: string;
  readonly snapGuide: string;
  readonly labelPlate: string;
  readonly placeholderFill: string;
  readonly placeholderStroke: string;
  readonly placeholderText: string;
  readonly widgetPlaceholderStroke: string;
  readonly widgetPlaceholderText: string;
  readonly minimapBackground: string;
  readonly minimapBorder: string;
  readonly minimapViewport: string;
  readonly toolbarBackground: string;
  readonly toolbarBorder: string;
  readonly toolbarActive: string;
  readonly chromeText: string;
  readonly paletteBackground: string;
  readonly paletteBorder: string;
  readonly paletteText: string;
  readonly paletteMuted: string;
  readonly paletteActive: string;
  readonly paletteShadow: string;
}

/** Light chrome token defaults. */
export const LIGHT_THEME_TOKENS: ThemeTokens = Object.freeze({
  board: 'transparent',
  pattern: '#d0d0d0',
  selection: '#2196F3',
  handleFill: '#ffffff',
  snapGuide: '#FF4081',
  labelPlate: 'rgba(255,255,255,0.9)',
  placeholderFill: '#eeeeee',
  placeholderStroke: '#bdbdbd',
  placeholderText: '#9e9e9e',
  widgetPlaceholderStroke: '#a1a1aa',
  widgetPlaceholderText: '#71717a',
  minimapBackground: 'rgba(255,255,255,0.85)',
  minimapBorder: 'rgba(0,0,0,0.15)',
  minimapViewport: '#3b82f6',
  toolbarBackground: '#fff',
  toolbarBorder: '#ccc',
  toolbarActive: '#e0e0e0',
  chromeText: '',
  paletteBackground: '#fff',
  paletteBorder: '#d1d5db',
  paletteText: '#1a1a1a',
  paletteMuted: '#6b7280',
  paletteActive: '#e8f0fe',
  paletteShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
});

/** Dark chrome token defaults. */
export const DARK_THEME_TOKENS: ThemeTokens = Object.freeze({
  board: '#1e1f22',
  pattern: '#3b3d42',
  selection: '#64b5f6',
  handleFill: '#1e1f22',
  snapGuide: '#ff79a8',
  labelPlate: 'rgba(30,31,34,0.9)',
  placeholderFill: '#2a2b30',
  placeholderStroke: '#4b4b4b',
  placeholderText: '#9aa0a6',
  widgetPlaceholderStroke: '#4b4b4b',
  widgetPlaceholderText: '#9aa0a6',
  minimapBackground: 'rgba(30,31,34,0.85)',
  minimapBorder: 'rgba(255,255,255,0.15)',
  minimapViewport: '#60a5fa',
  toolbarBackground: '#2a2b30',
  toolbarBorder: '#4b4b4b',
  toolbarActive: '#3b3d42',
  chromeText: '#e8eaed',
  paletteBackground: '#2a2b30',
  paletteBorder: '#4b4b4b',
  paletteText: '#e8eaed',
  paletteMuted: '#9aa0a6',
  paletteActive: '#1c3a5e',
  paletteShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
});

/** A fixed base with token overrides. */
export interface FixedThemeSpec {
  readonly base: ThemeBase;
  readonly tokens?: Partial<ThemeTokens>;
}
/** System-selected token overrides. */
export interface SystemThemeSpec {
  readonly base: 'system';
  readonly light?: Partial<ThemeTokens>;
  readonly dark?: Partial<ThemeTokens>;
}
/** A concrete or system theme specification. */
export type ThemeSpec = FixedThemeSpec | SystemThemeSpec;
/** A theme accepted where system selection is unavailable. */
export type FixedTheme = ThemeBase | FixedThemeSpec;
/** A complete viewer theme specification. */
export type Theme = FixedTheme | 'system' | SystemThemeSpec;

/** The resolved tokens and colour functions for one surface. */
export interface ResolvedTheme {
  readonly base: ThemeBase;
  readonly tokens: ThemeTokens;
  adapt(color: string): string;
  adaptOn(text: string, background: string): string;
}

function definedTokens(tokens: Partial<ThemeTokens> | undefined): Partial<ThemeTokens> {
  if (!tokens) return {};
  return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined));
}

/** Resolves a theme for an optional known system preference. */
export function resolveTheme(theme: Theme, systemDark = false): ResolvedTheme {
  if (theme === 'system') return resolveTheme(systemDark ? 'dark' : 'light');
  if (theme !== null && typeof theme === 'object' && theme.base === 'system')
    return resolveTheme({
      base: systemDark ? 'dark' : 'light',
      tokens: definedTokens(theme[systemDark ? 'dark' : 'light']),
    });
  const base: ThemeBase =
    (typeof theme === 'string' ? theme : theme?.base) === 'dark' ? 'dark' : 'light';
  const overrides =
    typeof theme === 'object' && theme !== null ? definedTokens(theme.tokens) : undefined;
  const tokens = Object.freeze({
    ...(base === 'dark' ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS),
    ...overrides,
  });
  if (base === 'light')
    return Object.freeze({
      base,
      tokens,
      adapt: (color: string) => color,
      adaptOn: (text: string) => text,
    });
  const adapter = createAdapter(tokens.board);
  return Object.freeze({ base, tokens, adapt: adapter.adapt, adaptOn: adapter.adaptOn });
}

/** The frozen default light theme. */
export const DEFAULT_THEME = Object.freeze(resolveTheme('light'));

/** Returns the opaque board colour used when exporting a surface. */
export function defaultExportBackground(theme: ResolvedTheme): string {
  const board = parseColor(theme.tokens.board);
  if (board?.a === 1) return theme.tokens.board;
  return theme.base === 'dark' ? DARK_THEME_TOKENS.board : '#ffffff';
}

/** Maps stored blend modes to the active drawing mode. */
export function blendModeFor(
  theme: ResolvedTheme,
  mode: 'multiply' | undefined,
): 'multiply' | 'screen' | undefined {
  return theme.base === 'dark' && mode === 'multiply' ? 'screen' : mode;
}

/** Returns stored highlighter ink or adapted ordinary ink. */
export function inkFor(theme: ResolvedTheme, color: string, mode?: 'multiply'): string {
  if (theme.base !== 'dark' || mode !== 'multiply') return theme.adapt(color);
  return parseColor(color) && oklabLightness(color) >= 0.6 ? color : theme.adapt(color);
}
