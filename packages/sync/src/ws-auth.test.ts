import { describe, expect, it } from 'vitest';
import {
  BEARER_SUBPROTOCOL_PREFIX,
  SYNC_WS_SUBPROTOCOL,
  bearerSubprotocols,
  readBearerSubprotocol,
} from './ws-auth';

describe('bearerSubprotocols', () => {
  it('offers the sync subprotocol plus a bearer entry carrying the token', () => {
    expect(bearerSubprotocols('abc.DEF-ghi_jkl')).toEqual([
      SYNC_WS_SUBPROTOCOL,
      `${BEARER_SUBPROTOCOL_PREFIX}abc.DEF-ghi_jkl`,
    ]);
  });

  it.each([['a=b'], ['a b'], ['a/b'], ['a,b'], [''], ['é']])(
    'rejects token %j: not a valid Sec-WebSocket-Protocol token',
    (token) => {
      expect(() => bearerSubprotocols(token)).toThrow(/token/);
    },
  );
});

describe('readBearerSubprotocol', () => {
  it('extracts the token from a comma-separated Sec-WebSocket-Protocol header', () => {
    expect(readBearerSubprotocol('fieldnotes-sync, fieldnotes-bearer.t0k.en')).toBe('t0k.en');
    expect(readBearerSubprotocol('fieldnotes-bearer.x,fieldnotes-sync')).toBe('x');
  });

  it('returns undefined without a bearer entry or with an empty token', () => {
    expect(readBearerSubprotocol(undefined)).toBeUndefined();
    expect(readBearerSubprotocol('fieldnotes-sync')).toBeUndefined();
    expect(readBearerSubprotocol('fieldnotes-bearer.')).toBeUndefined();
    expect(readBearerSubprotocol('')).toBeUndefined();
  });
});
