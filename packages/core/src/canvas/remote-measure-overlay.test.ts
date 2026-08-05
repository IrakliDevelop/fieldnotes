import { describe, expect, it } from 'vitest';
import {
  isMeasurePresence,
  toMeasurePresence,
  MEASURE_PRESENCE_KIND,
} from './remote-measure-overlay';

const active = {
  kind: 'measure',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
  cells: 6,
  feet: 30,
  color: '#FF5722',
};

describe('isMeasurePresence', () => {
  it('accepts an active payload and the cleared form', () => {
    expect(isMeasurePresence(active)).toBe(true);
    expect(isMeasurePresence({ kind: 'measure', cleared: true })).toBe(true);
  });

  it('accepts an active payload without the optional color', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, ...noColor } = active;
    expect(isMeasurePresence(noColor)).toBe(true);
  });

  it('rejects wrong kinds, primitives, and null', () => {
    expect(isMeasurePresence({ ...active, kind: 'ping' })).toBe(false);
    expect(isMeasurePresence('measure')).toBe(false);
    expect(isMeasurePresence(null)).toBe(false);
    expect(isMeasurePresence(undefined)).toBe(false);
  });

  it('rejects non-finite or missing numeric fields', () => {
    expect(isMeasurePresence({ ...active, feet: Number.NaN })).toBe(false);
    expect(isMeasurePresence({ ...active, cells: Infinity })).toBe(false);
    expect(isMeasurePresence({ ...active, start: { x: 0 } })).toBe(false);
    expect(isMeasurePresence({ ...active, end: { x: 'a', y: 0 } })).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { feet: _feet, ...missingFeet } = active;
    expect(isMeasurePresence(missingFeet)).toBe(false);
  });

  it('rejects a non-string color and a non-true cleared', () => {
    expect(isMeasurePresence({ ...active, color: 7 })).toBe(false);
    expect(isMeasurePresence({ kind: 'measure', cleared: 1 })).toBe(false);
  });
});

describe('toMeasurePresence', () => {
  it('maps an emission to the wire shape, dropping worldDistance', () => {
    const presence = toMeasurePresence({
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      worldDistance: 2.83,
      cells: 2,
      feet: 10,
      color: '#00AA00',
    });
    expect(presence).toEqual({
      kind: MEASURE_PRESENCE_KIND,
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      cells: 2,
      feet: 10,
      color: '#00AA00',
    });
  });

  it('maps null to the cleared form', () => {
    expect(toMeasurePresence(null)).toEqual({ kind: MEASURE_PRESENCE_KIND, cleared: true });
  });
});
