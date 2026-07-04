import { describe, it, expect } from 'vitest';
import { authenticate, authorize, canRead, makeResolveAudience, DM_AUDIENCE } from './policies';

const req = (query: string) => ({ url: `/${query}` }) as unknown as import('http').IncomingMessage;
const el = (over: Record<string, unknown> = {}) =>
  ({
    id: 'e1',
    type: 'shape',
    layerId: 'L',
    ...over,
  }) as unknown as import('@fieldnotes/core').CanvasElement;

describe('authenticate (D1)', () => {
  it('maps ?name=&role= to { userId, role } and defaults role to player', () => {
    expect(authenticate({ req: req('?name=Ann&role=dm'), room: 'R' })).toEqual({
      userId: 'Ann',
      role: 'dm',
    });
    expect(authenticate({ req: req('?name=Bob'), room: 'R' })).toEqual({
      userId: 'Bob',
      role: 'player',
    });
  });
  it('rejects a nameless join with null', () => {
    expect(authenticate({ req: req('?role=dm'), room: 'R' })).toBeNull();
  });
});

describe('authorize (D2)', () => {
  const base = { room: 'R' as const };
  it('lets the DM edit anything', () => {
    expect(
      authorize({
        ...base,
        role: 'dm',
        userId: 'DM',
        op: { kind: 'remove', id: 'x' },
        currentElement: el({ ownerId: 'P' }),
      }),
    ).toBe(true);
  });
  it('lets a player create a new element (no current)', () => {
    expect(
      authorize({
        ...base,
        role: 'player',
        userId: 'P',
        op: { kind: 'upsert', element: el() },
        currentElement: undefined,
      }),
    ).toBe(true);
  });
  it('lets a player edit only their OWN element', () => {
    expect(
      authorize({
        ...base,
        role: 'player',
        userId: 'P',
        op: { kind: 'upsert', element: el() },
        currentElement: el({ ownerId: 'P' }),
      }),
    ).toBe(true);
    expect(
      authorize({
        ...base,
        role: 'player',
        userId: 'P',
        op: { kind: 'upsert', element: el() },
        currentElement: el({ ownerId: 'Q' }),
      }),
    ).toBe(false);
  });
  it('denies a player clear', () => {
    expect(
      authorize({
        ...base,
        role: 'player',
        userId: 'P',
        op: { kind: 'clear' },
        currentElement: undefined,
      }),
    ).toBe(false);
  });
});

describe('canRead (D3)', () => {
  it('hides dm-audience from players, shows to dm, shows shared to all', () => {
    expect(canRead({ room: 'R', role: 'player', audience: DM_AUDIENCE })).toBe(false);
    expect(canRead({ room: 'R', role: 'dm', audience: DM_AUDIENCE })).toBe(true);
    expect(canRead({ room: 'R', role: 'player', audience: undefined })).toBe(true);
  });
});

describe('makeResolveAudience', () => {
  it("tags elements on the secret layer 'dm', others undefined", () => {
    const resolve = makeResolveAudience('secretL');
    expect(resolve(el({ layerId: 'secretL' }))).toBe('dm');
    expect(resolve(el({ layerId: 'mapL' }))).toBeUndefined();
  });
  it('null secret layer → everything shared', () => {
    expect(makeResolveAudience(null)(el({ layerId: 'secretL' }))).toBeUndefined();
  });
});
