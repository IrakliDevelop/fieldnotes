import { describe, it, expect, beforeEach } from 'vitest';
import type { SyncElement, SyncOp } from '@fieldnotes/sync';
import { MemoryHubBackend, SyncHub } from '@fieldnotes/sync-server';
import type { Authorize, CanRead, Connection, ResolveAudience } from '@fieldnotes/sync-server';
import { getMovementVisibility, withMovementAuthorize } from '../server';

interface FakeConn extends Connection {
  sent: string[];
}

const conn = (id: string, userId: string, role: string): FakeConn => {
  const sent: string[] = [];
  return { id, room: 'R', userId, role, sent, send: (m) => sent.push(m) };
};

const envelope = (from: string, op: SyncOp): string => JSON.stringify({ from, op });

const ownerPolicy: Authorize = ({ role, userId, op, currentElement }) => {
  if (role === 'dm') return true;
  if (op.kind === 'clear') return false;
  if (op.kind === 'upsert' && currentElement === undefined) return true;
  return currentElement?.ownerId === userId;
};
const canRead: CanRead = ({ role, audience }) => audience !== 'dm' || role === 'dm';
const resolveAudience: ResolveAudience = ({ element }) =>
  getMovementVisibility(element) === 'dm' ? 'dm' : element.audience;

const token = (id: string): SyncElement => ({
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
});

const record = (
  targetId: string,
  version: number,
  data: { epoch: string; feet: number; visibility: 'all' | 'dm' },
): SyncElement => ({
  id: `vtt-movement:${targetId}`,
  type: 'extension',
  extensionType: 'vtt:movement',
  position: { x: 0, y: 0 },
  index: 'a1',
  version,
  locked: true,
  layerId: 'map',
  data: { targetId, diagonals: 0, trail: [[{ x: 0, y: 0 }]], ...data },
});

describe('withMovementAuthorize in a SyncHub', () => {
  let backend: MemoryHubBackend;
  let hub: SyncHub;
  let dm: FakeConn;
  let player: FakeConn;

  const stored = async (id: string): Promise<SyncElement | undefined> => {
    const r = await backend.getRecord('R', id);
    return r?.kind === 'element' ? r.element : undefined;
  };

  beforeEach(() => {
    backend = new MemoryHubBackend();
    hub = new SyncHub({
      backend,
      canRead,
      resolveAudience,
      authorize: withMovementAuthorize(ownerPolicy, { getElement: (_room, id) => stored(id) }),
    });
    dm = conn('dm', 'DM', 'dm');
    player = conn('pl', 'P', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
  });

  it('a player receives a DM-only record neither live nor in a snapshot', async () => {
    await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: token('npc1') }));
    await hub.handleMessage(
      'dm',
      envelope('cdm', {
        kind: 'upsert',
        element: record('npc1', 1, { epoch: 'secret-epoch', feet: 10, visibility: 'dm' }),
      }),
    );
    expect((await stored('vtt-movement:npc1'))?.audience).toBe('dm');

    const late = conn('late', 'P', 'player');
    hub.addConnection(late);
    await hub.handleMessage('late', envelope('clate', { kind: 'request-snapshot' }));

    for (const frames of [player.sent, late.sent]) {
      expect(frames.join('\n')).toContain('"id":"npc1"');
      expect(frames.join('\n')).not.toContain('vtt-movement:npc1');
      expect(frames.join('\n')).not.toContain('secret-epoch');
    }
  });

  it('a player writes the record of their own token after the DM created it', async () => {
    await hub.handleMessage('pl', envelope('cpl', { kind: 'upsert', element: token('pc1') }));
    await hub.handleMessage(
      'dm',
      envelope('cdm', {
        kind: 'upsert',
        element: record('pc1', 1, { epoch: 'e1', feet: 0, visibility: 'all' }),
      }),
    );
    await hub.handleMessage(
      'pl',
      envelope('cpl', {
        kind: 'upsert',
        element: record('pc1', 2, { epoch: 'e1', feet: 30, visibility: 'all' }),
      }),
    );

    const saved = await stored('vtt-movement:pc1');
    expect(saved?.version).toBe(2);
    expect(saved?.type === 'extension' && saved.data['feet']).toBe(30);
    expect(saved?.ownerId).toBe('DM');
  });

  it("a player's upsert of an NPC's record is rejected and leaves the stored record unchanged", async () => {
    await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: token('npc1') }));
    const original = record('npc1', 1, { epoch: 'secret-epoch', feet: 10, visibility: 'dm' });
    await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: original }));
    const before = await stored('vtt-movement:npc1');

    await hub.handleMessage(
      'pl',
      envelope('cpl', {
        kind: 'upsert',
        element: record('npc1', 2, { epoch: 'forged', feet: 0, visibility: 'all' }),
      }),
    );

    expect(await stored('vtt-movement:npc1')).toEqual(before);
    expect(before?.version).toBe(1);
    expect(dm.sent.join('\n')).not.toContain('forged');
    expect(player.sent.join('\n')).not.toContain('secret-epoch');
  });
});
