import { describe, expect, it } from 'vitest';
import { parseBenchCount } from './bench';

describe('parseBenchCount', () => {
  it.each([
    ['', 0],
    ['bench', 500],
    ['bench=abc', 500],
    ['bench=300', 300],
    ['bench=0', 1],
    ['bench=-5', 1],
    ['bench=999999', 20000],
    ['bench=20000', 20000],
  ])('%j parses to %d', (query, expected) => {
    expect(parseBenchCount(new URLSearchParams(query))).toBe(expected);
  });
});
