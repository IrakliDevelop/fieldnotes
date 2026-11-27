import { describe, it, expect, afterEach } from 'vitest';
import {
  createCurrentCapabilities,
  type BatchOp,
  type SyncCapabilities,
  type SyncElement,
  type SyncOp,
} from '@fieldnotes/sync';
import { SyncHub, type Connection, type SyncHubOptions } from './sync-hub';
import { createSyncServer } from './create-sync-server';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout } from './hub-fanout';
import type { ElementReadGate, ServerSyncPlugin } from './sync-plugin';
import { v2Remove, v2Shape } from './test-support/v2-ops';

interface FakeConn extends Connection {
  sent: string[];
}

function makeConn(id: string, role: string): FakeConn {
  const sent: string[] = [];
  return { id, room: 'R', role, sent, send: (m) => sent.push(m) };
}

const batching: SyncCapabilities = { ...createCurrentCapabilities([]), opBatching: 1 };

function admit(
  hub: SyncHub,
  conn: FakeConn,
  capabilities: SyncCapabilities = createCurrentCapabilities([]),
): FakeConn {
  hub.addConnection(conn);
  void hub.handleMessage(conn.id, envelope(conn.id, { kind: 'capabilities', capabilities }));
  conn.sent.length = 0;
  return conn;
}

function envelope(from: string, op: SyncOp): string {
  return JSON.stringify({ from, op });
}

function el(id: string, x = 10, version = 1): SyncElement {
  return { ...v2Shape({ position: { x, y: 0 }, size: { w: 10, h: 10 } }), id, version };
}

function label(op: SyncOp | BatchOp): string {
  switch (op.kind) {
    case 'upsert':
      return `upsert ${op.element.id}`;
    case 'remove':
      return `remove ${op.id}`;
    case 'snapshot':
      return `snapshot ${op.elements.map((element) => element.id).join(',')}`;
    case 'batch':
      return `batch[${op.ops.map(label).join(' ')}]`;
    default:
      return op.kind;
  }
}

function seen(conn: FakeConn): string[] {
  return conn.sent.map((message) => {
    const { from, op } = JSON.parse(message) as { from: string; op: SyncOp };
    return `${from}: ${label(op)}`;
  });
}

function gatePlugin(
  hidden: Set<string>,
  hideWhen: (element: SyncElement) => boolean = () => false,
): { plugin: ServerSyncPlugin; bump(): void } {
  const make = (): ElementReadGate => (element, viewer) =>
    viewer.role === 'gm' || !(hidden.has(element.id) || hideWhen(element));
  let gate = make();
  return {
    plugin: { name: 'gate', elementReadGate: async () => gate },
    bump: () => {
      gate = make();
    },
  };
}

const hubs: SyncHub[] = [];

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});

function makeHub(options: SyncHubOptions): SyncHub {
  const hub = new SyncHub({ resolvePresenceAudience: () => undefined, ...options });
  hubs.push(hub);
  return hub;
}

async function write(hub: SyncHub, conn: FakeConn, op: SyncOp): Promise<void> {
  await hub.handleMessage(conn.id, envelope(conn.id, op));
}

/** gm, player, batching player and a gm writer; seeds `h` (hidden), `m` at x 10, `n` at x -10. */
async function room(plugins: readonly ServerSyncPlugin[], options: SyncHubOptions = {}) {
  const hub = makeHub({ plugins, ...options });
  const gm = admit(hub, makeConn('gm', 'gm'));
  const player = admit(hub, makeConn('player', 'player'));
  const batcher = admit(hub, makeConn('batcher', 'player'), batching);
  const writer = admit(hub, makeConn('writer', 'gm'));
  for (const element of [el('h'), el('m'), el('n', -10)]) {
    await write(hub, writer, { kind: 'upsert', element });
  }
  for (const conn of [gm, player, batcher, writer]) conn.sent.length = 0;
  return { hub, gm, player, batcher, writer };
}

const removeH: BatchOp = { kind: 'remove', id: 'h', version: 2, editor: 'writer' };

const gated = () => [gatePlugin(new Set(['h']), (element) => element.position.x < 0).plugin];

describe('element read gate', () => {
  it('withholds a gated element from the player snapshot only', async () => {
    const stub = gatePlugin(new Set(['h']));
    const { hub, gm, player } = await room([stub.plugin]);
    stub.bump();

    await write(hub, gm, { kind: 'request-snapshot' });
    await write(hub, player, { kind: 'request-snapshot' });

    expect(seen(gm)).toEqual(['hub: snapshot h,m,n']);
    expect(seen(player)).toEqual(['hub: snapshot m,n']);
  });

  it('relays a live upsert of a gated id to the gm only', async () => {
    const { hub, gm, player, writer } = await room(gated());

    await write(hub, writer, { kind: 'upsert', element: el('h', 10, 2) });

    expect(seen(gm)).toEqual(['writer: upsert h']);
    expect(seen(player)).toEqual([]);
  });

  it('removes an element for the player when an update gates it, and resends it when ungated', async () => {
    const { hub, gm, player, writer } = await room(gated());

    await write(hub, writer, { kind: 'upsert', element: el('m', -10, 2) });
    expect(seen(player)).toEqual(['hub: remove m']);
    await write(hub, writer, { kind: 'upsert', element: el('m', 10, 3) });

    expect(seen(player)).toEqual(['hub: remove m', 'writer: upsert m']);
    expect(seen(gm)).toEqual(['writer: upsert m', 'writer: upsert m']);
  });

  it('sends the remove of an element the player could not read to the gm only', async () => {
    const { hub, gm, player, writer } = await room(gated());

    await write(hub, writer, v2Remove('h', 2, 'writer'));

    expect(seen(gm)).toEqual(['writer: remove h']);
    expect(seen(player)).toEqual([]);
  });

  it('gives a batching member the same elements as an unbatched one', async () => {
    const { hub, gm, player, batcher, writer } = await room(gated());

    await write(hub, writer, {
      kind: 'batch',
      ops: [
        { kind: 'upsert', element: el('x', -10) },
        { kind: 'upsert', element: el('m', -10, 2) },
        { kind: 'upsert', element: el('n', 10, 2) },
        removeH,
      ],
    });

    expect(seen(gm)).toEqual([
      'writer: upsert x',
      'writer: upsert m',
      'writer: upsert n',
      'writer: remove h',
    ]);
    expect(seen(player)).toEqual(['hub: remove m', 'writer: upsert n']);
    expect(seen(batcher)).toEqual(['hub: remove m', 'writer: batch[upsert n]']);
  });

  it('sends the sender a hub remove for its own upsert the gate denies, nothing for one it allows', async () => {
    const { hub, gm, player } = await room(gated());

    await write(hub, player, { kind: 'upsert', element: el('mine', -10) });
    await write(hub, player, { kind: 'upsert', element: el('open', 10) });

    expect(seen(player)).toEqual(['hub: remove mine']);
    expect(seen(gm)).toEqual(['player: upsert mine', 'player: upsert open']);
  });

  it('sends nothing to a canRead sender whose upsert it cannot read when no plugin gates', async () => {
    const hub = makeHub({
      canRead: ({ role, audience }) => role === 'gm' || audience !== 'secret',
      canReadLayer: () => true,
      resolveAudience: () => 'secret',
    });
    const gm = admit(hub, makeConn('gm', 'gm'));
    const player = admit(hub, makeConn('player', 'player'));

    await write(hub, player, { kind: 'upsert', element: el('s') });

    expect(seen(player)).toEqual([]);
    expect(seen(gm)).toEqual(['player: upsert s']);
  });

  it('corrects a rejected write on a gated element with a remove', async () => {
    const { hub, player } = await room(gated(), { authorize: ({ role }) => role === 'gm' });

    await write(hub, player, { kind: 'upsert', element: el('h', 10, 2) });

    expect(player.sent.map((message) => JSON.parse(message) as unknown)).toEqual([
      { from: 'hub', op: { kind: 'remove', id: 'h', version: 1, editor: 'hub' } },
    ]);
  });

  it('withholds from the viewer whose gate throws and keeps processing ops', async () => {
    const throwing: ServerSyncPlugin = {
      name: 'throwing',
      elementReadGate: async () => (_element, viewer) => {
        if (viewer.role === 'player') throw new Error('broken gate');
        return true;
      },
    };
    const { hub, gm, player, writer } = await room([throwing]);

    await write(hub, writer, { kind: 'upsert', element: el('a') });
    await write(hub, writer, { kind: 'upsert', element: el('b') });

    expect(seen(gm)).toEqual(['writer: upsert a', 'writer: upsert b']);
    expect(seen(player)).toEqual([]);
  });

  it('delivers no fanned-out element to a member who joined while gates load', async () => {
    const backend = new MemoryHubBackend();
    const fanout = new InMemoryHubFanout();
    let release: (gate: ElementReadGate) => void = () => undefined;
    const loading = new Promise<ElementReadGate>((resolve) => (release = resolve));
    const hub = makeHub({
      backend,
      fanout,
      plugins: [{ name: 'slow', elementReadGate: () => loading }],
    });
    const origin = makeHub({ backend, fanout });
    const gm = admit(hub, makeConn('gm', 'gm'));
    const writer = admit(origin, makeConn('writer', 'gm'));

    await write(origin, writer, { kind: 'upsert', element: el('e') });
    expect(seen(gm)).toEqual([]);
    release(() => true);
    await write(hub, gm, { kind: 'request-snapshot' });

    expect(seen(gm)).toEqual(['hub: snapshot e']);
  });

  it('refuses a gate plugin without resolvePresenceAudience', () => {
    const { plugin } = gatePlugin(new Set());
    const message = /a plugin with `elementReadGate` requires `resolvePresenceAudience`/;

    expect(() => new SyncHub({ plugins: [plugin] })).toThrow(message);
    expect(() => createSyncServer({ port: 0, allowAnonymous: true, plugins: [plugin] })).toThrow(
      message,
    );
  });

  it('sends the same frames with a plugin lacking elementReadGate as with no plugin', async () => {
    const run = async (plugins: readonly ServerSyncPlugin[]) => {
      const { hub, gm, player, batcher, writer } = await room(plugins);
      await write(hub, writer, { kind: 'upsert', element: el('m', -10, 2) });
      await write(hub, writer, {
        kind: 'batch',
        ops: [{ kind: 'upsert', element: el('n', 10, 2) }, removeH],
      });
      await write(hub, player, { kind: 'upsert', element: el('p') });
      await write(hub, player, { kind: 'request-snapshot' });
      return [gm.sent, player.sent, batcher.sent];
    };

    const plain = await run([]);

    expect(plain[1]?.length).toBeGreaterThan(0);
    expect(await run([{ name: 'ungated', snapshot: async () => undefined }])).toEqual(plain);
  });
});
