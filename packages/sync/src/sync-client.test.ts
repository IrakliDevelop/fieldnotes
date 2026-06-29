import { describe, it, expect, beforeEach } from 'vitest';
import { ElementStore, createNote, type CanvasElement } from '@fieldnotes/core';
import type { ElementChangeMeta } from '@fieldnotes/core';
import { SyncClient, type SyncOp } from './sync-client';
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
    // B applied the op as remote, so it must NOT re-broadcast it.
    expect(transportB.sent).toHaveLength(0);
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
