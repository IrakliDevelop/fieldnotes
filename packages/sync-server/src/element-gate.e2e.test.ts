import { describe, it, expect, afterEach } from 'vitest';
import {
  createCurrentCapabilities,
  createExtensionKind,
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

class CountingBackend extends MemoryHubBackend {
  calls = 0;
  hold: Promise<void> = Promise.resolve();
  failNext = false;

  override async snapshot(room: string): ReturnType<MemoryHubBackend['snapshot']> {
    this.calls += 1;
    await this.hold;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('backend down');
    }
    return super.snapshot(room);
  }
}

const gateKind = createExtensionKind<{ id: string; hidden: boolean }>({
  extensionKind: 'test:gate',
  codec: {
    validate: (payload): payload is { id: string; hidden: boolean } =>
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { id?: unknown }).id === 'string' &&
      typeof (payload as { hidden?: unknown }).hidden === 'boolean',
  },
});

/** A gate plugin whose `test:gate` op hides or reveals one id, replacing the gate only on a change. */
function switchablePlugin(hidden: Set<string>): ServerSyncPlugin {
  const make = (): ElementReadGate => {
    const frozen = new Set(hidden);
    return (element, viewer) => viewer.role === 'gm' || !frozen.has(element.id);
  };
  let gate = make();
  return {
    name: 'gate',
    elementReadGate: async () => gate,
    registerExtensionKinds(registry) {
      registry.register(gateKind, async (op) => {
        const { id, hidden: hide } = op.payload;
        if (hidden.has(id) !== hide) {
          if (hide) hidden.add(id);
          else hidden.delete(id);
          gate = make();
        }
        return { accepted: op, corrections: [] };
      });
    },
  };
}

function toggle(id: string, hidden: boolean): SyncOp {
  return { kind: 'extension', extensionKind: 'test:gate', payload: { id, hidden } };
}

/** gm, player and gm writer; seeds `elements`; every queued reconcile has run on return. */
async function gateRoom(
  hidden: Set<string>,
  elements: readonly SyncElement[],
  options: SyncHubOptions = {},
) {
  const backend = new CountingBackend();
  const hub = makeHub({ backend, plugins: [switchablePlugin(hidden)], ...options });
  const gm = admit(hub, makeConn('gm', 'gm'));
  const player = admit(hub, makeConn('player', 'player'));
  const writer = admit(hub, { ...makeConn('writer', 'gm'), userId: 'u1' });
  for (const element of elements) await write(hub, writer, { kind: 'upsert', element });
  // An unchanged toggle queues behind any reconcile without scheduling one.
  const flush = () => write(hub, gm, toggle('none', false));
  await flush();
  for (const conn of [gm, player, writer]) conn.sent.length = 0;
  backend.calls = 0;
  return { hub, backend, gm, player, writer, flush };
}

function upserted(conn: FakeConn): SyncElement[] {
  return conn.sent.flatMap((message) => {
    const { op } = JSON.parse(message) as { op: SyncOp };
    return op.kind === 'upsert' ? [op.element] : [];
  });
}

describe('element gate reconcile', () => {
  it('sends the player a hub remove for an element a gate change hides', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(), [el('a'), el('b')]);

    await write(hub, gm, toggle('a', true));
    await flush();

    expect(seen(player)).toEqual(['hub: remove a']);
    expect(seen(gm)).toEqual([]);
  });

  it('sends the player the stored element when a gate change reveals it', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(['a']), [el('a', 30, 1)]);

    await write(hub, gm, toggle('a', false));
    await flush();

    expect(seen(player)).toEqual(['hub: upsert a']);
    expect(upserted(player)[0]?.position).toEqual({ x: 30, y: 0 });
    expect(seen(gm)).toEqual([]);
  });

  it('never reveals an element the player cannot read by audience', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(['s', 'a']), [el('s'), el('a')], {
      canRead: ({ role, audience }) => role === 'gm' || audience !== 'secret',
      canReadLayer: () => true,
      resolveAudience: ({ element }) => (element.id === 's' ? 'secret' : undefined),
    });

    await write(hub, gm, toggle('s', false));
    await write(hub, gm, toggle('a', false));
    await flush();

    expect(seen(player)).toEqual(['hub: upsert a']);
  });

  it('strips ownerId from a reveal upsert for a viewer without canReadOwnerId', async () => {
    const { hub, backend, gm, player, flush } = await gateRoom(new Set(['a']), [el('a')], {
      authorize: () => true,
      canReadOwnerId: ({ role }) => role === 'gm',
    });

    await write(hub, gm, toggle('a', false));
    await flush();

    expect((await backend.snapshot('R')).elements[0]?.ownerId).toBe('u1');
    expect(seen(player)).toEqual(['hub: upsert a']);
    expect(upserted(player)[0]).not.toHaveProperty('ownerId');
  });

  it('coalesces gate changes made while a reconcile is blocked into one more run', async () => {
    const { hub, backend, gm, flush } = await gateRoom(new Set(), [el('a'), el('b'), el('c')]);
    let release: () => void = () => undefined;
    backend.hold = new Promise((resolve) => (release = resolve));

    await write(hub, gm, toggle('a', true));
    const pending = [toggle('b', true), toggle('c', true), toggle('a', false)].map((op) =>
      write(hub, gm, op),
    );
    release();
    await Promise.all(pending);
    await flush();

    expect(backend.calls).toBe(2);
  });

  it('does not reconcile when the same gate function is returned again', async () => {
    const { hub, backend, gm, player, flush } = await gateRoom(new Set(['a']), [el('a')]);

    await write(hub, gm, toggle('a', true));
    await flush();

    expect(backend.calls).toBe(0);
    expect(seen(player)).toEqual([]);
  });

  it('keeps settled after a failed reconcile, so the next change reconciles from it', async () => {
    const { hub, backend, gm, player, flush } = await gateRoom(new Set(), [el('a'), el('b')]);
    backend.failNext = true;

    await write(hub, gm, toggle('a', true));
    await flush();
    expect(seen(player)).toEqual([]);
    await write(hub, gm, toggle('b', true));
    await flush();

    expect(seen(player)).toEqual(['hub: remove a', 'hub: remove b']);
  });

  it('removes an element moved while a reconcile that hides it is pending', async () => {
    const { hub, gm, player, writer, flush } = await gateRoom(new Set(), [el('a')]);

    const hiding = write(hub, gm, toggle('a', true));
    const moving = write(hub, writer, { kind: 'upsert', element: el('a', 40, 2) });
    await Promise.all([hiding, moving]);
    await flush();

    expect(seen(player)).toEqual(['hub: remove a', 'hub: remove a']);
  });
});
