/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Viewport, createShape } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import { createCurrentCapabilities } from './capabilities';
import type { SyncOp } from './protocol';
import { SyncClient } from './sync-client';
import type { SyncTransport } from './sync-transport';

function shape(version: number, fillColor: string, editor?: string): CanvasElement {
  const element = createShape({
    index: 'a0',
    version,
    position: { x: 0, y: 0 },
    size: { w: 10, h: 10 },
    fillColor,
  });
  return editor === undefined ? { ...element, id: 'x' } : { ...element, id: 'x', editor };
}

interface Peer {
  readonly viewport: Viewport;
  readonly client: SyncClient;
  readonly sent: SyncOp[];
  receive(message: string): void;
}

const peers: Peer[] = [];

function createPeer(id: string): Peer {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  document.body.appendChild(container);
  const viewport = new Viewport(container);
  const sent: SyncOp[] = [];
  let receive = (_message: string): void => undefined;
  const transport: SyncTransport = {
    send: (message) => sent.push((JSON.parse(message) as { op: SyncOp }).op),
    onMessage: (handler) => {
      receive = handler;
      return () => {
        receive = (_message: string): void => undefined;
      };
    },
    close: () => undefined,
  };
  const client = new SyncClient({
    store: viewport.store,
    transport,
    clientId: id,
    flushIntervalMs: 0,
  });
  client.start();
  const peer = { viewport, client, sent, receive: (message: string) => receive(message) };
  peers.push(peer);
  return peer;
}

function connect(a: Peer, b: Peer): void {
  a.receive(
    JSON.stringify({
      from: 'B',
      op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
    }),
  );
  b.receive(
    JSON.stringify({
      from: 'A',
      op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
    }),
  );
  a.sent.length = 0;
  b.sent.length = 0;
}

function dataOps(peer: Peer): SyncOp[] {
  return peer.sent.filter(
    (op) =>
      op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear' || op.kind === 'batch',
  );
}

function deliver(from: Peer, to: Peer, sender: string): void {
  for (const op of dataOps(from)) to.receive(JSON.stringify({ from: sender, op }));
  from.sent.length = 0;
}

function lastData(peer: Peer): SyncOp | undefined {
  return dataOps(peer).at(-1);
}

function seed(peer: Peer, element: CanvasElement): void {
  peer.viewport.store.add(element, { origin: 'remote' });
}

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.client.dispose();
    peer.viewport.destroy();
  }
  document.body.replaceChildren();
});

describe('SyncClient history replay', () => {
  it('publishes viewport update undo/redo/undo revisions and converges with a peer', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    seed(b, shape(1, '#111111', 'B'));

    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#222222' }));
    const outbound = [lastData(a)];
    deliver(a, b, 'A');
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 2, fillColor: '#222222' });
    expect(b.viewport.store.getById('x')).toMatchObject({ fillColor: '#222222' });

    expect(a.viewport.undo()).toBe(true);
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 1, fillColor: '#111111' });
    expect(b.viewport.store.getById('x')).toMatchObject({ fillColor: '#111111' });
    expect(a.viewport.history).toMatchObject({ undoCount: 0, redoCount: 1 });

    expect(a.viewport.redo()).toBe(true);
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    expect(a.viewport.undo()).toBe(true);
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 1, fillColor: '#111111' });
    expect(b.viewport.store.getById('x')).toMatchObject({ fillColor: '#111111' });
    expect(a.viewport.history).toMatchObject({ undoCount: 0, redoCount: 1 });
    expect(outbound).toMatchObject([
      { kind: 'upsert', element: { version: 2, editor: 'A' } },
      { kind: 'upsert', element: { version: 3, editor: 'A' } },
      { kind: 'upsert', element: { version: 4, editor: 'A' } },
      { kind: 'upsert', element: { version: 5, editor: 'A' } },
    ]);
  });

  it('replays viewport adds as add, remove, upsert, remove revisions', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);

    a.viewport.transaction(() => a.viewport.store.add(shape(1, '#111111')));
    const outbound = [lastData(a)];
    deliver(a, b, 'A');
    a.viewport.undo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    a.viewport.redo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    a.viewport.undo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');

    expect(outbound).toMatchObject([
      { kind: 'upsert', element: { version: 1, editor: 'A' } },
      { kind: 'remove', version: 2, editor: 'A' },
      { kind: 'upsert', element: { version: 3, editor: 'A' } },
      { kind: 'remove', version: 4, editor: 'A' },
    ]);
    expect(a.viewport.store.getById('x')).toBeUndefined();
    expect(b.viewport.store.getById('x')).toBeUndefined();
    a.viewport.redo();
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 1 });
  });

  it('replays viewport deletes above the accepted revision and converges with a peer', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(9, '#111111', 'B'));
    seed(b, shape(9, '#111111', 'B'));

    a.viewport.transaction(() => a.viewport.store.remove('x'));
    const outbound = [lastData(a)];
    deliver(a, b, 'A');
    a.viewport.undo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 9 });
    a.viewport.redo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');
    a.viewport.undo();
    outbound.push(lastData(a));
    deliver(a, b, 'A');

    expect(outbound).toMatchObject([
      { kind: 'remove', version: 10, editor: 'A' },
      { kind: 'upsert', element: { version: 11, editor: 'A' } },
      { kind: 'remove', version: 12, editor: 'A' },
      { kind: 'upsert', element: { version: 13, editor: 'A' } },
    ]);
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 9 });
    expect(b.viewport.store.getById('x')).toMatchObject({ fillColor: '#111111' });
  });

  it('projects an ordinary effective revision into snapshots', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#222222' }));
    b.sent.length = 0;

    a.receive(JSON.stringify({ from: 'B', op: { kind: 'request-snapshot' } }));
    const snapshot = a.sent.find((op) => op.kind === 'snapshot');
    expect(snapshot).toMatchObject({
      kind: 'snapshot',
      elements: [{ id: 'x', version: 2, editor: 'A', fillColor: '#222222' }],
    });
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 2, fillColor: '#222222' });
  });

  it('ignores stale live operations after history replay and advances ordinary edits and clears', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#222222' }));
    a.viewport.undo();
    a.receive(
      JSON.stringify({ from: 'B', op: { kind: 'upsert', element: shape(2, '#333333', 'B') } }),
    );
    a.receive(
      JSON.stringify({ from: 'B', op: { kind: 'remove', id: 'x', version: 2, editor: 'B' } }),
    );
    expect(a.viewport.store.getById('x')).toMatchObject({ version: 1, fillColor: '#111111' });

    a.sent.length = 0;
    a.receive(JSON.stringify({ from: 'B', op: { kind: 'request-snapshot' } }));
    expect(a.sent.find((op) => op.kind === 'snapshot')).toMatchObject({
      elements: [{ version: 3, editor: 'A' }],
    });
    a.sent.length = 0;
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#444444' }));
    expect(lastData(a)).toMatchObject({ kind: 'upsert', element: { version: 4, editor: 'A' } });
    a.viewport.transaction(() => a.viewport.store.remove('x'));
    expect(lastData(a)).toMatchObject({ kind: 'remove', version: 5, editor: 'A' });
  });

  it('uses an authoritative correction as the next ordinary publication floor', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#222222' }));
    a.viewport.undo();
    a.receive(
      JSON.stringify({ from: 'hub', op: { kind: 'upsert', element: shape(1, '#333333', 'hub') } }),
    );
    a.sent.length = 0;
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#444444' }));
    expect(lastData(a)).toMatchObject({ kind: 'upsert', element: { version: 2, editor: 'A' } });
  });

  it('retains history replay revisions when the same client restarts', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#222222' }));
    a.viewport.undo();
    a.client.stop();
    a.client.start();
    a.receive(
      JSON.stringify({
        from: 'B',
        op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
      }),
    );
    a.sent.length = 0;
    a.viewport.transaction(() => a.viewport.store.update('x', { fillColor: '#444444' }));
    expect(lastData(a)).toMatchObject({ kind: 'upsert', element: { version: 4, editor: 'A' } });
  });

  it('attributes a lifted ordinary resurrection and its snapshot to the local client', () => {
    const a = createPeer('A');
    const b = createPeer('B');
    connect(a, b);
    seed(a, shape(1, '#111111', 'B'));
    a.viewport.transaction(() => a.viewport.store.remove('x'));
    a.sent.length = 0;
    a.viewport.transaction(() => a.viewport.store.add(shape(1, '#222222', 'B')));
    expect(lastData(a)).toMatchObject({ kind: 'upsert', element: { version: 3, editor: 'A' } });
    a.sent.length = 0;
    a.receive(JSON.stringify({ from: 'B', op: { kind: 'request-snapshot' } }));
    expect(a.sent.find((op) => op.kind === 'snapshot')).toMatchObject({
      elements: [{ version: 3, editor: 'A' }],
    });
  });
});
