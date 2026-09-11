import { describe, expect, it } from 'vitest';
import { hasJsonDepthAtMost, MessageRateLimiter } from './resource-limits';

describe('hasJsonDepthAtMost', () => {
  it('counts object and array nesting but ignores braces inside strings', () => {
    expect(hasJsonDepthAtMost('{"value":"[[{{"}', 1)).toBe(true);
    expect(hasJsonDepthAtMost('{"value":[{"deep":true}]}', 2)).toBe(false);
    expect(hasJsonDepthAtMost('{"value":[{"deep":true}]}', 3)).toBe(true);
  });

  it('rejects structurally incomplete input before JSON parsing', () => {
    expect(hasJsonDepthAtMost('{"value":1', 10)).toBe(false);
    expect(hasJsonDepthAtMost('{"value":"unterminated}', 10)).toBe(false);
  });
});

describe('MessageRateLimiter', () => {
  it('allows a burst and refills at the configured rate', () => {
    const limiter = new MessageRateLimiter(2, 2, 1_000);
    expect(limiter.take(1_000)).toBe(true);
    expect(limiter.take(1_000)).toBe(true);
    expect(limiter.take(1_000)).toBe(false);
    expect(limiter.take(1_499)).toBe(false);
    expect(limiter.take(1_500)).toBe(true);
  });
});

describe('MessageRateLimiter with weighted costs', () => {
  it('charges the given cost against the bucket', () => {
    const limiter = new MessageRateLimiter(100, 200, 1_000);
    expect(limiter.take(1_000, 150)).toBe(true);
    expect(limiter.take(1_000, 150)).toBe(false);
    expect(limiter.take(2_000, 150)).toBe(true); // +100 refilled → 150 available
  });

  it('never admits a single cost above the burst', () => {
    const limiter = new MessageRateLimiter(100, 200, 1_000);
    expect(limiter.take(1_000, 201)).toBe(false);
    expect(limiter.take(1_000, 200)).toBe(true);
  });
});
