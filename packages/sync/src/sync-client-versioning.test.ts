import { describe, it, expect } from 'vitest';
import { ElementStore, HistoryStack, createShape } from '@fieldnotes/core';
import type { CanvasElement, Command } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
import { createCurrentCapabilities } from './capabilities';
import type { SyncOp, Tombstone } from './protocol';
import type { SyncTransport } from './sync-transport';

function shape(id: string, version: number, editor?: string, fillColor = '#000000'): CanvasElement {
  const base = createShape({
    index: 'a0',
    version,
    position: { x: 0, y: 0 },
    size: { w: 10, h: 10 },
    fillColor,
  });
  return editor === undefined ? { ...base, id } : { ...base, id, editor };
}

function tomb(id: string, version: number, editor: string): Tombstone {
  return { id, version, editor };
}

/** One client on a fake transport; `peer` has already completed the capability handshake. */
function setup(peer: string | null = 'P', clientId = 'A') {
  const store = new ElementStore();
  const sent: string[] = [];
  let receive: (message: string) => void = () => undefined;
  let reconnect: () => void = () => undefined;
  let closed = false;
  const transport: SyncTransport = {
    send: (message) => {
      sent.push(message);
    },
    onMessage: (handler) => {
      receive = handler;
      return () => {
        receive = () => undefined;
      };
    },
    onReconnect: (handler) => {
      reconnect = handler;
      return () => undefined;
    },
    close: () => {
      closed = true;
    },
  };
  const client = new SyncClient({ store, transport, clientId });
  client.start();
  const deliver = (from: string, op: SyncOp | Record<string, unknown>): void =>
    receive(JSON.stringify({ from, op }));
  const capabilities = (from: string): void =>
    deliver(from, { kind: 'capabilities', capabilities: createCurrentCapabilities([]) });
  if (peer !== null) capabilities(peer);
  const ops = (): SyncOp[] => sent.map((m) => (JSON.parse(m) as { op: SyncOp }).op);
  const last = <K extends SyncOp['kind']>(kind: K): Extract<SyncOp, { kind: K }> | undefined =>
    ops()
      .filter((op): op is Extract<SyncOp, { kind: K }> => op.kind === kind)
      .at(-1);
  const reconcile = (): void => {
    reconnect();
    capabilities(peer ?? 'P');
  };
  return { store, sent, deliver, last, reconcile, closed: () => closed };
}

const REMOTE = { origin: 'remote' };

describe('SyncClient concurrent equal-version edits', () => {
  it.each([
    ['peer-to-peer', null],
    ['hub-relayed', 'hub'],
  ] as const)('%s: both peers converge on the later-sorting peer id', (_room, hub) => {
    const a = setup(hub ?? 'B', 'A');
    const b = setup(hub ?? 'A', 'B');
    a.store.add(shape('x', 5, 'C'), REMOTE);
    b.store.add(shape('x', 5, 'C'), REMOTE);
    a.store.update('x', { fillColor: '#aaaaaa' });
    b.store.update('x', { fillColor: '#bbbbbb' });
    const fromA = a.last('upsert');
    const fromB = b.last('upsert');
    if (!fromA || !fromB) throw new Error('both edits must be sent');

    b.deliver('A', fromA);
    expect(b.store.getById('x')).toMatchObject({ version: 6, fillColor: '#bbbbbb' });
    a.deliver('B', fromB);

    expect(a.store.getById('x')).toMatchObject({ version: 6, editor: 'B', fillColor: '#bbbbbb' });
    expect(b.store.getById('x')).toMatchObject({ version: 6, fillColor: '#bbbbbb' });
  });
});

describe('SyncClient versioned last-writer-wins', () => {
  it('takes an equal-version upsert from a later editor and ignores one from an earlier editor', () => {
    const { store, deliver } = setup();
    store.add(shape('x', 5, 'a'), REMOTE);

    deliver('B', { kind: 'upsert', element: shape('x', 5, 'b', '#bbbbbb') });
    deliver('C', { kind: 'upsert', element: shape('x', 5, 'a', '#aaaaaa') });

    expect(store.getById('x')).toMatchObject({ version: 5, editor: 'b', fillColor: '#bbbbbb' });
  });

  it('stores a hub correction verbatim even at a lower version', () => {
    const { store, deliver } = setup('hub');
    store.add(shape('x', 6), REMOTE);

    deliver('hub', { kind: 'upsert', element: shape('x', 5, 'hub', '#cccccc') });

    expect(store.getById('x')).toMatchObject({ version: 5, editor: 'hub', fillColor: '#cccccc' });
  });

  it.each([
    ['upsert', { kind: 'upsert', element: shape('x', 3, 'B', '#cccccc') }],
    ['remove', { kind: 'remove', id: 'x', version: 3, editor: 'B' }],
  ] as const)('ignores a stale peer %s', (_kind, op) => {
    const { store, deliver } = setup();
    store.add(shape('x', 4), REMOTE);

    deliver('B', op);

    expect(store.getById('x')).toMatchObject({ version: 4, fillColor: '#000000' });
  });

  it('stamps outgoing upserts with the store version and its own editor without writing the editor back', () => {
    const { store, last } = setup();
    store.add(shape('x', 3));

    expect(last('upsert')?.element).toMatchObject({ id: 'x', version: 3, editor: 'A' });
    expect(store.getById('x')?.editor).toBeUndefined();
  });

  it('sends a remove at version + 1 with its editor and then ignores a stale upsert of that id', () => {
    const { store, deliver, last } = setup();
    store.add(shape('x', 1));
    store.remove('x');

    expect(last('remove')).toEqual({ kind: 'remove', id: 'x', version: 2, editor: 'A' });

    deliver('B', { kind: 'upsert', element: shape('x', 1, 'B') });
    expect(store.getById('x')).toBeUndefined();
  });

  it('re-sends an undone delete above its tombstone, one local store change per undo and redo', () => {
    const { store, last } = setup();
    const history = new HistoryStack();
    const element = shape('x', 1);
    store.add(element);
    store.remove('x');
    const deletion: Command = {
      execute: (s) => s.remove('x'),
      undo: (s) => s.add({ ...element }),
    };
    history.push(deletion);
    let localChanges = 0;
    const countLocal = (_data: unknown, meta: { origin?: string }): void => {
      if (meta.origin === undefined || meta.origin === 'local') localChanges += 1;
    };
    store.on('add', countLocal);
    store.on('update', countLocal);
    store.on('remove', countLocal);

    history.undo(store);
    expect(localChanges).toBe(1);
    expect(store.getById('x')?.version).toBe(3);
    expect(last('upsert')?.element).toMatchObject({ id: 'x', version: 3, editor: 'A' });

    history.redo(store);
    expect(localChanges).toBe(2);
    expect(last('remove')).toEqual({ kind: 'remove', id: 'x', version: 4, editor: 'A' });

    history.undo(store);
    expect(localChanges).toBe(3);
    expect(store.getById('x')?.version).toBe(5);
    expect(history.undoCount + history.redoCount).toBe(1);
  });

  it('sends a peer-to-peer clear with tombstones above every live version, then re-sends reloaded ids above them', () => {
    const { store, deliver, last, sent } = setup();
    store.add(shape('a', 1));
    deliver('B', { kind: 'upsert', element: shape('b', 3, 'B') });

    store.clear();
    expect(last('clear')).toEqual({
      kind: 'clear',
      tombstones: [tomb('a', 2, 'A'), tomb('b', 4, 'A')],
    });

    const before = sent.length;
    store.loadSnapshot([shape('a', 1), shape('b', 3)]);
    const resent = sent
      .slice(before)
      .map((m) => (JSON.parse(m) as { op: SyncOp }).op)
      .flatMap((op) => (op.kind === 'upsert' ? [[op.element.id, op.element.version]] : []));
    expect(resent).toEqual([
      ['a', 3],
      ['b', 5],
    ]);
    expect(store.getById('b')?.version).toBe(5);
  });

  it('sends a batch replacement as a tombstoned clear followed by upserts stamped above it', () => {
    const { store, sent } = setup();
    store.add(shape('a', 1));
    const before = sent.length;

    const batch = store.suspendNotifications();
    store.clear();
    store.add(shape('a', 1));
    batch.resume();

    expect(sent.slice(before).map((m) => (JSON.parse(m) as { op: SyncOp }).op)).toEqual([
      { kind: 'clear', tombstones: [tomb('a', 2, 'A')] },
      { kind: 'upsert', element: { ...shape('a', 3), editor: 'A' } },
    ]);
  });

  it('omits the clear tombstone list once the hub is identified', () => {
    const { store, last } = setup('hub');
    store.add(shape('a', 1));

    store.clear();

    expect(last('clear')).toEqual({ kind: 'clear' });
  });

  it('keeps an element newer than its clear tombstone and removes nothing on an unlisted clear', () => {
    const { store, deliver } = setup();
    store.add(shape('x', 7), REMOTE);
    store.add(shape('y', 1), REMOTE);

    deliver('B', { kind: 'clear' });
    expect(store.getById('y')).toBeDefined();

    deliver('B', { kind: 'clear', tombstones: [tomb('x', 6, 'B'), tomb('y', 1, 'B')] });
    expect(store.getById('x')?.version).toBe(7);
    expect(store.getById('y')).toBeUndefined();

    deliver('C', { kind: 'upsert', element: shape('y', 1, 'A') });
    expect(store.getById('y')).toBeUndefined();
  });

  it('answers a peer snapshot request with its tombstones', () => {
    const { store, deliver, last } = setup();
    store.add(shape('x', 1));
    store.remove('x');

    deliver('B', { kind: 'request-snapshot' });

    expect(last('snapshot')).toMatchObject({ to: 'B', tombstones: [tomb('x', 2, 'A')] });
  });

  it("applies a hub remove with editor 'hub' and records its tombstone", () => {
    const { store, deliver } = setup('hub');
    store.add(shape('x', 9), REMOTE);

    deliver('hub', { kind: 'remove', id: 'x', version: 3, editor: 'hub' });
    expect(store.getById('x')).toBeUndefined();

    deliver('B', { kind: 'upsert', element: shape('x', 3, 'B') });
    expect(store.getById('x')).toBeUndefined();
  });

  it('stops and closes the transport on protocol 1 capabilities', () => {
    const { store, deliver, closed } = setup(null);

    deliver('P', {
      kind: 'capabilities',
      capabilities: { protocolVersion: 1, extensionKinds: [], elementEnvelope: true },
    });
    deliver('P', { kind: 'upsert', element: shape('x', 1, 'P') });

    expect(closed()).toBe(true);
    expect(store.getById('x')).toBeUndefined();
  });

  it('skips a legacy-shaped snapshot element and applies the others', () => {
    const { store, deliver } = setup('hub');
    const legacy: Record<string, unknown> = { ...shape('old', 1), zIndex: 0 };
    delete legacy['index'];
    delete legacy['version'];

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [legacy, shape('new', 1)] });

    expect(store.getById('old')).toBeUndefined();
    expect(store.getById('new')).toBeDefined();
  });
});

describe('SyncClient snapshot reconcile by version', () => {
  function joined() {
    const env = setup('hub');
    env.deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 3, 'B')] });
    return env;
  }

  it('pushes a local element newer than the snapshot copy', () => {
    const { store, deliver, last, reconcile } = joined();
    reconcile();

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 2, 'B', '#222222')] });

    expect(store.getById('x')).toMatchObject({ version: 3, fillColor: '#000000' });
    expect(last('upsert')?.element).toMatchObject({ id: 'x', version: 3, editor: 'A' });
  });

  it('does not re-push an editor-less room element at the same version', () => {
    const { store, deliver, sent, reconcile } = setup('hub');
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 1)] });
    reconcile();
    const before = sent.length;

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 1)] });

    expect(store.getById('x')?.version).toBe(1);
    expect(sent.slice(before).some((m) => m.includes('"upsert"'))).toBe(false);
  });

  it('takes a snapshot element newer than the local copy', () => {
    const { store, deliver, reconcile } = joined();
    reconcile();

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 4, 'B', '#444444')] });

    expect(store.getById('x')).toMatchObject({ version: 4, fillColor: '#444444' });
  });

  it('removes a local element its snapshot tombstone supersedes, even on bootstrap', () => {
    const { store, deliver } = setup('hub');
    store.add(shape('x', 2), REMOTE);

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [], tombstones: [tomb('x', 3, 'B')] });

    expect(store.getById('x')).toBeUndefined();
  });

  it('keeps and pushes a hub-known local element newer than its snapshot tombstone', () => {
    const { store, deliver, last, reconcile } = joined();
    reconcile();

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [], tombstones: [tomb('x', 2, 'B')] });

    expect(store.getById('x')?.version).toBe(3);
    expect(last('upsert')?.element).toMatchObject({ id: 'x', version: 3, editor: 'A' });
  });

  it('removes a hub-known element absent from the snapshot without a tombstone', () => {
    const { store, deliver, reconcile } = joined();
    reconcile();

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [] });

    expect(store.getById('x')).toBeUndefined();
  });

  it('keeps an element created during the resync that the reconcile snapshot lacks', () => {
    const { store, deliver, reconcile } = joined();
    reconcile();
    store.add(shape('y', 1));

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 3, 'B')] });

    expect(store.getById('y')).toBeDefined();
  });
});
