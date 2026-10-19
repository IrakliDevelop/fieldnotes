import { describe, it, expect } from 'vitest';
import { hasJsonDepthAtMost } from './limits';

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
