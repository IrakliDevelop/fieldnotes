import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashAuthorityJson } from './authority-json';

describe('authority visible hash', () => {
  it('uses canonical key order and excludes no supplied visible field', () => {
    const canonical = '{"a":[true,null],"b":{"x":1,"z":"é"}}';
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(hashAuthorityJson({ b: { z: 'é', x: 1 }, a: [true, null] })).toBe(expected);
    expect(hashAuthorityJson({ a: [true, null], b: { x: 1, z: 'é' } })).toBe(expected);
    expect(hashAuthorityJson({ a: [false, null], b: { x: 1, z: 'é' } })).not.toBe(expected);
  });

  it('rejects accessor and cycles without executing application getters', () => {
    const value = { safe: true } as Record<string, unknown>;
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('executed');
      },
    });
    expect(() => hashAuthorityJson(value)).toThrow('Invalid authority JSON object');
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(() => hashAuthorityJson(cycle)).toThrow();
  });

  it('enforces complete-image bytes, depth, sparse arrays and JSON scalars', () => {
    expect(() => hashAuthorityJson({ data: 'x'.repeat(20 * 1024 * 1024) })).toThrow(RangeError);
    let nested: unknown = null;
    for (let index = 0; index < 65; index++) nested = [nested];
    expect(() => hashAuthorityJson(nested)).toThrow(RangeError);
    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    expect(() => hashAuthorityJson(sparse)).toThrow();
    expect(() => hashAuthorityJson({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => hashAuthorityJson({ malformed: '\ud800' })).toThrow(TypeError);
    expect(() => hashAuthorityJson({ unsupported: undefined })).toThrow(TypeError);
  });

  it('rejects hidden enumerable inventory and non-plain prototypes', () => {
    const symbolKey = { safe: 1 } as Record<string | symbol, unknown>;
    symbolKey[Symbol('secret')] = 2;
    expect(() => hashAuthorityJson(symbolKey)).toThrow();
    const nonPlain = Object.create({ inherited: 1 }) as Record<string, unknown>;
    nonPlain['own'] = 2;
    expect(() => hashAuthorityJson(nonPlain)).toThrow();
    const array = [1] as number[] & { extra?: number };
    array.extra = 2;
    expect(() => hashAuthorityJson(array)).toThrow();
  });
});
