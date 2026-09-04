import { describe, it, expect, beforeEach } from 'vitest';
import {
  ElementStore,
  createNote,
  createShape,
  fogEncodeBase64,
  FogManager,
  type CanvasElement,
  type Layer,
} from '@fieldnotes/core';
import type { ElementChangeMeta } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
import type { AuthoritativeSnapshotContext, RemoteLayerUpdate } from './sync-client';
import { LayerLedger } from './layer-ledger';
import type { FogMetaRecord, FogSnapshot, LayerRecord, SyncOp } from './protocol';
import type { SyncTransport } from './sync-transport';

interface BusEndpoint extends SyncTransport {
  sent: string[];
}

interface Bus {
  endpoint(): BusEndpoint;
}

function makeBus(selfEchoing = false): Bus {
  const endpoints: { handlers: Set<(m: string) => void>; ep: BusEndpoint }[] = [];

  function endpoint(): BusEndpoint {
    const handlers = new Set<(m: string) => void>();
    const sent: string[] = [];
    const ep: BusEndpoint = {
      sent,
      send(message: string): void {
        sent.push(message);
        for (const entry of endpoints) {
          if (!selfEchoing && entry.ep === ep) continue;
          entry.handlers.forEach((h) => h(message));
        }
      },
      onMessage(handler: (m: string) => void): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      close(): void {
        handlers.clear();
      },
    };
    endpoints.push({ handlers, ep });
    return ep;
  }

  return { endpoint };
}

function envelope(from: string, op: SyncOp): string {
  return JSON.stringify({ from, op });
}

describe('SyncClient', () => {
  let storeA: ElementStore;
  let storeB: ElementStore;
  let transportA: BusEndpoint;
  let transportB: BusEndpoint;
  let clientA: SyncClient;
  let clientB: SyncClient;

  beforeEach(() => {
    const bus = makeBus();
    storeA = new ElementStore();
    storeB = new ElementStore();
    transportA = bus.endpoint();
    transportB = bus.endpoint();
    clientA = new SyncClient({ store: storeA, transport: transportA, clientId: 'A' });
    clientB = new SyncClient({ store: storeB, transport: transportB, clientId: 'B' });
    clientA.start();
    clientB.start();
  });

  it('propagates a local add to the remote store, tagged origin remote, without echo', () => {
    let captured: ElementChangeMeta | undefined;
    storeB.on('add', (_el, meta) => {
      captured = meta;
    });

    const note = createNote({ position: { x: 10, y: 20 } });
    storeA.add(note);

    expect(storeB.getById(note.id)).toBeDefined();
    expect(captured?.origin).toBe('remote');
    // B applied the op as remote, so it must NOT re-broadcast it — only its
    // join request-snapshot (sent during start()) appears on B's transport.
    expect(transportB.sent.map((m) => JSON.parse(m).op.kind)).toEqual(['request-snapshot']);
    // No duplicate on the originating side.
    expect(storeA.count).toBe(1);
  });

  it('propagates a local update to the remote store', () => {
    const note = createNote({ position: { x: 0, y: 0 }, backgroundColor: '#aaaaaa' });
    storeA.add(note);

    storeA.update(note.id, { backgroundColor: '#bbbbbb' });

    const remote = storeB.getById(note.id);
    expect(remote?.type).toBe('note');
    if (remote?.type === 'note') {
      expect(remote.backgroundColor).toBe('#bbbbbb');
    }
  });

  it('propagates a local remove to the remote store', () => {
    const note = createNote({ position: { x: 0, y: 0 } });
    storeA.add(note);
    expect(storeB.getById(note.id)).toBeDefined();

    storeA.remove(note.id);

    expect(storeB.getById(note.id)).toBeUndefined();
  });

  it('propagates a local clear to the remote store', () => {
    storeA.add(createNote({ position: { x: 0, y: 0 } }));
    storeA.add(createNote({ position: { x: 5, y: 5 } }));
    expect(storeB.count).toBe(2);

    storeA.clear();

    expect(storeB.count).toBe(0);
  });

  it('applyOp adds when the id is unknown and updates when it exists', () => {
    const note = createNote({ position: { x: 1, y: 2 }, backgroundColor: '#111111' });

    // Deliver an upsert for an id storeB lacks -> add.
    transportA.send(envelope('A', { kind: 'upsert', element: note }));
    expect(storeB.getById(note.id)).toBeDefined();

    // Deliver a second upsert for the same id with a changed field -> update.
    const changed: CanvasElement = { ...note, backgroundColor: '#222222' } as CanvasElement;
    transportA.send(envelope('A', { kind: 'upsert', element: changed }));

    const remote = storeB.getById(note.id);
    if (remote?.type === 'note') {
      expect(remote.backgroundColor).toBe('#222222');
    }
    expect(storeB.count).toBe(1);
  });

  it('does not re-broadcast a change applied with a non-local origin', () => {
    const note = createNote({ position: { x: 0, y: 0 }, backgroundColor: '#abcabc' });
    storeA.add(note);
    const before = transportA.sent.length;

    storeA.update(note.id, { backgroundColor: '#defdef' }, { origin: 'remote' });

    expect(transportA.sent.length).toBe(before);
  });

  it('ignores its own echoed envelope', () => {
    const bus = makeBus(true);
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({ store, transport, clientId: 'A' });
    client.start();

    let ownEchoApplied = false;
    const markRemote = (_d: unknown, meta: ElementChangeMeta): void => {
      if (meta.origin === 'remote') ownEchoApplied = true;
    };
    store.on('add', markRemote);
    store.on('update', markRemote);

    expect(() => store.add(createNote({ position: { x: 0, y: 0 } }))).not.toThrow();

    // With the from===clientId guard, A never re-applies its own echo as remote.
    expect(ownEchoApplied).toBe(false);
    expect(store.count).toBe(1);
  });

  it('ignores valid-JSON envelopes with an unknown op kind or wrong shape (never clears)', () => {
    const existing = createNote({ position: { x: 0, y: 0 } });
    storeA.add(existing);
    expect(storeB.getById(existing.id)).toBeDefined();
    const before = storeB.count;

    // Unknown op kind must NOT fall through to a destructive clear.
    expect(() =>
      transportA.send(JSON.stringify({ from: 'X', op: { kind: 'bogus' } })),
    ).not.toThrow();
    // Wrong shape (no op) must not reach applyOp and throw.
    expect(() => transportA.send(JSON.stringify({ from: 'X' }))).not.toThrow();

    expect(storeB.count).toBe(before);
    expect(storeB.getById(existing.id)).toBeDefined();
  });

  it('rejects an upsert envelope carrying a structurally malformed element', () => {
    const before = storeB.count;
    const malformed = { ...shape(1), size: { w: 'wide', h: 10 } };

    transportA.send(JSON.stringify({ from: 'X', op: { kind: 'upsert', element: malformed } }));

    expect(storeB.count).toBe(before);
  });

  it('stops sending after stop() and tolerates a double stop', () => {
    clientA.stop();
    const before = transportA.sent.length;

    storeA.add(createNote({ position: { x: 0, y: 0 } }));

    expect(transportA.sent.length).toBe(before);
    expect(() => clientA.stop()).not.toThrow();
  });

  it('ignores malformed and empty messages', () => {
    const before = storeB.count;

    expect(() => transportA.send('{bad')).not.toThrow();
    expect(() => transportA.send('')).not.toThrow();

    expect(storeB.count).toBe(before);
  });
});

// createShape needs no DOMParser/jsdom, so these stay pure node.
function shape(x: number): CanvasElement {
  return createShape({ position: { x, y: x }, size: { w: 10, h: 10 } });
}

describe('SyncClient snapshot-on-join', () => {
  it('pulls a peer snapshot on join, tagged origin remote, without re-broadcasting', () => {
    const bus = makeBus();
    const storeA = new ElementStore();
    const storeB = new ElementStore();
    const transportA = bus.endpoint();
    const transportB = bus.endpoint();
    storeA.add(shape(1));
    storeA.add(shape(2));

    const clientA = new SyncClient({ store: storeA, transport: transportA, clientId: 'A' });
    clientA.start();

    const captured: (string | undefined)[] = [];
    storeB.on('add', (_el, meta) => captured.push(meta.origin));

    // Synchronous bus: the join round-trip (request -> snapshot -> merge) completes
    // entirely inside this start() call, which implicitly verifies start-ordering.
    const clientB = new SyncClient({ store: storeB, transport: transportB, clientId: 'B' });
    clientB.start();

    expect(storeB.count).toBe(2);
    expect(captured).toEqual(['remote', 'remote']);
    // B must NOT re-broadcast the merged elements — only its join request goes out.
    const sentOps = transportB.sent.map((m) => JSON.parse(m).op.kind);
    expect(sentOps).toEqual(['request-snapshot']);
  });

  it('applies all snapshot responses idempotently (two responders, no duplicates)', () => {
    const bus = makeBus();
    const storeA = new ElementStore();
    const storeC = new ElementStore();
    const storeB = new ElementStore();
    const a = shape(1);
    const b = shape(2);
    storeA.add(a);
    storeA.add(b);
    storeC.add(a);
    storeC.add(b);

    new SyncClient({ store: storeA, transport: bus.endpoint(), clientId: 'A' }).start();
    new SyncClient({ store: storeC, transport: bus.endpoint(), clientId: 'C' }).start();

    const clientB = new SyncClient({ store: storeB, transport: bus.endpoint(), clientId: 'B' });
    clientB.start();

    expect(storeB.count).toBe(2);
  });

  it('ignores a snapshot addressed to a different client', () => {
    const bus = makeBus();
    const storeB = new ElementStore();
    const transportB = bus.endpoint();
    const transportX = bus.endpoint();
    new SyncClient({ store: storeB, transport: transportB, clientId: 'B' }).start();

    transportX.send(envelope('X', { kind: 'snapshot', to: 'someone-else', elements: [shape(1)] }));

    expect(storeB.count).toBe(0);
  });

  it('starts cleanly in an empty session and sends only the request', () => {
    const bus = makeBus();
    const storeB = new ElementStore();
    const transportB = bus.endpoint();
    const clientB = new SyncClient({ store: storeB, transport: transportB, clientId: 'B' });

    expect(() => clientB.start()).not.toThrow();

    expect(storeB.count).toBe(0);
    expect(transportB.sent.map((m) => JSON.parse(m).op.kind)).toEqual(['request-snapshot']);
  });

  it('drops malformed snapshots and applies only valid elements within a mixed batch', () => {
    const bus = makeBus();
    const storeB = new ElementStore();
    const transportB = bus.endpoint();
    const transportX = bus.endpoint();
    new SyncClient({ store: storeB, transport: transportB, clientId: 'B' }).start();
    const before = storeB.count;

    // Missing to/elements -> rejected by isValidEnvelope.
    expect(() =>
      transportX.send(JSON.stringify({ from: 'X', op: { kind: 'snapshot' } })),
    ).not.toThrow();
    // Non-array elements -> rejected by isValidEnvelope.
    expect(() =>
      transportX.send(
        JSON.stringify({ from: 'X', op: { kind: 'snapshot', to: 'B', elements: 'nope' } }),
      ),
    ).not.toThrow();
    // Unknown op kind -> rejected.
    expect(() =>
      transportX.send(JSON.stringify({ from: 'X', op: { kind: 'bogus' } })),
    ).not.toThrow();

    expect(storeB.count).toBe(before);

    // Mixed batch: one valid element + one object with no id -> only the valid one is applied.
    const valid = shape(7);
    transportX.send(
      JSON.stringify({ from: 'X', op: { kind: 'snapshot', to: 'B', elements: [valid, {}] } }),
    );

    expect(storeB.count).toBe(1);
    expect(storeB.getById(valid.id)).toBeDefined();
  });

  it('responds to a request-snapshot with exactly one addressed snapshot envelope', () => {
    const bus = makeBus();
    const storeA = new ElementStore();
    const transportA = bus.endpoint();
    const transportX = bus.endpoint();
    storeA.add(shape(1));
    storeA.add(shape(2));
    new SyncClient({ store: storeA, transport: transportA, clientId: 'A' }).start();

    const before = transportA.sent.length;
    transportX.send(envelope('X', { kind: 'request-snapshot' }));

    const responses = transportA.sent
      .slice(before)
      .map((m) => JSON.parse(m).op)
      .filter((op: SyncOp) => op.kind === 'snapshot');
    expect(responses).toHaveLength(1);
    const resp = responses[0];
    expect(resp.to).toBe('X');
    expect(resp.elements).toHaveLength(2);
    expect(resp.elements).toEqual(storeA.snapshot());
  });
});

interface ReconnectTransport extends SyncTransport {
  sent: string[];
  deliver(message: string): void;
  triggerReconnect(): void;
}

function makeReconnectTransport(): ReconnectTransport {
  const messageHandlers = new Set<(m: string) => void>();
  const reconnectHandlers = new Set<() => void>();
  const sent: string[] = [];
  return {
    sent,
    send(message: string): void {
      sent.push(message);
    },
    onMessage(handler: (m: string) => void): () => void {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onReconnect(handler: () => void): () => void {
      reconnectHandlers.add(handler);
      return () => reconnectHandlers.delete(handler);
    },
    close(): void {
      messageHandlers.clear();
      reconnectHandlers.clear();
    },
    deliver(message: string): void {
      messageHandlers.forEach((h) => h(message));
    },
    triggerReconnect(): void {
      reconnectHandlers.forEach((h) => h());
    },
  };
}

function sentKinds(sent: string[]): string[] {
  return sent.map((m) => JSON.parse(m).op.kind);
}

describe('SyncClient resync-on-reconnect', () => {
  it('re-sends request-snapshot when the transport reconnects', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start();

    expect(sentKinds(transport.sent)).toEqual(['request-snapshot']);

    transport.triggerReconnect();

    expect(sentKinds(transport.sent)).toEqual(['request-snapshot', 'request-snapshot']);
  });

  it('MERGES the first snapshot into local state (keeps pre-existing local elements)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const local = shape(99); // element Y, present before start()
    store.add(local);

    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start();

    const remote = shape(1); // element X, from the hub
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [remote] }));

    // Merge: both the local Y and the remote X survive the first snapshot.
    expect(store.count).toBe(2);
    expect(store.getById(local.id)).toBeDefined();
    expect(store.getById(remote.id)).toBeDefined();
  });

  it('RECONCILES later snapshots — removes locals absent from the authoritative set, upserts canonical, origin remote, no re-broadcast', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const x = shape(1);
    const y = shape(99); // deleted-while-away
    const z = shape(2); // added-while-away

    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start();

    // First snapshot establishes joined state with X and Y.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, y] }));
    expect(store.count).toBe(2);

    // Capture every store write during the reconcile.
    const origins: (string | undefined)[] = [];
    store.on('add', (_el, meta) => origins.push(meta.origin));
    store.on('remove', (_el, meta) => origins.push(meta.origin));
    store.on('update', (_el, meta) => origins.push(meta.origin));
    const sentBefore = transport.sent.length;

    transport.triggerReconnect();
    // Authoritative set after the gap: Y is gone, Z is new, X still present.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, z] }));

    expect(store.getById(y.id)).toBeUndefined(); // removed
    expect(store.getById(x.id)).toBeDefined(); // kept
    expect(store.getById(z.id)).toBeDefined(); // added
    expect(store.count).toBe(2);

    // Every reconcile write is tagged origin remote.
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((o) => o === 'remote')).toBe(true);

    // The reconnect emits only a request-snapshot — no upsert/remove re-broadcast for X/Y/Z.
    const newSends = sentKinds(transport.sent.slice(sentBefore));
    expect(newSends).toEqual(['request-snapshot']);
  });

  it('the same snapshot payload merges before join but reconciles after (the contrast)', () => {
    const payload = (elements: CanvasElement[]): string =>
      envelope('hub', { kind: 'snapshot', to: 'B', elements });

    // Before join: payload [X] merges, so local Y is kept.
    const mergeStore = new ElementStore();
    const mergeTransport = makeReconnectTransport();
    const y = shape(99);
    mergeStore.add(y);
    new SyncClient({ store: mergeStore, transport: mergeTransport, clientId: 'B' }).start();
    mergeTransport.deliver(payload([shape(1)]));
    expect(mergeStore.getById(y.id)).toBeDefined();

    // After join: the SAME [X] payload reconciles, so local Y is removed.
    const reStore = new ElementStore();
    const reTransport = makeReconnectTransport();
    const y2 = shape(99);
    const reClient = new SyncClient({ store: reStore, transport: reTransport, clientId: 'B' });
    reClient.start();
    // First snapshot seeds joined state with X and Y2.
    reTransport.deliver(payload([shape(1), y2]));
    expect(reStore.getById(y2.id)).toBeDefined();
    // Reconnect + the SAME [X] payload now drops Y2.
    reTransport.triggerReconnect();
    reTransport.deliver(payload([shape(1)]));
    expect(reStore.getById(y2.id)).toBeUndefined();
  });

  it('starts cleanly when the transport has no onReconnect (B1-like), and merges its snapshot', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint(); // no onReconnect method
    const transportX = bus.endpoint();
    const local = shape(99);
    store.add(local);

    const client = new SyncClient({ store, transport, clientId: 'B' });
    expect(() => client.start()).not.toThrow();

    transportX.send(envelope('X', { kind: 'snapshot', to: 'B', elements: [shape(1)] }));

    // Merge path: local Y survives alongside the snapshot element.
    expect(store.count).toBe(2);
    expect(store.getById(local.id)).toBeDefined();
  });

  it('shields a local CREATE made during an in-flight resync (snapshot omits it)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const x = shape(1);
    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start();
    // Establish joined state with X.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));

    // Reconnect: request goes out, then BEFORE the reply the user creates Q locally.
    transport.triggerReconnect();
    const q = shape(42);
    store.add(q); // origin local -> onLocal records q in the resync window

    // The authoritative snapshot was taken before Q reached the hub, so it omits Q.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));

    // Q must survive the reconcile (the hub + peers already have it via the local broadcast).
    expect(store.getById(q.id)).toBeDefined();
    expect(store.getById(x.id)).toBeDefined();
    expect(store.count).toBe(2);
  });

  it('shields a local DELETE made during an in-flight resync (snapshot still contains it)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const x = shape(1);
    const w = shape(77);
    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start();
    // Establish joined state with X and W.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, w] }));

    // Reconnect: request goes out, then BEFORE the reply the user deletes W locally.
    transport.triggerReconnect();
    store.remove(w.id); // origin local -> onLocal records w in the resync window

    // The pre-delete snapshot still contains W.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, w] }));

    // W must stay deleted (the shield skips re-upserting it).
    expect(store.getById(w.id)).toBeUndefined();
    expect(store.getById(x.id)).toBeDefined();
    expect(store.count).toBe(1);
  });

  it('clears the resync state after a merge-branch snapshot (drop during initial join)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const client = new SyncClient({ store, transport, clientId: 'B' });
    client.start(); // joined=false; initial request-snapshot sent

    // Socket drops DURING the initial-join handshake, before any snapshot arrives.
    transport.triggerReconnect(); // onReconnect -> resyncPending=true, still !joined

    // The FIRST snapshot arrives while joined is still false -> the !joined MERGE branch,
    // which sets joined=true. With the fix it also finalizes the resync (resyncPending=false).
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    // A local add AFTER the merge. With the fix resyncPending is false, so X is NOT tracked
    // in the shield set.
    const local = { ...shape(1), id: 'X' };
    store.add(local);

    // A later (reconcile-branch, joined=true) snapshot that OMITS X — e.g. a second/late
    // responder to the still-pending request. No reconnect in between, so onReconnect does
    // NOT re-clear the shield set.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    // X was removed by reconcile — NOT shielded. Without the fix, the merge branch left
    // resyncPending stuck true, so the local add recorded X in touchedDuringResync and the
    // reconcile would skip removing it (getById('X') still defined -> failure).
    expect(store.getById('X')).toBeUndefined();
  });
});

describe('SyncClient fog convergence', () => {
  const definition = {
    version: 1 as const,
    generation: 'gen-1',
    bounds: { x: 0, y: 0, w: 256, h: 128 },
    cellSize: 1,
    tileCells: 128 as const,
    base: 'covered' as const,
  };
  const dataA = fogEncodeBase64(new Uint8Array(2048).fill(0xff));
  const changedBytes = new Uint8Array(2048).fill(0xff);
  changedBytes[0] = 0x7f;
  const dataB = fogEncodeBase64(changedBytes);

  function fogSnapshot(meta: FogMetaRecord, tiles: FogSnapshot['tiles'] = []): FogSnapshot {
    return { meta, tiles };
  }

  function fogClient() {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const manager = new FogManager();
    const client = new SyncClient({
      store,
      transport,
      clientId: 'A',
      fog: { manager },
    });
    client.start();
    return { transport, manager, client };
  }

  it('fails fast when fog sync is configured with an invalid ordering identity', () => {
    expect(
      () =>
        new SyncClient({
          store: new ElementStore(),
          transport: makeReconnectTransport(),
          clientId: '😀',
          fog: { manager: new FogManager() },
        }),
    ).toThrow(/printable ASCII/);
  });

  it('merges untouched remote tiles with exact local edits made during resync', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [
          { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub', data: dataA },
        ]),
      }),
    );

    // The real WebSocket transport flushes buffered writes before onReconnect,
    // so capture the local edit before the reconnect callback fires.
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data: dataB }] });
    transport.triggerReconnect();
    transport.deliver(
      envelope('hub', {
        kind: 'fog-patch',
        generation: 'gen-1',
        tiles: [{ generation: 'gen-1', x: 0, y: 0, version: 10, editor: 'hub', data: dataA }],
      }),
    );
    const beforeSnapshot = transport.sent.length;
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [
          { generation: 'gen-1', x: 0, y: 0, version: 10, editor: 'hub', data: dataA },
          { generation: 'gen-1', x: 1, y: 0, version: 1, editor: 'hub', data: dataA },
        ]),
      }),
    );

    expect(manager.getState()?.tiles).toEqual([
      { x: 0, y: 0, data: dataB },
      { x: 1, y: 0, data: dataA },
    ]);
    const repushed = transport.sent
      .slice(beforeSnapshot)
      .map((message) => JSON.parse(message).op as SyncOp)
      .filter((op): op is Extract<SyncOp, { kind: 'fog-patch' }> => op.kind === 'fog-patch');
    expect(repushed).toEqual([
      {
        kind: 'fog-patch',
        generation: 'gen-1',
        tiles: [{ generation: 'gen-1', x: 0, y: 0, version: 11, editor: 'A', data: dataB }],
      },
    ]);
  });

  it('rejects a same-generation bounds shrink so removed coordinates cannot resurrect', () => {
    const { transport, manager } = fogClient();
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 1, editor: 'hub', definition }, [
          { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub', data: dataA },
          { generation: 'gen-1', x: 1, y: 0, version: 1, editor: 'hub', data: dataB },
        ]),
      }),
    );

    expect(() =>
      transport.deliver(
        envelope('B', {
          kind: 'fog-meta',
          record: {
            version: 2,
            editor: 'B',
            definition: { ...definition, bounds: { x: 0, y: 0, w: 128, h: 128 } },
          },
        }),
      ),
    ).not.toThrow();
    expect(manager.getState()?.definition.bounds.w).toBe(256);
    expect(manager.getState()?.tiles).toEqual([
      { x: 0, y: 0, data: dataA },
      { x: 1, y: 0, data: dataB },
    ]);
  });

  it('does not resurrect an old-generation local tile across a remote reset', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    transport.deliver(
      envelope('hub', { kind: 'snapshot', to: 'A', elements: [], fog: fogSnapshot(meta) }),
    );
    transport.triggerReconnect();
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data: dataA }] });
    const resetDefinition = { ...definition, generation: 'gen-2' };
    const beforeSnapshot = transport.sent.length;
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 2, editor: 'hub', definition: resetDefinition }),
      }),
    );
    expect(manager.getState()?.definition.generation).toBe('gen-2');
    expect(manager.getState()?.tiles).toEqual([]);
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual(
      [],
    );
  });

  it('does not replay a local tile after a newer live peer edit supersedes it', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [
          { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub', data: dataA },
        ]),
      }),
    );
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data: dataB }] });
    const peerRecord = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 3,
      editor: 'B',
      data: dataA,
    };
    transport.deliver(
      envelope('B', { kind: 'fog-patch', generation: 'gen-1', tiles: [peerRecord] }),
    );

    transport.triggerReconnect();
    const beforeSnapshot = transport.sent.length;
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [peerRecord]),
      }),
    );

    expect(manager.getState()?.tiles).toEqual([{ x: 0, y: 0, data: dataA }]);
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual(
      [],
    );
  });

  it('does not replay an ordinary local tile superseded only in the reconnect snapshot', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    const original = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'hub',
      data: dataA,
    };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [original]),
      }),
    );
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data: dataB }] });
    transport.triggerReconnect();
    const beforeSnapshot = transport.sent.length;
    const peerRecord = { ...original, version: 3, editor: 'B' };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [peerRecord]),
      }),
    );

    expect(manager.getState()?.tiles).toEqual([{ x: 0, y: 0, data: dataA }]);
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual(
      [],
    );
  });

  it('does not replay a local generation after a newer live peer reset supersedes it', () => {
    const { transport, manager } = fogClient();
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 1, editor: 'hub', definition }),
      }),
    );
    manager.setBounds({ x: 0, y: 0, w: 100, h: 128 });
    const peerDefinition = { ...definition, generation: 'gen-peer' };
    const peerMeta = { version: 3, editor: 'B', definition: peerDefinition };
    transport.deliver(envelope('B', { kind: 'fog-meta', record: peerMeta }));

    transport.triggerReconnect();
    const beforeSnapshot = transport.sent.length;
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(peerMeta),
      }),
    );

    expect(manager.getState()?.definition.generation).toBe('gen-peer');
    expect(manager.getState()?.tiles).toEqual([]);
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual(
      [],
    );
  });

  it('does not replay an ordinary local generation superseded in the reconnect snapshot', () => {
    const { transport, manager } = fogClient();
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 1, editor: 'hub', definition }),
      }),
    );
    manager.setBounds({ x: 0, y: 0, w: 100, h: 128 });
    transport.triggerReconnect();
    const beforeSnapshot = transport.sent.length;
    const peerDefinition = { ...definition, generation: 'gen-peer' };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 3, editor: 'B', definition: peerDefinition }),
      }),
    );

    expect(manager.getState()?.definition.generation).toBe('gen-peer');
    expect(manager.getState()?.tiles).toEqual([]);
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual(
      [],
    );
  });

  it('keeps pending local intent when an authoritative tile is semantically invalid', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    const original = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'hub',
      data: dataA,
    };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [original]),
      }),
    );
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data: dataB }] });
    transport.deliver(
      envelope('hub', {
        kind: 'fog-patch',
        generation: 'gen-1',
        tiles: [
          {
            ...original,
            version: 2,
            data: fogEncodeBase64(new Uint8Array(2048)),
          },
        ],
      }),
    );

    transport.triggerReconnect();
    const beforeSnapshot = transport.sent.length;
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta, [original]),
      }),
    );

    expect(manager.getState()?.tiles).toEqual([{ x: 0, y: 0, data: dataB }]);
    const replayed = transport.sent
      .slice(beforeSnapshot)
      .map((message) => JSON.parse(message).op as SyncOp)
      .filter((op) => op.kind === 'fog-patch');
    expect(replayed).toHaveLength(1);
  });

  it('publishes a local shrink as a new generation followed by canonical preserved tiles', () => {
    const { transport, manager } = fogClient();
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 1, editor: 'hub', definition }, [
          { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub', data: dataA },
        ]),
      }),
    );
    const before = transport.sent.length;
    manager.setBounds({ x: 0, y: 0, w: 100, h: 128 });
    const ops = transport.sent.slice(before).map((message) => JSON.parse(message).op as SyncOp);
    expect(ops[0]?.kind).toBe('fog-meta');
    expect(ops[1]?.kind).toBe('fog-patch');
    if (ops[0]?.kind !== 'fog-meta' || ops[1]?.kind !== 'fog-patch') return;
    const generation = ops[0].record.definition?.generation;
    expect(generation).toBeTruthy();
    expect(generation).not.toBe('gen-1');
    expect(ops[1].generation).toBe(generation);
    expect(ops[1].tiles).toHaveLength(1);
    expect(manager.getState()?.tiles[0]?.data).not.toBe(dataA);
  });

  it('re-pushes a local disable made during resync', () => {
    const { transport, manager } = fogClient();
    const meta = { version: 1, editor: 'hub', definition };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ ...meta, version: 10 }),
      }),
    );
    transport.triggerReconnect();
    manager.disable();
    const beforeSnapshot = transport.sent.length;

    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(meta),
      }),
    );

    expect(manager.getState()).toBeNull();
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual([
      { kind: 'fog-meta', record: { version: 11, editor: 'A' } },
    ]);
  });

  it('re-pushes a buffered disable after a hub correction arrives before the snapshot', () => {
    const { transport, manager } = fogClient();
    const authoritative = { version: 10, editor: 'hub', definition };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(authoritative),
      }),
    );
    manager.disable();
    transport.triggerReconnect();
    transport.deliver(envelope('hub', { kind: 'fog-meta', record: authoritative }));
    const beforeSnapshot = transport.sent.length;

    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(authoritative),
      }),
    );

    expect(manager.getState()).toBeNull();
    expect(transport.sent.slice(beforeSnapshot).map((message) => JSON.parse(message).op)).toEqual([
      { kind: 'fog-meta', record: { version: 11, editor: 'A' } },
    ]);
  });

  it('lets an authoritative meta correction replace a newer optimistic ledger record', () => {
    const { transport, manager } = fogClient();
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot({ version: 1, editor: 'server', definition }),
      }),
    );
    manager.setBounds({ x: 0, y: 0, w: 200, h: 128 }); // optimistic v2
    transport.deliver(
      envelope('hub', {
        kind: 'fog-meta',
        record: { version: 1, editor: 'server', definition },
      }),
    );

    manager.setBounds({ x: 0, y: 0, w: 180, h: 128 });
    const last = JSON.parse(transport.sent[transport.sent.length - 1] ?? '') as {
      op: { kind: string; record: FogMetaRecord };
    };
    expect(last.op.kind).toBe('fog-meta');
    expect(last.op.record.version).toBe(2);
  });

  it('restores staged tiles after a rejected disable and requests authoritative reconciliation', () => {
    const { transport, manager } = fogClient();
    const authoritative = { version: 1, editor: 'server', definition };
    transport.deliver(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        fog: fogSnapshot(authoritative, [
          { generation: 'gen-1', x: 0, y: 0, version: 4, editor: 'server', data: dataA },
        ]),
      }),
    );
    manager.disable();
    transport.deliver(envelope('hub', { kind: 'fog-meta', record: authoritative }));

    expect(manager.getState()?.tiles).toEqual([{ x: 0, y: 0, data: dataA }]);
    expect(JSON.parse(transport.sent[transport.sent.length - 1] ?? '').op).toEqual({
      kind: 'request-snapshot',
    });
  });
});

describe('presence channel', () => {
  it('sendPresence emits a presence envelope; a not-started client sends nothing', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({ store, transport, clientId: 'A' });
    client.sendPresence({ x: 1 }); // not started yet → silent
    expect(transport.sent).toEqual([]);
    client.start();
    transport.sent.length = 0;
    client.sendPresence({ x: 1, y: 2 });
    expect(transport.sent).toHaveLength(1);
    expect(JSON.parse(transport.sent[0] as string)).toEqual({
      from: 'A',
      op: { kind: 'presence', data: { x: 1, y: 2 } },
    });
  });

  it('onPresence fires for a peer and never touches the store', () => {
    const bus = makeBus();
    const storeA = new ElementStore();
    const storeB = new ElementStore();
    const a = new SyncClient({ store: storeA, transport: bus.endpoint(), clientId: 'A' });
    const b = new SyncClient({ store: storeB, transport: bus.endpoint(), clientId: 'B' });
    a.start();
    b.start();
    const seen: [string, unknown][] = [];
    b.onPresence((from, data) => seen.push([from, data]));
    a.sendPresence({ cursor: 'here' });
    expect(seen).toEqual([['A', { cursor: 'here' }]]);
    expect(storeB.snapshot()).toEqual([]); // presence never enters the store
  });

  it('drops own presence via the echo guard', () => {
    const bus = makeBus(true); // self-echoing
    const store = new ElementStore();
    const a = new SyncClient({ store, transport: bus.endpoint(), clientId: 'A' });
    a.start();
    let fired = 0;
    a.onPresence(() => fired++);
    a.sendPresence({ x: 1 });
    expect(fired).toBe(0); // env.from === clientId → dropped
  });

  it('onPresenceLeave fires; unsubscribe stops delivery', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const injector = bus.endpoint(); // stands in for the hub
    const b = new SyncClient({ store, transport: bus.endpoint(), clientId: 'B' });
    b.start();
    const left: string[] = [];
    const off = b.onPresenceLeave((from) => left.push(from));
    injector.send(JSON.stringify({ from: 'ghost', op: { kind: 'presence-leave' } }));
    expect(left).toEqual(['ghost']);
    off();
    injector.send(JSON.stringify({ from: 'ghost2', op: { kind: 'presence-leave' } }));
    expect(left).toEqual(['ghost']); // unsubscribed
  });
});

describe('authoritative bootstrap/reconcile hooks (resolveLocalOnly)', () => {
  function upsertsOf(sent: string[]): (CanvasElement & { audience?: string })[] {
    return sent
      .map((m) => JSON.parse(m) as { op: { kind: string; element?: CanvasElement } })
      .filter((e) => e.op.kind === 'upsert' && e.op.element)
      .map((e) => e.op.element as CanvasElement & { audience?: string });
  }

  it('bootstrap: reports phase and hub-unknown local-only elements; preserve re-pushes them', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(50); // present before start(), unknown to the hub
    store.add(seed);
    const contexts: AuthoritativeSnapshotContext[] = [];
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: (context) => {
        contexts.push(context);
        return { preserve: context.localOnly.map((entry) => entry.element.id) };
      },
    });
    client.start();

    const hubEl = shape(1);
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [hubEl] }));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.phase).toBe('bootstrap');
    expect(contexts[0]?.localOnly).toEqual([{ element: seed, hubKnown: false }]);
    expect(contexts[0]?.snapshot).toEqual([hubEl]);
    // The preserved seed stays local AND is re-pushed to the hub as a normal upsert.
    expect(store.getById(seed.id)).toBeDefined();
    expect(upsertsOf(transport.sent).map((el) => el.id)).toEqual([seed.id]);
  });

  it('bootstrap: discard removes the local-only element without broadcasting a remove', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const stale = shape(51);
    store.add(stale);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: () => ({ discard: [stale.id] }),
    });
    client.start();

    const origins: (string | undefined)[] = [];
    store.on('remove', (_el, meta) => origins.push(meta.origin));
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [shape(1)] }));

    expect(store.getById(stale.id)).toBeUndefined();
    expect(origins).toEqual(['remote']);
    expect(sentKinds(transport.sent)).toEqual(['request-snapshot']); // no remove/upsert broadcast
  });

  it('bootstrap: unlisted local-only elements keep the legacy merge behavior (kept, not pushed)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(52);
    store.add(seed);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: () => ({}),
    });
    client.start();

    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [shape(1)] }));

    expect(store.getById(seed.id)).toBeDefined();
    expect(sentKinds(transport.sent)).toEqual(['request-snapshot']);
  });

  it('reconcile: preserve keeps and re-pushes a hub-unknown element while a hub-known absent element is still removed', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(53); // never pushed: unlisted at bootstrap
    store.add(seed);
    const contexts: AuthoritativeSnapshotContext[] = [];
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: (context) => {
        contexts.push(context);
        if (context.phase === 'bootstrap') return {}; // leave the seed unpushed
        return {
          preserve: context.localOnly
            .filter((entry) => !entry.hubKnown)
            .map((entry) => entry.element.id),
        };
      },
    });
    client.start();

    const x = shape(1);
    const w = shape(77); // hub-known, deleted while away
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, w] }));
    expect(store.count).toBe(3);

    const sentBefore = transport.sent.length;
    transport.triggerReconnect();
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));

    expect(contexts[1]?.phase).toBe('reconcile');
    const byId = new Map(contexts[1]?.localOnly.map((entry) => [entry.element.id, entry.hubKnown]));
    expect(byId.get(seed.id)).toBe(false);
    expect(byId.get(w.id)).toBe(true);
    // Deleted-while-away stays deleted (no zombie); the hub-unknown seed survives and is re-pushed.
    expect(store.getById(w.id)).toBeUndefined();
    expect(store.getById(seed.id)).toBeDefined();
    expect(upsertsOf(transport.sent.slice(sentBefore)).map((el) => el.id)).toEqual([seed.id]);
  });

  it('reconcile: an element sent locally while live counts as hub-known (own creation deleted while away)', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const contexts: AuthoritativeSnapshotContext[] = [];
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: (context) => {
        contexts.push(context);
        return {
          preserve: context.localOnly
            .filter((entry) => !entry.hubKnown)
            .map((entry) => entry.element.id),
        };
      },
    });
    client.start();
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    const mine = shape(60);
    store.add(mine); // sent to the hub while live

    transport.triggerReconnect();
    // The hub deleted it while we were away: absent from the resync snapshot.
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    expect(contexts[1]?.localOnly).toEqual([{ element: mine, hubKnown: true }]);
    expect(store.getById(mine.id)).toBeUndefined();
  });

  it('re-pushed elements carry the resolveAudience stamp', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(54);
    store.add(seed);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveAudience: () => 'dm',
      resolveLocalOnly: (context) => ({
        preserve: context.localOnly.map((entry) => entry.element.id),
      }),
    });
    client.start();

    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    const pushed = upsertsOf(transport.sent);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.audience).toBe('dm');
  });

  it('excludes elements touched during the resync window from localOnly', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const contexts: AuthoritativeSnapshotContext[] = [];
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: (context) => {
        contexts.push(context);
        return {};
      },
    });
    client.start();
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    transport.triggerReconnect();
    const q = shape(42);
    store.add(q); // local create during the resync window — already shielded and sent

    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    expect(contexts[1]?.localOnly).toEqual([]);
    expect(store.getById(q.id)).toBeDefined();
  });

  it('preserve wins over discard for the same id', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(55);
    store.add(seed);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: () => ({ preserve: [seed.id], discard: [seed.id] }),
    });
    client.start();

    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    expect(store.getById(seed.id)).toBeDefined();
    expect(upsertsOf(transport.sent).map((el) => el.id)).toEqual([seed.id]);
  });

  it('ignores resolution ids that are not local-only', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: () => ({ preserve: ['nope'], discard: ['also-nope'] }),
    });
    client.start();

    const hubEl = shape(1);
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [hubEl] }));

    expect(store.getById(hubEl.id)).toBeDefined();
    expect(sentKinds(transport.sent)).toEqual(['request-snapshot']);
  });

  it('a throwing hook falls back to default semantics and does not wedge the resync state machine', () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const seed = shape(56);
    store.add(seed);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      resolveLocalOnly: () => {
        throw new Error('host hook exploded');
      },
    });
    client.start();

    // Bootstrap with a throwing hook: default merge, no crash.
    const x = shape(1);
    expect(() =>
      transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] })),
    ).not.toThrow();
    expect(store.getById(seed.id)).toBeDefined(); // default merge keeps it silently

    // Reconcile with a throwing hook: default destructive semantics still apply.
    transport.triggerReconnect();
    expect(() =>
      transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] })),
    ).not.toThrow();
    expect(store.getById(seed.id)).toBeUndefined(); // removed by the default reconcile

    // resyncPending cleared: a local add after the snapshot is NOT shielded and a later
    // reconcile removes it normally.
    const later = shape(57);
    store.add(later);
    transport.triggerReconnect();
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x, later] }));
    transport.triggerReconnect();
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));
    expect(store.getById(later.id)).toBeUndefined();
  });

  it("firstSnapshot 'reconcile' makes the first snapshot destructive and shields pre-snapshot local ops", () => {
    const store = new ElementStore();
    const transport = makeReconnectTransport();
    const stale = shape(58); // in the store from a previous client, hub no longer has it
    store.add(stale);
    const known = new Set<string>([stale.id]);
    const client = new SyncClient({
      store,
      transport,
      clientId: 'B',
      firstSnapshot: 'reconcile',
      hubKnownIds: known,
    });
    client.start();

    const fresh = shape(59);
    store.add(fresh); // local op before the first snapshot — must be shielded

    const x = shape(1);
    transport.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));

    expect(store.getById(stale.id)).toBeUndefined(); // destructive first snapshot
    expect(store.getById(fresh.id)).toBeDefined(); // touched during the pending resync
    expect(store.getById(x.id)).toBeDefined();
  });

  it('shares hub knowledge across successive clients via hubKnownIds', () => {
    const known = new Set<string>();
    const store = new ElementStore();
    const first = makeReconnectTransport();
    const clientA = new SyncClient({
      store,
      transport: first,
      clientId: 'B',
      hubKnownIds: known,
    });
    clientA.start();
    const x = shape(1);
    first.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [x] }));
    clientA.stop();

    // A successor client (e.g. a managed rebuild) sees x as hub-known.
    const second = makeReconnectTransport();
    const contexts: AuthoritativeSnapshotContext[] = [];
    const clientB = new SyncClient({
      store,
      transport: second,
      clientId: 'B',
      firstSnapshot: 'reconcile',
      hubKnownIds: known,
      resolveLocalOnly: (context) => {
        contexts.push(context);
        return {};
      },
    });
    clientB.start();
    second.deliver(envelope('hub', { kind: 'snapshot', to: 'B', elements: [] }));

    expect(contexts[0]?.phase).toBe('reconcile');
    expect(contexts[0]?.localOnly).toEqual([{ element: x, hubKnown: true }]);
    expect(store.getById(x.id)).toBeUndefined();
  });
});

describe('audience stamping (resolveAudience)', () => {
  function lastUpsert(
    sent: string[],
  ): { kind: string; element: CanvasElement & { audience?: string } } | undefined {
    for (let i = sent.length - 1; i >= 0; i--) {
      const item = sent[i];
      if (item === undefined) continue;
      const env = JSON.parse(item) as {
        op: { kind: string; element?: CanvasElement & { audience?: string } };
      };
      if (env.op.kind === 'upsert' && env.op.element)
        return { kind: 'upsert', element: env.op.element };
    }
    return undefined;
  }

  it('does not add an audience field when no resolver is configured', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({ store, transport, clientId: 'A' });
    client.start();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }));
    const up = lastUpsert(transport.sent);
    expect(up).toBeDefined();
    expect(up && 'audience' in up.element).toBe(false);
  });

  it('stamps the resolver-returned tag on outgoing upserts', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({ store, transport, clientId: 'A', resolveAudience: () => 'dm' });
    client.start();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }));
    const up = lastUpsert(transport.sent);
    expect(up?.element.audience).toBe('dm');
  });

  it('omits the field when the resolver returns undefined', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({
      store,
      transport,
      clientId: 'A',
      resolveAudience: () => undefined,
    });
    client.start();
    store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }));
    const up = lastUpsert(transport.sent);
    expect(up && 'audience' in up.element).toBe(false);
  });

  it('does not stamp remove ops', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const client = new SyncClient({ store, transport, clientId: 'A', resolveAudience: () => 'dm' });
    client.start();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    store.add(el);
    store.remove(el.id);
    const removeEnv = transport.sent
      .map((m) => JSON.parse(m) as { op: { kind: string } })
      .reverse()
      .find((e) => e.op.kind === 'remove');
    expect(removeEnv).toBeDefined();
    expect(JSON.stringify(removeEnv)).not.toContain('audience');
  });
});

describe('SyncClient layer sync', () => {
  function layerDef(overrides: Partial<Layer> = {}): Layer {
    return {
      id: 'layer-x',
      name: 'Layer X',
      visible: true,
      locked: false,
      order: 100,
      opacity: 1,
      ...overrides,
    };
  }

  interface LayerPeer {
    store: ElementStore;
    transport: BusEndpoint;
    client: SyncClient;
    updates: RemoteLayerUpdate[];
  }

  function layerPeer(
    bus: Bus,
    clientId: string,
    options: { ledger?: LayerLedger; applyLayer?: (u: RemoteLayerUpdate) => void } = {},
  ): LayerPeer {
    const store = new ElementStore();
    const transport = bus.endpoint();
    const updates: RemoteLayerUpdate[] = [];
    const client = new SyncClient({
      store,
      transport,
      clientId,
      layers: {
        applyLayer: options.applyLayer ?? ((u) => updates.push(u)),
        ...(options.ledger ? { ledger: options.ledger } : {}),
      },
    });
    return { store, transport, client, updates };
  }

  it('propagates a published layer definition to an opted-in peer', () => {
    const bus = makeBus();
    const a = layerPeer(bus, 'A');
    const b = layerPeer(bus, 'B');
    a.client.start();
    b.client.start();

    a.client.publishLayerUpsert(layerDef({ name: 'Tokens' }));

    expect(b.updates).toHaveLength(1);
    const update = b.updates[0];
    expect(update?.source).toBe('op');
    expect(update?.record).toEqual({
      id: 'layer-x',
      version: 1,
      editor: 'A',
      definition: layerDef({ name: 'Tokens' }),
    });
  });

  it('propagates a published removal as a tombstone that blocks stale resurrection', () => {
    const bus = makeBus();
    const a = layerPeer(bus, 'A');
    const b = layerPeer(bus, 'B');
    a.client.start();
    b.client.start();

    a.client.publishLayerUpsert(layerDef());
    a.client.publishLayerRemove('layer-x');
    expect(b.updates).toHaveLength(2);
    expect(b.updates[1]?.record.definition).toBeUndefined();

    // A stale v1 upsert from a third party must not resurrect the layer.
    const c = bus.endpoint();
    c.send(
      envelope('C', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'stale' }),
        version: 1,
        editor: 'C',
      }),
    );
    expect(b.updates).toHaveLength(2);
  });

  it('drops stale versions and resolves equal-version ties by editor on every peer', () => {
    const bus = makeBus();
    const b = layerPeer(bus, 'B');
    b.client.start();
    const x = bus.endpoint();
    const y = bus.endpoint();

    x.send(
      envelope('X', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'from X' }),
        version: 2,
        editor: 'X',
      }),
    );
    y.send(
      envelope('Y', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'from Y' }),
        version: 2,
        editor: 'Y',
      }),
    );
    x.send(
      envelope('X', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'old' }),
        version: 1,
        editor: 'X',
      }),
    );

    // v2/X applies, v2/Y wins the tie, v1/X is stale.
    expect(b.updates.map((u) => u.record.definition?.name)).toEqual(['from X', 'from Y']);
  });

  it('treats a layer op from the hub as an authoritative correction, even when older', () => {
    const bus = makeBus();
    const a = layerPeer(bus, 'A');
    a.client.start();
    a.client.publishLayerUpsert(layerDef({ name: 'local v1' }));
    a.client.publishLayerUpsert(layerDef({ name: 'local v2' }));

    const hub = bus.endpoint();
    hub.send(
      envelope('hub', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'room truth' }),
        version: 1,
        editor: 'Z',
      }),
    );

    expect(a.updates.map((u) => u.record.definition?.name)).toEqual(['room truth']);
    // The correction overwrote the ledger: the next local edit builds on it.
    a.client.publishLayerUpsert(layerDef({ name: 'after correction' }));
    const lastSent = JSON.parse(a.transport.sent[a.transport.sent.length - 1] ?? '') as {
      op: { version: number };
    };
    expect(lastSent.op.version).toBe(2);
  });

  it('a client without the layers option ignores layer traffic and answers snapshots without layers', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const transport = bus.endpoint();
    const plain = new SyncClient({ store, transport, clientId: 'P' });
    plain.start();

    const remote = bus.endpoint();
    remote.send(
      envelope('R', { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: 'R' }),
    );
    remote.send(envelope('R', { kind: 'request-snapshot' }));

    const reply = transport.sent
      .map((m) => JSON.parse(m) as { op: { kind: string; layers?: unknown } })
      .find((e) => e.op.kind === 'snapshot');
    expect(reply).toBeDefined();
    expect(reply && 'layers' in reply.op).toBe(false);
  });

  it('answers a peer snapshot request with its ledger records', () => {
    const bus = makeBus();
    const a = layerPeer(bus, 'A');
    a.client.start();
    a.client.publishLayerUpsert(layerDef());

    const remote = bus.endpoint();
    remote.send(envelope('R', { kind: 'request-snapshot' }));

    const reply = a.transport.sent
      .map((m) => JSON.parse(m) as { op: { kind: string; layers?: LayerRecord[] } })
      .find((e) => e.op.kind === 'snapshot');
    expect(reply?.op.layers).toEqual([
      { id: 'layer-x', version: 1, editor: 'A', definition: layerDef() },
    ]);
  });

  it('applies snapshot layers before snapshot elements, skipping invalid records', () => {
    const bus = makeBus();
    const order: string[] = [];
    const a = layerPeer(bus, 'A', { applyLayer: (u) => order.push(`layer:${u.record.id}`) });
    a.store.on('add', (el) => order.push(`element:${el.id}`));

    const hub = bus.endpoint();
    a.client.start(); // sends request-snapshot
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    hub.send(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [el],
        layers: [
          { id: 'layer-x', version: 1, editor: 'B', definition: layerDef() },
          { bogus: true } as unknown as LayerRecord,
        ],
      }),
    );

    expect(order).toEqual(['layer:layer-x', `element:${el.id}`]);
  });

  it('re-pushes locally-newer layer records after a snapshot merge', () => {
    const bus = makeBus();
    const ledger = new LayerLedger();
    ledger.recordUpsert(layerDef({ name: 'local only' }), 'A');
    ledger.recordUpsert(layerDef({ id: 'layer-y', name: 'newer local' }), 'A');
    ledger.applyRemote({
      id: 'layer-y',
      version: 2,
      editor: 'A',
      definition: layerDef({ id: 'layer-y', name: 'newer local v2' }),
    });

    const a = layerPeer(bus, 'A', { ledger });
    const hub = bus.endpoint();
    const received: string[] = [];
    hub.onMessage((m) => {
      const env = JSON.parse(m) as { op: { kind: string; layer?: Layer; version?: number } };
      if (env.op.kind === 'layer-upsert' && env.op.layer) {
        received.push(`${env.op.layer.id}@${String(env.op.version)}`);
      }
    });

    a.client.start();
    hub.send(
      envelope('hub', {
        kind: 'snapshot',
        to: 'A',
        elements: [],
        layers: [
          // hub already has layer-y at v1 — local v2 is newer and must be pushed
          { id: 'layer-y', version: 1, editor: 'A', definition: layerDef({ id: 'layer-y' }) },
        ],
      }),
    );

    expect(received.sort()).toEqual(['layer-x@1', 'layer-y@2']);
    // The hub's stale layer-y v1 must not have clobbered the newer local record.
    expect(ledger.get('layer-y')?.version).toBe(2);
  });

  it('keeps syncing after the applyLayer hook throws', () => {
    const bus = makeBus();
    let calls = 0;
    const a = layerPeer(bus, 'A', {
      applyLayer: () => {
        calls += 1;
        throw new Error('host exploded');
      },
    });
    a.client.start();
    const remote = bus.endpoint();
    remote.send(
      envelope('R', { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: 'R' }),
    );
    remote.send(
      envelope('R', {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'again' }),
        version: 2,
        editor: 'R',
      }),
    );
    expect(calls).toBe(2);

    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
    remote.send(envelope('R', { kind: 'upsert', element: el }));
    expect(a.store.getById(el.id)).toBeDefined();
  });

  it('publish methods throw without the layers option and on invalid definitions', () => {
    const bus = makeBus();
    const store = new ElementStore();
    const plain = new SyncClient({ store, transport: bus.endpoint(), clientId: 'P' });
    expect(() => plain.publishLayerUpsert(layerDef())).toThrow(/not enabled/);
    expect(() => plain.publishLayerRemove('x')).toThrow(/not enabled/);

    const a = layerPeer(bus, 'A');
    expect(() => a.client.publishLayerUpsert({ ...layerDef(), order: Number.NaN })).toThrow(
      /valid layer definition/,
    );
  });
});
