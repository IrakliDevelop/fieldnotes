import { afterEach, describe, expect, it } from 'vitest';
import { createImage } from '@fieldnotes/core';
import { createCurrentCapabilities, type SyncElement, type SyncOp } from '@fieldnotes/sync';
import { fogEncodeBase64 } from '@fieldnotes/vtt';
import { createFogServerPlugin, type FogServerPluginOptions } from '@fieldnotes/vtt/server';
import { SyncHub, type Connection } from './sync-hub';
import { v2Shape } from './test-support/v2-ops';

interface FakeConn extends Connection {
  sent: string[];
}

function makeConn(id: string, role: string): FakeConn {
  const sent: string[] = [];
  return { id, room: 'R', userId: `u-${id}`, role, sent, send: (m) => sent.push(m) };
}

function envelope(from: string, op: SyncOp): string {
  return JSON.stringify({ from, op });
}

function seen(conn: FakeConn): string[] {
  return conn.sent.map((message) => {
    const { from, op } = JSON.parse(message) as { from: string; op: SyncOp };
    switch (op.kind) {
      case 'upsert':
        return `${from}: upsert ${op.element.id}`;
      case 'remove':
        return `${from}: remove ${op.id}`;
      case 'snapshot':
        return `${from}: snapshot ${op.elements.map((element) => element.id).join(',')}`;
      default:
        return `${from}: ${op.kind}`;
    }
  });
}

const definition = {
  version: 1 as const,
  generation: 'g1',
  bounds: { x: 0, y: 0, w: 2000, h: 2000 },
  cellSize: 10,
  tileCells: 128 as const,
  base: 'covered' as const,
};

/** Tile (0, 0) with cells 0..`lastCol` x 0..`lastRow` revealed; without them, all covered. */
function tile(version: number, lastCol?: number, lastRow = lastCol): SyncOp {
  const record = { generation: 'g1', x: 0, y: 0, version, editor: 'gm' };
  if (lastCol === undefined || lastRow === undefined) {
    // An all-covered tile equals the base, which travels as a record without data.
    return { kind: 'fog-patch', generation: 'g1', tiles: [record] };
  }
  const bytes = new Uint8Array(2048);
  for (let row = 0; row <= lastRow; row++) {
    for (let col = 0; col <= lastCol; col++) {
      const index = row * 128 + col;
      bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (0x80 >> (index & 7));
    }
  }
  return {
    kind: 'fog-patch',
    generation: 'g1',
    tiles: [{ ...record, data: fogEncodeBase64(bytes) }],
  };
}

const ownerOrGm: FogServerPluginOptions['seesUnderFog'] = (viewer, element) =>
  viewer.role === 'gm' || element.ownerId === viewer.userId;

function shape(id: string, x: number, y: number, version = 1, w = 40): SyncElement {
  return { ...v2Shape({ position: { x, y }, size: { w, h: 40 } }), id, version };
}

/** A token in the open corner, at world (10, 10). */
const OPEN = { x: 10, y: 10 };
/** A position deep under fog. */
const FOGGED = { x: 500, y: 500 };

const hubs: SyncHub[] = [];

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});

/** gm writer, gm2 observer, two players; fog defined base covered with world 0..100 on both axes revealed. */
async function fogRoom(seesUnderFog = ownerOrGm, seed: readonly SyncElement[] = []) {
  const hub = new SyncHub({
    plugins: [createFogServerPlugin({ authorize: ({ role }) => role === 'gm', seesUnderFog })],
    authorize: () => true,
    resolvePresenceAudience: () => undefined,
  });
  hubs.push(hub);
  const conns = ['gm', 'gm2', 'p1', 'p2'].map((id) =>
    makeConn(id, id.startsWith('gm') ? 'gm' : 'player'),
  );
  for (const conn of conns) {
    hub.addConnection(conn);
    await hub.handleMessage(
      conn.id,
      envelope(conn.id, {
        kind: 'capabilities',
        capabilities: createCurrentCapabilities([]),
      }),
    );
  }
  const [gm, gm2, p1, p2] = conns as [FakeConn, FakeConn, FakeConn, FakeConn];
  const write = (conn: FakeConn, op: SyncOp) => hub.handleMessage(conn.id, envelope(conn.id, op));
  await write(gm, { kind: 'fog-meta', record: { version: 2, editor: 'gm', definition } });
  await write(gm, tile(1, 9));
  for (const element of seed) await write(gm, { kind: 'upsert', element });
  // A queued snapshot request runs after any reconcile scheduled before it.
  const flush = async () => {
    await write(gm, { kind: 'request-snapshot' });
    gm.sent.pop();
  };
  await flush();
  for (const conn of conns) conn.sent.length = 0;
  return { hub, gm, gm2, p1, p2, write, flush };
}

describe('fog element gate', () => {
  it('leaves a token under fog out of the player snapshot only', async () => {
    const { gm, p1, write } = await fogRoom(ownerOrGm, [
      shape('t', FOGGED.x, FOGGED.y),
      shape('o', OPEN.x, OPEN.y),
    ]);

    await write(gm, { kind: 'request-snapshot' });
    await write(p1, { kind: 'request-snapshot' });

    expect(seen(gm)).toEqual(['hub: snapshot t,o']);
    expect(seen(p1)).toEqual(['hub: snapshot o']);
  });

  it('relays a live add under fog to the gm only', async () => {
    const { gm, gm2, p1, write } = await fogRoom();

    await write(gm, { kind: 'upsert', element: shape('t', FOGGED.x, FOGGED.y) });

    expect(seen(gm2)).toEqual(['gm: upsert t']);
    expect(seen(p1)).toEqual([]);
  });

  it('removes a token moved under fog and resends it when it comes back', async () => {
    const { gm, p1, write } = await fogRoom(ownerOrGm, [shape('t', OPEN.x, OPEN.y)]);

    await write(gm, { kind: 'upsert', element: shape('t', FOGGED.x, FOGGED.y, 2) });
    await write(gm, { kind: 'upsert', element: shape('t', OPEN.x, OPEN.y, 3) });

    expect(seen(p1)).toEqual(['hub: remove t', 'gm: upsert t']);
  });

  it('sends a revealed token once from hub, and removes it when covered again', async () => {
    const { gm, p1, p2, write, flush } = await fogRoom(ownerOrGm, [shape('t', 200, 20)]);

    await write(gm, tile(2, 29, 9));
    await flush();

    expect(seen(p1)).toEqual(['gm: fog-patch', 'hub: upsert t']);
    expect(seen(p2)).toEqual(['gm: fog-patch', 'hub: upsert t']);

    p1.sent.length = 0;
    await write(gm, tile(3));
    await flush();

    expect(seen(p1)).toEqual(['gm: fog-patch', 'hub: remove t']);
    expect(seen(gm)).toEqual([]);
  });

  it('sends a large image partly under fog and an element outside the fog bounds', async () => {
    const { gm, p1, write } = await fogRoom();
    const image: SyncElement = {
      ...createImage({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 1500, h: 1500 },
        src: 'https://example.com/map.png',
      }),
      id: 'map',
      version: 1,
    };

    await write(gm, { kind: 'upsert', element: image });
    await write(gm, { kind: 'upsert', element: shape('far', 2500, 100) });

    expect(seen(p1)).toEqual(['gm: upsert map', 'gm: upsert far']);
  });

  it("keeps a player's own element under fog for that player and removes it for another", async () => {
    const { p1, p2, write } = await fogRoom();

    await write(p1, { kind: 'upsert', element: shape('mine', OPEN.x, OPEN.y) });
    await write(p1, { kind: 'upsert', element: shape('mine', FOGGED.x, FOGGED.y, 2) });

    expect(seen(p1)).toEqual([]);
    expect(seen(p2)).toEqual(['p1: upsert mine', 'hub: remove mine']);
  });

  it('sends a hub remove to a player who adds under fog without an exemption', async () => {
    const { p1, p2, write } = await fogRoom((viewer) => viewer.role === 'gm');

    await write(p1, { kind: 'upsert', element: shape('mine', FOGGED.x, FOGGED.y) });

    expect(seen(p1)).toEqual(['hub: remove mine']);
    expect(seen(p2)).toEqual([]);
  });

  it('withholds movement records and templates under fog and sends a grid', async () => {
    const { gm, p1, write } = await fogRoom();
    const base = {
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      type: 'extension' as const,
    };
    const record = (target: string, trail: unknown[]): SyncElement => ({
      ...base,
      id: `vtt-movement:${target}`,
      position: { x: 0, y: 0 },
      extensionType: 'vtt:movement',
      data: { targetId: target, epoch: 'e1', feet: 5, diagonals: 0, visibility: 'all', trail },
    });
    const elements: SyncElement[] = [
      record('a', [[OPEN, FOGGED]]),
      record('b', []),
      {
        ...base,
        id: 'tpl',
        position: FOGGED,
        extensionType: 'vtt:template',
        data: {
          templateShape: 'circle',
          radius: 20,
          angle: 0,
          fillColor: '#f00',
          strokeColor: '#f00',
          strokeWidth: 1,
          opacity: 1,
        },
      },
      {
        ...base,
        id: 'grid',
        position: FOGGED,
        extensionType: 'vtt:grid',
        data: {
          gridType: 'square',
          hexOrientation: 'pointy',
          cellSize: 40,
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        },
      },
    ];

    for (const element of elements) await write(gm, { kind: 'upsert', element });

    expect(seen(p1)).toEqual(['gm: upsert grid']);
  });
});
