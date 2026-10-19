import { describe, it, expect } from 'vitest';
import { assignLegacyOrder } from './legacy-order';

function order(elements: readonly Record<string, unknown>[]): unknown[] {
  return [...elements]
    .sort((x, y) => (String(x['index']) < String(y['index']) ? -1 : 1))
    .map((e) => e['id']);
}

describe('assignLegacyOrder', () => {
  it('orders unplaced elements by zIndex, then input position', () => {
    const input = [
      { id: 'p0', zIndex: 3 },
      { id: 'p1', zIndex: 1 },
      { id: 'p2', zIndex: 1 },
      { id: 'p3', zIndex: 2 },
    ];
    expect(order(assignLegacyOrder(input))).toEqual(['p1', 'p2', 'p3', 'p0']);
  });

  it('keeps elements in their input positions', () => {
    const input = [
      { id: 'p0', zIndex: 3 },
      { id: 'p1', zIndex: 1 },
    ];
    expect(assignLegacyOrder(input).map((e) => e['id'])).toEqual(['p0', 'p1']);
  });

  it('treats a missing or non-finite zIndex as 0', () => {
    const input = [
      { id: 'p0', zIndex: 1 },
      { id: 'p1' },
      { id: 'p2', zIndex: Number.NaN },
      { id: 'p3', zIndex: -1 },
    ];
    expect(order(assignLegacyOrder(input))).toEqual(['p3', 'p1', 'p2', 'p0']);
  });

  it('keeps existing keys and places new keys after the max existing key', () => {
    const placed = { id: 'k', index: 'a5', version: 4 };
    const input = [{ id: 'n0', zIndex: 0 }, placed, { id: 'm', index: 'a2', version: 2 }];
    const out = assignLegacyOrder(input);
    expect(out[1]).toBe(placed);
    expect(out[2]).toEqual({ id: 'm', index: 'a2', version: 2 });
    expect(String(out[0]?.['index']) > 'a5').toBe(true);
  });

  it.each(['', 'a00', '!x'])('reassigns an invalid index %j and ignores it as the max', (bad) => {
    const input = [
      { id: 'bad', index: bad, zIndex: 1 },
      { id: 'new', zIndex: 0 },
      { id: 'ok', index: 'a5', version: 1 },
    ];
    const out = assignLegacyOrder(input);
    expect(order(out)).toEqual(['ok', 'new', 'bad']);
    expect(String(out[1]?.['index']) > 'a5').toBe(true);
  });

  it.each([
    [undefined, 1],
    [0, 1],
    [1.5, 1],
    ['3', 1],
    [7, 7],
  ])('sets version %s to %s', (version, expected) => {
    const [out] = assignLegacyOrder([{ id: 'e', zIndex: 0, version }]);
    expect(out?.['version']).toBe(expected);
  });

  it('removes the zIndex key', () => {
    const [out] = assignLegacyOrder([{ id: 'e', zIndex: 2 }]);
    expect(out !== undefined && 'zIndex' in out).toBe(false);
  });

  it('does not mutate the input array or its elements', () => {
    const input = [
      { id: 'p0', zIndex: 3 },
      { id: 'p1', zIndex: 1 },
    ];
    const snapshot = structuredClone(input);
    assignLegacyOrder(input);
    expect(input).toEqual(snapshot);
  });
});
