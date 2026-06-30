import { describe, it, expect, beforeEach } from 'vitest';
import { ElementStore, createNote, createShape, type CanvasElement } from '@fieldnotes/core';
import type { ElementChangeMeta } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
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

  it('rejects an upsert envelope carrying a malformed element (no id/type)', () => {
    const before = storeB.count;

    transportA.send(JSON.stringify({ from: 'X', op: { kind: 'upsert', element: {} } }));

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
  return createShape({ position: { x, y: x }, size: { width: 10, height: 10 } });
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
});
