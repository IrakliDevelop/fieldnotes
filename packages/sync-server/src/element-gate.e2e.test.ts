import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { ElementStore } from '@fieldnotes/core';
import {
  SyncClient,
  WebSocketTransport,
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
import type { ApplyResult, ElementReadGate, ServerSyncPlugin } from './sync-plugin';
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

  it('relays presence to every member when a gate plugin returns an audience without canRead', async () => {
    const { hub, gm, player, batcher, writer } = await room(gated(), {
      resolvePresenceAudience: () => 'gm',
    });

    await write(hub, writer, { kind: 'presence', data: { cursor: { x: 1, y: 2 } } });

    for (const conn of [gm, player, batcher]) expect(seen(conn)).toEqual(['writer: presence']);
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
function switchablePlugin(
  hidden: Set<string>,
  hideWhen: (element: SyncElement) => boolean = () => false,
): ServerSyncPlugin {
  const make = (): ElementReadGate => {
    const frozen = new Set(hidden);
    return (element, viewer) =>
      viewer.role === 'gm' || !(frozen.has(element.id) || hideWhen(element));
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

  it('sends nothing from a reconcile whose room was emptied and reloaded while it read', async () => {
    const { hub, backend, gm, player, writer } = await gateRoom(new Set(['a']), [el('a')]);
    let release: () => void = () => undefined;
    backend.hold = new Promise((resolve) => (release = resolve));

    await write(hub, gm, toggle('a', false));
    await vi.waitFor(() => expect(backend.calls).toBe(1));
    for (const conn of [gm, player, writer]) hub.removeConnection(conn.id);
    const joiner = admit(hub, makeConn('joiner', 'player'));
    release();
    await write(hub, joiner, toggle('none', false));

    expect(seen(joiner)).toEqual([]);
  });

  it('retries a reconcile whose snapshot read failed on the next snapshot request', async () => {
    const { hub, backend, gm, player, writer, flush } = await gateRoom(new Set(), [el('a')]);
    backend.failNext = true;

    await write(hub, gm, toggle('a', true));
    await flush();
    await write(hub, writer, { kind: 'request-snapshot' });
    await flush();

    expect(seen(player)).toEqual(['hub: remove a']);
  });

  it('sends no hub upsert after a failed first load when a snapshot request loads the gates', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: el('e') }, null);
    let calls = 0;
    const flaky: ServerSyncPlugin = {
      name: 'gate',
      elementReadGate: async () => {
        calls += 1;
        if (calls === 1) throw new Error('gate down');
        return () => true;
      },
    };
    const hub = makeHub({ backend, plugins: [flaky] });
    const player = admit(hub, makeConn('player', 'player'));

    await write(hub, player, { kind: 'request-snapshot' });
    await write(hub, player, { kind: 'upsert', element: el('z') });

    expect(seen(player)).toEqual(['hub: snapshot e']);
  });

  it('sends an element a gate change reveals after a snapshot request loaded the gates', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: el('a') }, null);
    const switchable = switchablePlugin(new Set(['a']));
    let calls = 0;
    const flaky: ServerSyncPlugin = {
      ...switchable,
      elementReadGate: async (room, store) => {
        calls += 1;
        if (calls === 1) throw new Error('gate down');
        return switchable.elementReadGate?.(room, store);
      },
    };
    const hub = makeHub({ backend, plugins: [flaky] });
    const player = admit(hub, makeConn('player', 'player'));
    const gm = admit(hub, makeConn('gm', 'gm'));

    const snapshot = write(hub, player, { kind: 'request-snapshot' });
    const reveal = write(hub, gm, toggle('a', false));
    await Promise.all([snapshot, reveal]);
    await write(hub, gm, toggle('none', false));

    expect(seen(player)).toEqual(['hub: snapshot ', 'hub: upsert a']);
  });

  it('reconciles from the settled gates after a refresh that threw mid-session', async () => {
    const switchable = switchablePlugin(new Set());
    let failNext = false;
    const flaky: ServerSyncPlugin = {
      ...switchable,
      elementReadGate: async (room, store) => {
        if (failNext) {
          failNext = false;
          throw new Error('gate down');
        }
        return switchable.elementReadGate?.(room, store);
      },
    };
    const { hub, gm, player, writer, flush } = await gateRoom(new Set(), [el('a')], {
      plugins: [flaky],
    });
    failNext = true;

    await write(hub, gm, toggle('a', true)).catch(() => undefined);
    await write(hub, writer, { kind: 'request-snapshot' });
    await flush();

    expect(seen(player)).toEqual(['hub: remove a']);
  });

  it('removes an element moved while a reconcile that hides it is pending', async () => {
    const { hub, gm, player, writer, flush } = await gateRoom(new Set(), [el('a')]);

    const hiding = write(hub, gm, toggle('a', true));
    const moving = write(hub, writer, { kind: 'upsert', element: el('a', 40, 2) });
    await Promise.all([hiding, moving]);
    await flush();

    expect(seen(player)).toEqual(['hub: remove a', 'hub: remove a']);
  });

  it('removes an element delivered live under a reveal that was covered again before the reconcile', async () => {
    const { hub, gm, player, writer, flush } = await gateRoom(new Set(['a']), [el('a')]);

    await Promise.all([
      write(hub, gm, toggle('a', false)),
      write(hub, writer, { kind: 'upsert', element: el('a', 20, 2) }),
      write(hub, gm, toggle('a', true)),
    ]);
    await flush();

    expect(seen(player)).toEqual(['writer: upsert a', 'hub: remove a']);
  });

  it('removes an element sent in a snapshot under a reveal that was covered again before the reconcile', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(['a']), [el('a')]);

    await Promise.all([
      write(hub, gm, toggle('a', false)),
      write(hub, player, { kind: 'request-snapshot' }),
      write(hub, gm, toggle('a', true)),
    ]);
    await flush();

    expect(seen(player)).toEqual(['hub: snapshot a', 'hub: remove a']);
  });

  it('removes what an intermediate gate set allowed after a reconcile that failed', async () => {
    const { hub, backend, gm, player, writer, flush } = await gateRoom(new Set(['a']), [el('a')]);
    backend.failNext = true;

    await write(hub, gm, toggle('a', false));
    await flush();
    await write(hub, writer, { kind: 'upsert', element: el('a', 20, 2) });
    await write(hub, gm, toggle('a', true));
    await flush();

    expect(seen(player)).toEqual(['writer: upsert a', 'hub: remove a']);
  });

  it('removes an element revealed before a failed gate refresh once the next load covers it', async () => {
    const switchable = switchablePlugin(new Set(['a']));
    let failNext = false;
    const flaky: ServerSyncPlugin = {
      ...switchable,
      elementReadGate: async (room, store) => {
        if (failNext) {
          failNext = false;
          throw new Error('gate down');
        }
        return switchable.elementReadGate?.(room, store);
      },
    };
    const { hub, backend, gm, player, writer, flush } = await gateRoom(new Set(), [el('a')], {
      plugins: [flaky],
    });
    backend.failNext = true;

    await write(hub, gm, toggle('a', false));
    await flush();
    await write(hub, writer, { kind: 'upsert', element: el('a', 20, 2) });
    failNext = true;
    await write(hub, gm, toggle('a', true)).catch(() => undefined);
    // The first flush loads the gates and queues the reconcile; the second waits for it.
    await flush();
    await flush();

    expect(seen(player)).toEqual(['writer: upsert a', 'hub: remove a']);
  });

  it('reveals both elements when two reveals land before one reconcile', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(['a', 'b']), [el('a'), el('b')]);

    await Promise.all([write(hub, gm, toggle('a', false)), write(hub, gm, toggle('b', false))]);
    await flush();

    expect(seen(player)).toEqual(['hub: upsert a', 'hub: upsert b']);
  });

  it('restores an element removed under an intermediate cover when the reveal returns before the reconcile', async () => {
    const { hub, gm, player, writer, flush } = await gateRoom(new Set(['a']), [el('a')]);

    await Promise.all([
      write(hub, gm, toggle('a', false)),
      write(hub, gm, toggle('a', true)),
      write(hub, writer, { kind: 'upsert', element: el('a', 20, 2) }),
      write(hub, gm, toggle('a', false)),
    ]);
    await flush();

    expect(seen(player)).toEqual(['hub: remove a', 'hub: upsert a']);
    expect(upserted(player)[0]?.position).toEqual({ x: 20, y: 0 });
  });

  it('sends every allowed element after the since list overflows', async () => {
    const { hub, gm, player, flush } = await gateRoom(new Set(['a']), [el('a'), el('b')]);
    const ids = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'];

    await Promise.all([
      ...ids.map((id) => write(hub, gm, toggle(id, true))),
      write(hub, gm, toggle('a', false)),
      write(hub, gm, toggle('b', true)),
    ]);
    await flush();

    expect(seen(player)).toEqual(['hub: upsert a', 'hub: remove b']);
  });
});

const left = (element: SyncElement) => element.position.x < 0;

/** Origin and remote hubs on one backend and bus; a gm writer on the origin, gm and player on the remote. */
async function twoHubs(plugins: () => ServerSyncPlugin[], remotePlugins = plugins) {
  const backend = new CountingBackend();
  const fanout = new InMemoryHubFanout();
  const published: string[] = [];
  fanout.subscribe((payload) => published.push(payload));
  const origin = makeHub({ instanceId: 'A', backend, fanout, plugins: plugins() });
  const remote = makeHub({ instanceId: 'B', backend, fanout, plugins: remotePlugins() });
  const writer = admit(origin, makeConn('writer', 'gm'));
  const gm = admit(remote, makeConn('gm', 'gm'));
  const player = admit(remote, makeConn('player', 'player'));
  for (const element of [el('m'), el('n', -10)])
    await write(origin, writer, { kind: 'upsert', element });
  const flush = () => write(remote, gm, { kind: 'request-snapshot' });
  await flush();
  for (const conn of [writer, gm, player]) conn.sent.length = 0;
  published.length = 0;
  backend.calls = 0;
  const inject = (op: SyncOp, extra: Record<string, unknown>): void =>
    fanout.publish(JSON.stringify({ o: 'C', room: 'R', from: 'writer', op, ...extra }));
  return { backend, origin, remote, writer, gm, player, published, flush, inject };
}

const imageBase = {
  id: 'img',
  type: 'image',
  position: { x: 10, y: 0 },
  index: 'a0',
  version: 1,
  locked: false,
  layerId: '',
  size: { w: 10, h: 10 },
} as const;
const imageSrc = 'data:image/png;base64,iVBORw0KGgo=';

describe('element gate across instances', () => {
  const stub = () => [gatePlugin(new Set(), left).plugin];

  it('removes an element for a remote player when an update gates it, and resends it when ungated', async () => {
    const { origin, writer, player } = await twoHubs(stub);

    await write(origin, writer, { kind: 'upsert', element: el('m', -10, 2) });
    expect(seen(player)).toEqual(['hub: remove m']);
    await write(origin, writer, { kind: 'upsert', element: el('m', 10, 3) });

    expect(seen(player)).toEqual(['hub: remove m', 'writer: upsert m']);
  });

  it('publishes prevEl without src only when a gate plugin is present', async () => {
    const image1: SyncElement = { ...imageBase, src: imageSrc };
    const image2: SyncElement = {
      ...imageBase,
      position: { x: 20, y: 0 },
      version: 2,
      src: imageSrc,
    };
    const move = { kind: 'upsert', element: image2 } as const;

    const gatedHubs = await twoHubs(stub);
    await write(gatedHubs.origin, gatedHubs.writer, { kind: 'upsert', element: image1 });
    await write(gatedHubs.origin, gatedHubs.writer, move);
    const plainHubs = await twoHubs(() => []);
    await write(plainHubs.origin, plainHubs.writer, { kind: 'upsert', element: image1 });
    await write(plainHubs.origin, plainHubs.writer, move);

    expect(JSON.parse(gatedHubs.published[1] ?? '')).toEqual({
      o: 'A',
      room: 'R',
      from: 'writer',
      op: move,
      existed: true,
      prevEl: imageBase,
    });
    expect(plainHubs.published[1]).toBe(
      JSON.stringify({ o: 'A', room: 'R', from: 'writer', op: move, existed: true }),
    );
  });

  it('sends the hub remove for an update of an existing element without a usable prevEl', async () => {
    const { player, inject } = await twoHubs(stub);
    const hide = (version: number): SyncOp => ({ kind: 'upsert', element: el('m', -10, version) });

    inject(hide(2), { existed: true });
    inject(hide(3), { existed: true, prevEl: { ...el('other'), id: 'other' } });

    expect(seen(player)).toEqual(['hub: remove m', 'hub: remove m']);
  });

  it('sends nothing for the remove of an element whose prevEl the remote player could not read', async () => {
    const { gm, player, inject } = await twoHubs(stub);

    inject(v2Remove('n', 2, 'writer'), { existed: true, prevEl: el('n', -10) });
    inject(v2Remove('m', 2, 'writer'), { existed: true, prevEl: el('m') });

    expect(seen(player)).toEqual(['writer: remove m']);
    expect(seen(gm)).toEqual(['writer: remove n', 'writer: remove m']);
  });

  it('removes an element a fan-out update moves while a reconcile that hides it is pending', async () => {
    const { backend, origin, remote, writer, gm, player, flush } = await twoHubs(stub, () => [
      switchablePlugin(new Set(), left),
    ]);
    await write(origin, writer, { kind: 'upsert', element: el('a') });
    await flush();
    player.sent.length = 0;
    let release: () => void = () => undefined;
    backend.hold = new Promise((resolve) => (release = resolve));

    await write(remote, gm, toggle('a', true));
    await write(origin, writer, { kind: 'upsert', element: el('a', -10, 2) });
    release();
    await flush();

    expect(seen(player)).toEqual(['hub: remove a']);
  });

  it('withholds every element after a gate refresh throws', async () => {
    let broken = false;
    const breaking = (): ServerSyncPlugin[] => [
      {
        name: 'gate',
        elementReadGate: async () => {
          if (broken) throw new Error('gate down');
          return () => true;
        },
        registerExtensionKinds(registry) {
          registry.register(gateKind, async (op) => {
            broken = true;
            return { accepted: op, corrections: [] };
          });
        },
      },
    ];
    const { origin, remote, writer, gm, player } = await twoHubs(() => [], breaking);

    await write(remote, gm, toggle('a', true)).catch(() => undefined);
    await write(origin, writer, { kind: 'upsert', element: el('e') });

    expect(seen(player)).toEqual([]);
    expect(seen(gm)).toEqual([]);
  });
});

const emitKind = createExtensionKind<{ emit: true }>({
  extensionKind: 'test:emit',
  codec: {
    validate: (payload): payload is { emit: true } =>
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { emit?: unknown }).emit === true,
  },
});

/** A plugin whose `test:emit` op returns whatever `result()` holds. */
function emitter(result: () => ApplyResult): ServerSyncPlugin {
  return {
    name: 'emit',
    registerExtensionKinds(registry) {
      registry.register(emitKind, async () => result());
    },
  };
}

const secretRead: SyncHubOptions = {
  canRead: ({ role, audience }) => role === 'gm' || audience !== 'secret',
  canReadLayer: () => true,
  resolveAudience: ({ element }) => (element.id === 's' ? 'secret' : undefined),
};

describe('element ops a plugin returns', () => {
  async function pluginRoom(by: 'gate' | 'canRead', remote: boolean) {
    const backend = new MemoryHubBackend();
    const fanout = new InMemoryHubFanout();
    let result: ApplyResult = { accepted: null, corrections: [] };
    const make = (instanceId: string) =>
      makeHub({
        instanceId,
        backend,
        fanout,
        plugins: [...(by === 'gate' ? gated() : []), emitter(() => result)],
        ...(by === 'canRead' ? secretRead : {}),
      });
    const origin = make('A');
    const other = remote ? make('B') : origin;
    const gm = admit(origin, makeConn('gm', 'gm'));
    const watcher = admit(other, makeConn('watcher', 'gm'));
    const player = admit(other, makeConn('player', 'player'));
    for (const element of [el('g', -10), el('s'), el('ok')]) {
      await write(origin, gm, { kind: 'upsert', element });
    }
    await write(other, watcher, { kind: 'request-snapshot' });
    for (const conn of [gm, watcher, player]) conn.sent.length = 0;
    const emit = async (from: FakeConn, next: ApplyResult) => {
      result = next;
      await write(origin, from, {
        kind: 'extension',
        extensionKind: 'test:emit',
        payload: { emit: true },
      });
    };
    const hidden = by === 'gate' ? el('g', -10, 2) : { ...el('s', 10, 2), audience: 'secret' };
    return { gm, watcher, player, emit, hidden };
  }

  const upsert = (element: SyncElement): SyncOp => ({ kind: 'upsert', element });
  const none = { accepted: null, corrections: [] };

  it.each([
    ['gate', false],
    ['canRead', false],
    ['gate', true],
    ['canRead', true],
  ] as const)('filters by %s for a player (remote: %s)', async (by, remote) => {
    const { gm, watcher, player, emit, hidden } = await pluginRoom(by, remote);
    const id = hidden.id;

    await emit(gm, { accepted: upsert(hidden), corrections: [] });
    await emit(gm, { ...none, broadcast: [upsert(hidden)] });
    await emit(gm, { accepted: upsert(el('ok', 10, 2)), corrections: [] });
    await emit(gm, { accepted: v2Remove(id, 2, 'gm'), corrections: [] });
    await emit(gm, { accepted: v2Remove('ok', 2, 'gm'), corrections: [] });
    await emit(gm, { accepted: v2Remove('missing', 2, 'gm'), corrections: [] });

    expect(seen(player)).toEqual([
      `hub: remove ${id}`,
      `hub: remove ${id}`,
      'gm: upsert ok',
      'gm: remove ok',
    ]);
    expect(seen(watcher)).toEqual([
      `gm: upsert ${id}`,
      `gm: upsert ${id}`,
      'gm: upsert ok',
      `gm: remove ${id}`,
      'gm: remove ok',
    ]);
  });

  it.each(['gate', 'canRead'] as const)(
    'corrects a player sender by %s with a hub remove for an unreadable upsert',
    async (by) => {
      const { player, emit, hidden } = await pluginRoom(by, false);

      await emit(player, { ...none, corrections: [upsert(hidden)] });
      await emit(player, { ...none, corrections: [upsert(el('ok', 10, 2))] });

      expect(seen(player)).toEqual([`hub: remove ${hidden.id}`, 'hub: upsert ok']);
    },
  );
});

describe('first gate load', () => {
  const servers: ReturnType<typeof createSyncServer>[] = [];
  const transports: WebSocketTransport[] = [];

  afterEach(async () => {
    for (const transport of transports.splice(0)) transport.close();
    for (const server of servers.splice(0)) await server.close();
  });

  it('keeps the newer local edit of a reconnecting first member instead of resending the stored element', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: el('e', 10, 1) }, null);
    let release: () => void = () => undefined;
    const allowAll: ElementReadGate = () => true;
    // The first load finishes only after the snapshot request is queued behind it.
    const loaded = new Promise<ElementReadGate>((resolve) => (release = () => resolve(allowAll)));
    const server = createSyncServer({
      allowAnonymous: true,
      port: 0,
      backend,
      plugins: [{ name: 'gate', elementReadGate: () => loaded }],
      resolvePresenceAudience: () => undefined,
    });
    servers.push(server);
    server.wss.on('connection', (ws) =>
      ws.on('message', (data) => {
        if (String(data).includes('request-snapshot')) release();
      }),
    );
    const { port } = server.wss.address() as AddressInfo;
    const store = new ElementStore();
    store.add(el('e', 50, 2));
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=R`, {
      WebSocket: WsClient as unknown as typeof WebSocket,
    });
    transports.push(transport);
    const received: string[] = [];
    transport.onMessage((message) => {
      const { from, op } = JSON.parse(message) as { from: string; op: SyncOp };
      if (op.kind !== 'capabilities') received.push(`${from}: ${label(op)}`);
    });
    new SyncClient({ store, transport, firstSnapshot: 'reconcile' }).start();

    const storedX = async () => {
      const record = await backend.getRecord('R', 'e');
      return record?.kind === 'element' ? record.element.position.x : undefined;
    };
    await vi.waitFor(async () => {
      if ((await storedX()) !== 50 && received.length < 2) throw new Error('not settled');
    });

    expect(received).toEqual(['hub: snapshot e']);
    expect(await storedX()).toBe(50);
    expect(store.getById('e')?.position).toEqual({ x: 50, y: 0 });
  });
});
