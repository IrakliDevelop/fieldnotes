import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureText, setTextMeasurer } from './text-measure';

const suiteMeasurer = (text: string) => text.length * 10;

afterEach(() => {
  setTextMeasurer(suiteMeasurer);
});

describe('measureText', () => {
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

  it('evicts both FIFO caches after 512 entries', () => {
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
});
