import { describe, it, expect, beforeEach } from 'vitest';
import { ElementStore, createNote, createShape, type CanvasElement } from '@fieldnotes/core';
import type { ElementChangeMeta } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
import type { AuthoritativeSnapshotContext } from './sync-client';
import type { SyncOp } from './protocol';
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
