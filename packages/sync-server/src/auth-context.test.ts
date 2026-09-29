import { describe, expect, expectTypeOf, it } from 'vitest';
import { snapshotAuthContext, validateExpiresAt } from './auth-context';
import type {
  AuthContext,
  AuthContextValue,
  AuthResult,
  Connection,
  ServerOpContext,
} from './index';

describe('public authentication types', () => {
  it('exports server-only claims and expiry on the intended contracts', () => {
    expectTypeOf<AuthContextValue>().toExtend<null | boolean | number | string | object>();
    expectTypeOf<AuthResult['authContext']>().toEqualTypeOf<AuthContext | undefined>();
    expectTypeOf<Connection['authContext']>().toEqualTypeOf<AuthContext | undefined>();
    expectTypeOf<ServerOpContext['authContext']>().toEqualTypeOf<AuthContext | undefined>();
    expectTypeOf<AuthResult['expiresAt']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Connection['expiresAt']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ServerOpContext['expiresAt']>().toEqualTypeOf<number | undefined>();
  });
});

describe('authentication context snapshot', () => {
  it('copies and freezes nested JSON without freezing the caller', () => {
    const original = { __proto__: null, nested: { values: [1, 'private'] } };
    const copy = snapshotAuthContext(original);
    original.nested.values[1] = 'changed';
    expect(copy).toEqual({ nested: { values: [1, 'private'] } });
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy?.nested)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
  });

  it('rejects cycles, accessors, unsupported values and data beyond the budgets', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterCalls++;
        return 'secret';
      },
    });
    const toJSON = {
      toJSON() {
        throw new Error('invoked');
      },
    };
    for (const value of [
      cyclic,
      accessor,
      toJSON,
      { value: undefined },
      { value: NaN },
      { value: Symbol('x') },
      { value: new Date() },
      { value: 'a'.repeat(16 * 1024) },
      { value: Array.from({ length: 1025 }, () => 0) },
    ]) {
      expect(() => snapshotAuthContext(value)).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
    let deep: object = {};
    for (let index = 0; index < 16; index++) deep = { child: deep };
    expect(() => snapshotAuthContext(deep)).toThrow(TypeError);
  });

  it('preserves special keys without prototype mutation', () => {
    const input = JSON.parse('{"__proto__":{"admin":true},"constructor":"ordinary"}') as object;
    const copy = snapshotAuthContext(input);
    expect(Object.getPrototypeOf(copy)).toBe(null);
    expect(copy?.['__proto__']).toEqual({ admin: true });
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it('accepts the exact 16 KiB encoded boundary and rejects one byte more', () => {
    const accepted = { value: 'x'.repeat(16 * 1024 - Buffer.byteLength('{"value":""}')) };
    expect(Buffer.byteLength(JSON.stringify(accepted))).toBe(16 * 1024);
    expect(snapshotAuthContext(accepted)).toEqual(accepted);
    expect(() => snapshotAuthContext({ value: accepted.value + 'x' })).toThrow(TypeError);
    const manyTrue = { values: [...Array.from({ length: 1000 }, () => true), 'x'.repeat(11000)] };
    expect(Buffer.byteLength(JSON.stringify(manyTrue))).toBeLessThan(16 * 1024);
    expect(snapshotAuthContext(manyTrue)).toEqual(manyTrue);
  });
});

describe('authentication expiration', () => {
  it('requires a positive safe integer Unix timestamp', () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(() => validateExpiresAt(value)).toThrow(TypeError);
    }
    expect(validateExpiresAt(undefined)).toBeUndefined();
    expect(validateExpiresAt(1)).toBe(1);
  });
});
