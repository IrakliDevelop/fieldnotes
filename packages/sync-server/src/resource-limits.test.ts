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
