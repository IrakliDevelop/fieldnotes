import { describe, expect, it } from 'vitest';
import { adaptColor } from './theme-color';
import {
  blendModeFor,
  DARK_THEME_TOKENS,
  DEFAULT_THEME,
  inkFor,
  LIGHT_THEME_TOKENS,
  resolveTheme,
} from './theme';

describe('themes', () => {
  it('keeps light identity and freezes resolved tokens', () => {
    const light = resolveTheme('light');
    expect(light.tokens).toEqual(LIGHT_THEME_TOKENS);
    expect(DEFAULT_THEME.tokens).toEqual(LIGHT_THEME_TOKENS);
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true);
    expect(Object.isFrozen(light.tokens)).toBe(true);
    expect(Object.isFrozen(LIGHT_THEME_TOKENS)).toBe(true);
    expect(Object.isFrozen(DARK_THEME_TOKENS)).toBe(true);
    for (const color of ['#000000', 'garbage', '']) {
      expect(light.adapt(color)).toBe(color);
      expect(light.adaptOn(color, '#ffffff')).toBe(color);
    }
  });

  it('resolves bases and token overrides', () => {
    expect(resolveTheme('dark').adapt('#000000')).toBe('#ededed');
    expect(Object.isFrozen(resolveTheme('dark').tokens)).toBe(true);
    const dark = resolveTheme({ base: 'dark', tokens: { board: '#000000' } });
    expect(dark.tokens).toEqual({ ...DARK_THEME_TOKENS, board: '#000000' });
    expect(dark.adapt('#808080')).toBe('#7f7f7f');
    expect(resolveTheme('system', true).base).toBe('dark');
    expect(resolveTheme('system', false).base).toBe('light');
    expect(resolveTheme({ base: 'system', dark: { board: '#000000' } }, true).tokens.board).toBe(
      '#000000',
    );
    expect(
      resolveTheme({ base: 'system', light: { pattern: '#123456' } }, false).tokens.pattern,
    ).toBe('#123456');
  });

  it('maps blended ink only on dark', () => {
    const dark = resolveTheme('dark');
    expect(blendModeFor(dark, 'multiply')).toBe('screen');
    expect(blendModeFor(DEFAULT_THEME, 'multiply')).toBe('multiply');
    expect(blendModeFor(dark, undefined)).toBeUndefined();
    expect(inkFor(dark, '#ffeb3b', 'multiply')).toBe('#ffeb3b');
    expect(inkFor(dark, '#000000')).toBe('#ededed');
    expect(adaptColor('#000000', dark.tokens.board)).toBe('#ededed');
  });
});
