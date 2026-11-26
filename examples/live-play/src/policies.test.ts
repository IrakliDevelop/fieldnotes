import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import type { CanvasElement } from '@fieldnotes/core';
import { MEASURE_PRESENCE_KIND, MOVEMENT_PRESENCE_KIND, PATH_PRESENCE_KIND } from '@fieldnotes/vtt';
import { AWARENESS_PRESENCE_KIND } from '@fieldnotes/core';
import type { SyncElement } from '@fieldnotes/sync';
import {
  authenticate,
  authorize,
  authorizeLayer,
  canRead,
  canReadLayer,
  makeResolveAudience,
  resolveAudience,
  resolvePresenceAudience,
  allowImageSrc,
  DM_AUDIENCE,
  DM_SECRET_LAYER_ID,
} from './policies';

const req = (query: string) => ({ url: `/${query}` }) as unknown as IncomingMessage;
const el = (over: Record<string, unknown> = {}) =>
  ({
    id: 'e1',
    type: 'shape',
    layerId: 'L',
    ...over,
  }) as unknown as CanvasElement;

describe('authenticate (D1)', () => {
  it.each([
    ['no token', undefined],
    ['an unknown token', 'nope'],
    ['an Object.prototype key', 'constructor'],
  ])('rejects %s with null', (_, token) => {
    expect(authenticate({ req: req('?name=DM&role=dm'), room: 'R', token })).toBeNull();
  });
  it.each([
    ['demo-dm-token', { userId: 'DM', role: 'dm' }],
    ['demo-player-1-token', { userId: 'Player 1', role: 'player' }],
    ['demo-player-2-token', { userId: 'Player 2', role: 'player' }],
  ])('maps %s to its table identity', (token, expected) => {
    expect(authenticate({ req: req(''), room: 'R', token })).toEqual(expected);
  });
  it('ignores ?role=dm and ?name= on a player token', () => {
    expect(
      authenticate({ req: req('?name=DM&role=dm'), room: 'R', token: 'demo-player-1-token' }),
    ).toEqual({ userId: 'Player 1', role: 'player' });
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
  const movementRecord = (visibility: string, layerId: string) =>
    el({
      id: 'vtt-movement:tok',
      type: 'extension',
      extensionType: 'vtt:movement',
      layerId,
      data: { targetId: 'tok', epoch: 'e1', feet: 5, diagonals: 0, visibility, trail: [] },
    });
  it("tags a movement record 'dm' when its visibility is 'dm', even on the shared layer", () => {
    expect(makeResolveAudience('secretL')(movementRecord('dm', 'mapL'))).toBe('dm');
    expect(makeResolveAudience(null)(movementRecord('dm', 'mapL'))).toBe('dm');
  });
  it("leaves an 'all' movement record shared unless it sits on the secret layer", () => {
    expect(makeResolveAudience('secretL')(movementRecord('all', 'mapL'))).toBeUndefined();
    expect(makeResolveAudience('secretL')(movementRecord('all', 'secretL'))).toBe('dm');
  });
  it('null secret layer → everything shared', () => {
    expect(makeResolveAudience(null)(el({ layerId: 'secretL' }))).toBeUndefined();
  });
});

const movement = (visibility: string, layerId = 'mapL', audience?: string) =>
  ({
    id: 'vtt-movement:tok',
    type: 'extension',
    extensionType: 'vtt:movement',
    layerId,
    audience,
    data: { targetId: 'tok', epoch: 'e1', feet: 5, diagonals: 0, visibility, trail: [] },
  }) as unknown as SyncElement;
const syncEl = (over: Record<string, unknown> = {}) => el(over) as SyncElement;

describe('resolveAudience (server)', () => {
  const base = { room: 'R' };
  it.each(['dm', 'player'])("tags any %s element on the secret layer 'dm'", (role) => {
    expect(
      resolveAudience({ ...base, role, element: syncEl({ layerId: DM_SECRET_LAYER_ID }) }),
    ).toBe('dm');
  });
  it("tags a DM-only movement record 'dm' on the shared layer", () => {
    expect(resolveAudience({ ...base, role: 'dm', element: movement('dm') })).toBe('dm');
  });
  it("ignores a player's own 'dm' tag on a new element off the secret layer", () => {
    expect(
      resolveAudience({ ...base, role: 'player', element: syncEl({ audience: 'dm' }) }),
    ).toBeUndefined();
  });
  it('clears dm when the DM reveals an element off the secret layer', () => {
    expect(
      resolveAudience({
        ...base,
        role: 'dm',
        element: syncEl({ layerId: 'mapL' }),
        currentElement: syncEl({ layerId: DM_SECRET_LAYER_ID, audience: 'dm' }),
      }),
    ).toBeUndefined();
  });
  it("clears dm when the DM switches a movement record's visibility to all", () => {
    expect(
      resolveAudience({
        ...base,
        role: 'dm',
        element: movement('all'),
        currentElement: movement('dm', 'mapL', 'dm'),
      }),
    ).toBeUndefined();
  });
  it('keeps a dm audience when a player moves its hidden element off the secret layer', () => {
    expect(
      resolveAudience({
        ...base,
        role: 'player',
        element: syncEl({ layerId: 'mapL', audience: undefined }),
        currentElement: syncEl({ layerId: DM_SECRET_LAYER_ID, audience: 'dm' }),
      }),
    ).toBe('dm');
  });
  it('keeps a shared audience on a player edit tagged dm', () => {
    expect(
      resolveAudience({
        ...base,
        role: 'player',
        element: syncEl({ audience: 'dm' }),
        currentElement: syncEl(),
      }),
    ).toBeUndefined();
  });
});

const layer = (id: string) => ({
  id,
  name: id,
  visible: true,
  locked: false,
  order: 0,
  opacity: 1,
});

describe('canReadLayer', () => {
  it.each([
    ['player', DM_SECRET_LAYER_ID, false],
    ['player', 'mapL', true],
    ['dm', DM_SECRET_LAYER_ID, true],
    ['dm', 'mapL', true],
  ])('%s reading %s -> %s', (role, id, expected) => {
    expect(canReadLayer({ userId: 'u', role, room: 'R', layer: layer(id) })).toBe(expected);
  });
});

describe('authorizeLayer', () => {
  const upsert = (id: string) =>
    ({ kind: 'layer-upsert', layer: layer(id), version: 1, editor: 'u' }) as const;
  const remove = (id: string) => ({ kind: 'layer-remove', id, version: 1, editor: 'u' }) as const;
  it.each([
    ['player', upsert(DM_SECRET_LAYER_ID), false],
    ['player', remove(DM_SECRET_LAYER_ID), false],
    ['player', upsert('mapL'), true],
    ['player', remove('mapL'), true],
    ['dm', upsert(DM_SECRET_LAYER_ID), true],
    ['dm', remove(DM_SECRET_LAYER_ID), true],
  ])('%s %o -> %s', (role, op, expected) => {
    expect(authorizeLayer({ userId: 'u', role, room: 'R', op })).toBe(expected);
  });
});

describe('resolvePresenceAudience', () => {
  const lanes = [
    AWARENESS_PRESENCE_KIND,
    MEASURE_PRESENCE_KIND,
    PATH_PRESENCE_KIND,
    MOVEMENT_PRESENCE_KIND,
  ];
  it.each(lanes)('sends every player %s frame to everyone', (lane) => {
    expect(
      resolvePresenceAudience({ userId: 'P', role: 'player', room: 'R', lane, data: {} }),
    ).toBeUndefined();
  });
  it("sends the DM's awareness frame to everyone", () => {
    expect(
      resolvePresenceAudience({
        userId: 'DM',
        role: 'dm',
        room: 'R',
        lane: AWARENESS_PRESENCE_KIND,
        data: {},
      }),
    ).toBeUndefined();
  });
  it.each([MEASURE_PRESENCE_KIND, PATH_PRESENCE_KIND, MOVEMENT_PRESENCE_KIND])(
    "keeps the DM's %s frame for the DM",
    (lane) => {
      expect(resolvePresenceAudience({ userId: 'DM', role: 'dm', room: 'R', lane, data: {} })).toBe(
        'dm',
      );
    },
  );
});

describe('allowImageSrc', () => {
  it.each([
    ['data:image/png;base64,AAAA', true],
    ['https://example.com/a.png', false],
    ['data:text/html,x', false],
  ])('%s -> %s', (src, expected) => {
    expect(allowImageSrc({ src, userId: 'u', role: 'player', room: 'R' })).toBe(expected);
  });
});
