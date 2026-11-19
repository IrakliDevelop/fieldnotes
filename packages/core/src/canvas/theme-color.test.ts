import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptColor, createAdapter, flip, oklabLightness } from './theme-color';

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
    expect(adaptColor(input, '#1e1f22')).toBe(expected);
  });

  it('keeps sentinels and maps HSL', () => {
    const adapter = createAdapter('#1e1f22');
    for (const value of ['none', 'transparent', '', 'currentColor', 'CurrentColor'])
      expect(adapter.adapt(value)).toBe(value);
    expect(adapter.adapt('hsl(0 100% 50%)')).toBe('#e00905');
  });

  it('uses the board floor and fallback lightness', () => {
    expect(adaptColor('#808080', '#000000')).toBe('#7f7f7f');
    expect(oklabLightness(adaptColor('#808080', '#717171'))).toBeCloseTo(0.75, 2);
    expect(adaptColor('#ffffff', 'garbage')).toBe('#525252');
    expect(adaptColor('#ffffff', 'transparent')).toBe('#525252');
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
