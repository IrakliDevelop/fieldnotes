import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureText, setTextMeasurer } from './text-measure';

const suiteMeasurer = (text: string) => text.length * 10;

afterEach(() => {
  setTextMeasurer(suiteMeasurer);
});

describe('measureText', () => {
  it('keeps cached measurements isolated from callers', () => {
    setTextMeasurer(suiteMeasurer);

    const first = measureText('hello', 16, null);
    first.w = 0;
    const second = measureText('hello', 16, null);
    expect(second).toEqual({ w: 54, h: 26.4 });
    expect(second).not.toBe(first);

    second.h = 0;
    expect(measureText('hello', 16, null)).toEqual({ w: 54, h: 26.4 });
  });

  it('wraps a constrained box at its padded content width', () => {
    setTextMeasurer(suiteMeasurer);

    expect(measureText('aaaaa bbbb', 16, 100)).toEqual({ w: 100, h: 48.8 });
  });

  it('wraps, measures unwrapped content, and caches identical measurements', () => {
    const measure = vi.fn(suiteMeasurer);
    setTextMeasurer(measure);

    expect(measureText('hello world', 16, 60)).toEqual({ w: 60, h: 2 * 16 * 1.4 + 4 });
    expect(measureText('hello world', 16, null)).toEqual({ w: 114, h: 16 * 1.4 + 4 });
    measure.mockClear();
    measureText('hello', 16, 60);
    measureText('hello', 16, 60);

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('evicts the FIFO size cache after 512 entries', () => {
    const measure = vi.fn(suiteMeasurer);
    setTextMeasurer(measure);
    for (let i = 0; i <= 512; i++) measureText(`item-${i}`, 16, null);
    measureText('item-0', 16, null);

    expect(measure).toHaveBeenCalledTimes(514);
  });

  it('clears cached measurements when the measurer changes', () => {
    const first = vi.fn(suiteMeasurer);
    const second = vi.fn(suiteMeasurer);
    setTextMeasurer(first);
    measureText('hello', 16, null);
    setTextMeasurer(second);
    measureText('hello', 16, null);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('uses the requested base font size when cached HTML is measured again', () => {
    setTextMeasurer((text, font) => text.length * Number(/(\d+)px/.exec(font)?.[1]));

    expect(measureText('xx', 16, null)).toEqual({ w: 36, h: 26.4 });
    expect(measureText('xx', 32, null)).toEqual({ w: 68, h: 48.8 });
  });

  it('keeps positive inline font sizes absolute', () => {
    setTextMeasurer((text, font) => text.length * Number(/(\d+)px/.exec(font)?.[1]));

    expect(measureText('<span style="font-size: 20px">x</span>', 16, null)).toEqual({
      w: 24,
      h: 32,
    });
    expect(measureText('<span style="font-size: 20px">x</span>', 32, null)).toEqual({
      w: 24,
      h: 32,
    });
  });

  it('uses the run font size in the no-canvas fallback', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    setTextMeasurer(null);

    expect(measureText('abc', 30, null)).toEqual({ w: 58, h: 46 });

    getContext.mockRestore();
  });

  it('measures empty content as one requested-size line', () => {
    setTextMeasurer(suiteMeasurer);

    expect(measureText('', 30, null)).toEqual({ w: 4, h: 46 });
  });

  it('reuses, evicts, and clears parsed HTML separately from sizes', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    setTextMeasurer(suiteMeasurer);
    measureText('repeat', 16, null);
    measureText('repeat', 32, null);
    measureText('repeat', 16, 40);
    expect(parse).toHaveBeenCalledTimes(1);

    for (let i = 0; i <= 512; i++) measureText(`html-${i}`, 16, null);
    measureText('repeat', 16, null);
    expect(parse).toHaveBeenCalledTimes(515);

    setTextMeasurer(suiteMeasurer);
    measureText('repeat', 16, null);
    expect(parse).toHaveBeenCalledTimes(516);
    parse.mockRestore();
  });
});
