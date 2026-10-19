import { describe, it, expect } from 'vitest';
import { generateKeyBetween, generateNKeysBetween, isValidIndexKey } from './fractional-index';

function expectStrictlyIncreasing(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1] ?? '';
    const next = keys[i] ?? '';
    expect(prev < next, `${prev} < ${next}`).toBe(true);
  }
}

describe('generateKeyBetween', () => {
  it('returns a0 for an empty range', () => {
    expect(generateKeyBetween(null, null)).toBe('a0');
  });

  it('returns a key before a0, after a0, and strictly between a0 and a1', () => {
    const before = generateKeyBetween(null, 'a0');
    const after = generateKeyBetween('a0', null);
    const mid = generateKeyBetween('a0', 'a1');
    expect(before < 'a0').toBe(true);
    expect(after > 'a0').toBe(true);
    expect('a0' < mid && mid < 'a1').toBe(true);
    for (const key of [before, after, mid]) expect(isValidIndexKey(key)).toBe(true);
  });

  it('keeps 1,000 successive appends valid and strictly ordered', () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 1000; i++) {
      last = generateKeyBetween(last, null);
      keys.push(last);
    }
    expectStrictlyIncreasing(keys);
    expect(keys.every(isValidIndexKey)).toBe(true);
  });

  it('keeps 1,000 successive prepends valid and strictly ordered', () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 1000; i++) {
      first = generateKeyBetween(null, first);
      keys.unshift(first);
    }
    expectStrictlyIncreasing(keys);
    expect(keys.every(isValidIndexKey)).toBe(true);
  });

  it('keeps 200 bisections toward the same neighbour valid, ordered and at most 128 chars', () => {
    const upper = 'a1';
    const keys = ['a0'];
    let lower = 'a0';
    for (let i = 0; i < 200; i++) {
      lower = generateKeyBetween(lower, upper);
      keys.push(lower);
    }
    keys.push(upper);
    expectStrictlyIncreasing(keys);
    expect(keys.every(isValidIndexKey)).toBe(true);
    expect(keys.every((k) => k.length <= 128)).toBe(true);
  });

  it('throws RangeError when a is not below b', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow(RangeError);
    expect(() => generateKeyBetween('a0', 'a0')).toThrow(RangeError);
  });

  it('throws RangeError for an invalid key', () => {
    expect(() => generateKeyBetween('a00', null)).toThrow(RangeError);
  });

  it('throws RangeError when the result would exceed 128 characters', () => {
    const prefix = 'a0' + '0'.repeat(125);
    expect(() => generateKeyBetween(prefix + '1', prefix + '2')).toThrow(RangeError);
  });
});

describe('generateNKeysBetween', () => {
  it('returns 5 strictly increasing keys for an empty range', () => {
    const keys = generateNKeysBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expectStrictlyIncreasing(keys);
  });

  it('returns keys strictly between both bounds', () => {
    const keys = generateNKeysBetween('a0', 'a1', 3);
    expect(keys).toHaveLength(3);
    expectStrictlyIncreasing(['a0', ...keys, 'a1']);
    expect(keys.every(isValidIndexKey)).toBe(true);
  });

  it.each([
    [null, 'a0'],
    ['a0', null],
  ])('returns ordered keys against a single bound (%s, %s)', (a, b) => {
    const keys = generateNKeysBetween(a, b, 4);
    expect(keys).toHaveLength(4);
    expectStrictlyIncreasing([...(a === null ? [] : [a]), ...keys, ...(b === null ? [] : [b])]);
  });

  it('returns an empty array for n = 0', () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
  });
});

describe('isValidIndexKey', () => {
  it.each([
    ['a0', true],
    ['Zz', true],
    ['b00V', true],
    ['', false],
    ['a', false],
    ['a00', false],
    ['!x', false],
    ['b1', false],
    ['a0' + 'V'.repeat(127), false],
    ['A' + '0'.repeat(26), false],
  ])('%s → %s', (key, valid) => {
    expect(isValidIndexKey(key)).toBe(valid);
  });
});
