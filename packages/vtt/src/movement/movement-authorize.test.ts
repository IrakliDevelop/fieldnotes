import { describe, it, expect } from 'vitest';
import type { SyncElement } from '@fieldnotes/sync';
import type { Authorize, AuthorizeContext } from '@fieldnotes/sync-server';
import { withMovementAuthorize } from '../server';

// Mirrors the live-play owner policy: DM edits anything, players create or edit their own.
const ownerPolicy: Authorize = ({ role, userId, op, currentElement }) => {
  if (role === 'dm') return true;
  if (op.kind === 'clear') return false;
  if (op.kind === 'upsert' && currentElement === undefined) return true;
  return currentElement?.ownerId === userId;
};

const token = (id: string, ownerId: string): SyncElement => ({
  id,
  type: 'shape',
  position: { x: 0, y: 0 },
  index: 'a0',
  version: 1,
  locked: false,
  layerId: 'map',
  shape: 'ellipse',
  size: { w: 40, h: 40 },
  strokeColor: '#000',
  strokeWidth: 1,
  fillColor: '#fff',
  ownerId,
});

const record = (id: string, data: Record<string, unknown> = {}, ownerId?: string): SyncElement => ({
  id,
  type: 'extension',
  extensionType: 'vtt:movement',
  position: { x: 0, y: 0 },
  index: '',
  version: 1,
  locked: true,
  layerId: 'map',
  data: {
    targetId: id.slice('vtt-movement:'.length),
    epoch: 'e1',
    feet: 10,
    diagonals: 0,
    visibility: 'all',
    trail: [[{ x: 0, y: 0 }]],
    ...data,
  },
  ...(ownerId === undefined ? {} : { ownerId }),
});

const rooms = new Map<string, Map<string, SyncElement>>([
  [
    'R',
    new Map([
      ['pc1', token('pc1', 'P')],
      ['pc2', token('pc2', 'P')],
      ['npc1', token('npc1', 'DM')],
      ['vtt-movement:pc1', record('vtt-movement:pc1', {}, 'P')],
    ]),
  ],
  ['other', new Map([['ghost', token('ghost', 'P')]])],
]);

const authorize = withMovementAuthorize(ownerPolicy, {
  getElement: async (room, id) => rooms.get(room)?.get(id),
});

const player = { room: 'R', role: 'player', userId: 'P' } as const;
const dm = { room: 'R', role: 'dm', userId: 'DM' } as const;

describe('withMovementAuthorize', () => {
  it.each<[string, AuthorizeContext, boolean]>([
    [
      'player upserts the record of their own token though the DM created it',
      {
        ...player,
        op: { kind: 'upsert', element: record('vtt-movement:pc1') },
        currentElement: record('vtt-movement:pc1', {}, 'DM'),
      },
      true,
    ],
    [
      'player may not create the record of a DM-owned token',
      { ...player, op: { kind: 'upsert', element: record('vtt-movement:npc1') } },
      false,
    ],
    [
      'player may not upsert a record whose id does not match its targetId',
      {
        ...player,
        op: { kind: 'upsert', element: record('vtt-movement:pc1', { targetId: 'pc2' }) },
      },
      false,
    ],
    [
      'a record for a missing target is denied',
      { ...player, op: { kind: 'upsert', element: record('vtt-movement:nobody') } },
      false,
    ],
    [
      'the DM may not create a record for a missing target',
      {
        room: 'R',
        role: 'dm',
        userId: 'DM',
        op: { kind: 'upsert', element: record('vtt-movement:nobody') },
      },
      false,
    ],
    [
      'a target in another room counts as missing',
      {
        room: 'R',
        role: 'dm',
        userId: 'DM',
        op: { kind: 'upsert', element: record('vtt-movement:ghost') },
      },
      false,
    ],
    [
      'a record-prefixed upsert with invalid record data is denied',
      {
        ...player,
        op: { kind: 'upsert', element: record('vtt-movement:pc1', { visibility: 'everyone' }) },
      },
      false,
    ],
    [
      "a player's plain element squatting a record id is denied",
      { ...player, op: { kind: 'upsert', element: { ...token('vtt-movement:npc1', 'P') } } },
      false,
    ],
    [
      'removing an orphan record is allowed',
      {
        ...player,
        op: { kind: 'remove', id: 'vtt-movement:nobody' },
        currentElement: record('vtt-movement:nobody', {}, 'DM'),
      },
      true,
    ],
    [
      'player may not remove the record of a DM-owned token',
      {
        ...player,
        op: { kind: 'remove', id: 'vtt-movement:npc1' },
        currentElement: record('vtt-movement:npc1', {}, 'P'),
      },
      false,
    ],
    [
      'player removes the record of their own token though the DM created it',
      {
        ...player,
        op: { kind: 'remove', id: 'vtt-movement:pc1' },
        currentElement: record('vtt-movement:pc1', {}, 'DM'),
      },
      true,
    ],
    [
      'the DM upserts the record of an NPC token',
      { ...dm, op: { kind: 'upsert', element: record('vtt-movement:npc1') } },
      true,
    ],
    [
      'the DM upserts the record of a PC token',
      { ...dm, op: { kind: 'upsert', element: record('vtt-movement:pc1') } },
      true,
    ],
    [
      'a record of a record is denied even for the DM',
      { ...dm, op: { kind: 'upsert', element: record('vtt-movement:vtt-movement:pc1') } },
      false,
    ],
    [
      'removing a record of a missing record is denied',
      { ...dm, op: { kind: 'remove', id: 'vtt-movement:vtt-movement:nobody' } },
      false,
    ],
  ])('%s', async (_name, ctx, expected) => {
    expect(await authorize(ctx)).toBe(expected);
  });

  it.each<[string, AuthorizeContext, boolean]>([
    [
      'player creates a new plain element',
      { ...player, op: { kind: 'upsert', element: token('x1', 'P') } },
      true,
    ],
    [
      'player edits a DM-owned plain element',
      {
        ...player,
        op: { kind: 'upsert', element: token('npc1', 'P') },
        currentElement: token('npc1', 'DM'),
      },
      false,
    ],
    [
      'player removes their own plain element',
      { ...player, op: { kind: 'remove', id: 'pc1' }, currentElement: token('pc1', 'P') },
      true,
    ],
    [
      'player creates an element whose id only contains the prefix',
      { ...player, op: { kind: 'upsert', element: token('x-vtt-movement:npc1', 'P') } },
      true,
    ],
    ['player clears the room', { ...player, op: { kind: 'clear' } }, false],
    [
      'DM removes anything',
      {
        room: 'R',
        role: 'dm',
        userId: 'DM',
        op: { kind: 'remove', id: 'pc1' },
        currentElement: token('pc1', 'P'),
      },
      true,
    ],
  ])('non-record op passes through unchanged: %s', async (_name, ctx, expected) => {
    expect(await authorize(ctx)).toBe(expected);
  });
});
