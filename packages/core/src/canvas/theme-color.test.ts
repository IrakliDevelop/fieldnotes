import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapter, flip, oklabLightness } from './theme-color';

function rgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function contrast(first: readonly number[], second: readonly number[]): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: readonly number[]) =>
    0.2126 * linear(color[0] ?? 0) +
    0.7152 * linear(color[1] ?? 0) +
    0.0722 * linear(color[2] ?? 0);
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgba(value: string): readonly [number, number, number, number] {
  const match = /^rgba\((\d+), (\d+), (\d+), (0\.\d+)\)$/.exec(value);
  if (!match) throw new Error(`expected rgba: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('theme colour adaptation', () => {
  it.each([
    ['#000000', '#ededed'],
    ['#1a1a1a', '#d7d7d7'],
    ['#808080', '#7f7f7f'],
    ['#ffffff', '#525252'],
    ['#eeeeee', '#525252'],
    ['#ffeb3b', '#5c540d'],
    ['#ffc107', '#674e10'],
    ['#ff0000', '#e00905'],
    ['#e53935', '#de312f'],
    ['#1e88e5', '#057cd8'],
    ['#43a047', '#2f8e35'],
    ['#2196F3', '#1c74bc'],
    ['#64748b', '#7b8ca4'],
    ['#9e9e9e', '#656565'],
    ['rgba(0,0,0,0.5)', 'rgba(237, 237, 237, 0.5)'],
    ['rgba(255, 87, 34, 0.2)', 'rgba(184, 55, 10, 0.2)'],
  ])('maps %s on the dark board to %s', (input, expected) => {
    expect(createAdapter('#1e1f22').adapt(input)).toBe(expected);
  });

  it('keeps sentinels and maps HSL', () => {
    const adapter = createAdapter('#1e1f22');
    for (const value of ['none', 'transparent', '', 'currentColor', 'CurrentColor'])
      expect(adapter.adapt(value)).toBe(value);
    expect(adapter.adapt('hsl(0 100% 50%)')).toBe('#e00905');
  });

  it('uses the board floor and fallback lightness', () => {
    expect(createAdapter('#000000').adapt('#808080')).toBe('#7f7f7f');
    expect(oklabLightness(createAdapter('#717171').adapt('#808080'))).toBeCloseTo(0.75, 2);
    expect(createAdapter('garbage').adapt('#ffffff')).toBe('#525252');
    expect(createAdapter('transparent').adapt('#ffffff')).toBe('#525252');
    expect(flip(0.6)).toBeCloseTo(0.6, 2);
    expect(flip(0)).toBeCloseTo(0.9466, 3);
  });

  it.each([
    ['#000000', '#ffeb3b', '#ededed'],
    ['#ffffff', '#e53935', '#030303'],
    ['#ffffff', '#1e88e5', '#0d0d0d'],
    ['#ffffff', '#43a047', '#111111'],
    ['#1a1a1a', '#ffffff', '#d7d7d7'],
    ['#ffffff', '#ff9800', '#c3c3c3'],
    ['#1a1a1a', '#808080', '#161616'],
    ['#ffffff', '#2196F3', '#f8f8f8'],
  ])('adapts %s on %s to %s', (text, background, expected) => {
    expect(createAdapter('#1e1f22').adaptOn(text, background)).toBe(expected);
  });

  it('keeps adaptOn sentinels and uses the board for transparent backgrounds', () => {
    const adapter = createAdapter('#1e1f22');
    expect(adapter.adaptOn('#000000', 'transparent')).toBe(adapter.adapt('#000000'));
    expect(adapter.adaptOn('currentColor', '#ffeb3b')).toBe('currentColor');
  });

  it('starts contrast search from the formatted adapted colour at a boundary', () => {
    expect(createAdapter('#1e1f22').adaptOn('#ffffff', '#ff9800')).toBe('#c3c3c3');
  });

  it('measures translucent text after compositing over its adapted background', () => {
    const adapter = createAdapter('#1e1f22');
    expect(adapter.adaptOn('rgba(0,0,0,0.2)', '#ffeb3b')).toBe('#ededed');
    expect(adapter.adaptOn('rgba(0,0,0,0.8)', '#ffeb3b')).toBe('rgba(237, 237, 237, 0.8)');
    expect(adapter.adaptOn('rgba(0,0,0,0)', '#ffeb3b')).toBe('rgba(0,0,0,0)');
    const translucent = adapter.adaptOn('rgba(0,0,0,0.7)', '#ffeb3b');
    expect(translucent).toMatch(/^rgba\(\d+, \d+, \d+, 0\.7\)$/);
    const [r, g, b, alpha] = rgba(translucent);
    const background = rgb('#5c540d');
    expect(
      contrast(
        [
          r * alpha + background[0] * (1 - alpha),
          g * alpha + background[1] * (1 - alpha),
          b * alpha + background[2] * (1 - alpha),
        ],
        background,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['#ffffff', '#7f7f7f', '#808080'],
    ['#ffeb3b', '#808080', '#7f7f7f'],
  ])('rounds %s on %s to at least 4.5:1', (text, background, adaptedBackground) => {
    const output = createAdapter('#1e1f22').adaptOn(text, background);
    expect(contrast(rgb(output), rgb(adaptedBackground))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses bounded independent caches', () => {
    const adapter = createAdapter('#1e1f22');
    expect(adapter.cacheSize()).toBe(0);
    adapter.adapt('#000000');
    expect(adapter.cacheSize()).toBe(1);
    adapter.adapt('#000000');
    expect(adapter.cacheSize()).toBe(1);
    for (let index = 0; index < 4097; index++)
      adapter.adapt(`#${index.toString(16).padStart(6, '0')}`);
    expect(adapter.cacheSize()).toBe(1);
  });

  it('only tries jsdom canvas once after it is unavailable', async () => {
    vi.resetModules();
    const getContext = vi.fn(() => null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext);
    const { createAdapter: freshAdapter } = await import('./theme-color');
    const adapter = freshAdapter('#1e1f22');
    for (let index = 0; index < 10; index++)
      expect(adapter.adapt(`unknown-${index}`)).toBe(`unknown-${index}`);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('normalizes valid canvas colours once', async () => {
    vi.resetModules();
    let value = '';
    const assigned: string[] = [];
    const context = {
      get fillStyle() {
        return value;
      },
      set fillStyle(next: string) {
        assigned.push(next);
        value = next === 'red' ? '#ff0000' : next;
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const { createAdapter: freshAdapter } = await import('./theme-color');
    const adapter = freshAdapter('#1e1f22');
    expect(adapter.adapt('red')).toBe('#e00905');
    adapter.adapt('red');
    expect(assigned.filter((entry) => entry === 'red')).toHaveLength(1);
  });

  it('returns invalid canvas assignments unchanged', async () => {
    vi.resetModules();
    let value = '';
    const context = {
      get fillStyle() {
        return value;
      },
      set fillStyle(next: string) {
        value = next === 'red' ? '#010203' : next;
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const { createAdapter: freshAdapter } = await import('./theme-color');
    expect(freshAdapter('#1e1f22').adapt('red')).toBe('red');
  });

  it('returns values whose normalized canvas form is still unparseable unchanged', async () => {
    vi.resetModules();
    let value = '';
    const context = {
      get fillStyle() {
        return value;
      },
      set fillStyle(next: string) {
        value = next === 'red' ? 'foo' : next;
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const { createAdapter: freshAdapter } = await import('./theme-color');
    expect(freshAdapter('#1e1f22').adapt('red')).toBe('red');
  });
});
