import { describe, expect, it, vi } from 'vitest';
import { createAuthorityOperationId } from './index';

describe('createAuthorityOperationId', () => {
  it('uses the supplied millisecond timestamp and 128 secure random bits', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (array instanceof Uint8Array) array.fill(0xab);
      return array;
    });
    try {
      expect(createAuthorityOperationId(1_700_000_000_000)).toBe(
        'fn1:1700000000000:abababababababababababababababab',
      );
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).toHaveLength(16);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses the current time and rejects timestamps outside the exact profile', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_001);
    try {
      expect(createAuthorityOperationId()).toMatch(/^fn1:1700000000001:[0-9a-f]{32}$/);
    } finally {
      clock.mockRestore();
    }
    for (const invalid of [NaN, Infinity, 0, 1.5, 999_999_999_999, 10_000_000_000_000]) {
      expect(() => createAuthorityOperationId(invalid)).toThrow(RangeError);
    }
  });

  it('fails closed if secure random generation is unavailable', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('secure RNG unavailable');
    });
    try {
      expect(() => createAuthorityOperationId(1_700_000_000_000)).toThrow('secure RNG unavailable');
    } finally {
      spy.mockRestore();
    }
  });
});
