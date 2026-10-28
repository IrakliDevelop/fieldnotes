import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRegistry, ElementStore, createHtmlElement, createShape } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import {
  createTemplate,
  registerVttElementTypes,
  templateElementTypeDefinition,
} from '@fieldnotes/vtt';
import { SyncClient } from './sync-client';
import { createCurrentCapabilities } from './capabilities';
import { SYNC_LIMITS, hasJsonDepthAtMost } from './limits';
import type { SyncOp } from './protocol';
import type { SyncTransport } from './sync-transport';

const REMOTE = { origin: 'remote' };
/** Loses an equal-version tie to this client, whose id is 'A'. */
const LOSING_EDITOR = '0';

function shape(id: string, version = 1, editor = 'B'): CanvasElement {
  const base = createShape({
    index: 'a0',
    version,
    position: { x: 0, y: 0 },
    size: { w: 10, h: 10 },
  });
  return { ...base, id, editor };
}

interface Frame {
  readonly at: number;
  readonly raw: string;
  readonly op: SyncOp;
}

function setup(
  options: { flushIntervalMs?: number; registry?: ElementRegistry; echo?: boolean } = {},
) {
  const store = new ElementStore();
  const frames: Frame[] = [];
  let receive: (message: string) => void = () => undefined;
  let reconnect: () => void = () => undefined;
  let closed: () => void = () => undefined;
  const echoes: string[] = [];
  const transport: SyncTransport = {
    send: (raw) => {
      frames.push({ at: Date.now(), raw, op: (JSON.parse(raw) as { op: SyncOp }).op });
      const reply = echoes.shift();
      if (options.echo && reply !== undefined) receive(reply);
    },
    onMessage: (handler) => {
      receive = handler;
      return () => undefined;
    },
    onReconnect: (handler) => {
      reconnect = handler;
      return () => undefined;
    },
    onClose: (handler) => {
      closed = handler;
      return () => undefined;
    },
    close: () => undefined,
  };
  const client = new SyncClient({
    store,
    transport,
    clientId: 'A',
    flushIntervalMs: options.flushIntervalMs,
    elementRegistry: options.registry,
  });
  client.start();
  const deliver = (from: string, op: SyncOp | Record<string, unknown>): void =>
    receive(JSON.stringify({ from, op }));
  const capabilities = (from: string, opBatching = false): void =>
    deliver(from, {
      kind: 'capabilities',
      capabilities: { ...createCurrentCapabilities([]), ...(opBatching ? { opBatching: 1 } : {}) },
    });
  /** Element-bearing frames sent so far, dropping handshake and snapshot traffic. */
  const elementFrames = (): Frame[] =>
    frames.filter(({ op }) => op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'batch');
  const sentKinds = (): string[] => frames.map(({ op }) => op.kind);
  return {
    store,
    client,
    frames,
    deliver,
    capabilities,
    elementFrames,
    sentKinds,
    reconnect: () => reconnect(),
    socketClosed: () => closed(),
    queueEcho: (from: string, op: SyncOp) => echoes.push(JSON.stringify({ from, op })),
  };
}

function idsOf(op: SyncOp): string[] {
  if (op.kind === 'upsert') return [op.element.id];
  if (op.kind === 'remove') return [op.id];
  if (op.kind === 'batch') return op.ops.flatMap(idsOf);
  return [];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncClient outgoing queue', () => {
  it('coalesces 100 updates to one element within 50 ms into one upsert of the final state', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    for (let i = 1; i <= 100; i++) store.update('x', { position: { x: i, y: 0 } });
    vi.advanceTimersByTime(50);

    const frames = elementFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.op).toMatchObject({
      kind: 'upsert',
      element: { id: 'x', version: 101, editor: 'A', position: { x: 100, y: 0 } },
    });
  });

  it.each([
    ['an opBatching hub', true],
    ['a hub without opBatching', false],
  ] as const)('drags 50 elements for 1 s at 120 Hz to %s in at most 21 flushes', (_, batching) => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('hub', batching);
    for (let i = 0; i < 50; i++) store.add(shape(`e${String(i)}`), REMOTE);

    for (let tick = 1; tick <= 120; tick++) {
      for (let i = 0; i < 50; i++) store.update(`e${String(i)}`, { position: { x: tick, y: 0 } });
      vi.advanceTimersByTime(1000 / 120);
    }
    vi.advanceTimersByTime(50);

    const frames = elementFrames();
    const flushes = new Set(frames.map(({ at }) => at));
    expect(flushes.size).toBeLessThanOrEqual(21);
    if (batching) {
      expect(frames.length).toBe(flushes.size);
      expect(frames.every(({ op }) => op.kind === 'batch')).toBe(true);
    } else {
      expect(frames.length).toBe(flushes.size * 50);
      expect(frames.every(({ op }) => op.kind === 'upsert')).toBe(true);
    }
    expect(store.getById('e7')).toMatchObject({ position: { x: 120, y: 0 } });
  });

  it('does not re-send an element a remote remove deleted during a pending drag', () => {
    const { store, deliver, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 5, y: 0 } });
    deliver('B', { kind: 'remove', id: 'x', version: 3, editor: 'B' });
    vi.advanceTimersByTime(50);

    expect(store.getById('x')).toBeUndefined();
    expect(elementFrames()).toEqual([]);
  });

  it('drops a queued upsert when a winning remote upsert of the same id is applied', () => {
    const { store, deliver, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 5, y: 0 } });
    deliver('B', { kind: 'upsert', element: shape('x', 5, 'B') });
    vi.advanceTimersByTime(50);

    expect(store.getById('x')).toMatchObject({ version: 5, editor: 'B' });
    expect(elementFrames()).toEqual([]);
  });

  it('sends only the remove for an id removed after a pending upsert, after earlier queued ops', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);
    store.add(shape('y'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    store.update('y', { position: { x: 1, y: 0 } });
    store.remove('x');
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => op)).toEqual([
      expect.objectContaining({ kind: 'upsert', element: expect.objectContaining({ id: 'y' }) }),
      { kind: 'remove', id: 'x', version: 3, editor: 'A' },
    ]);
  });

  it('appends an upsert queued after a queued remove of the same id', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.remove('x');
    store.add(shape('x', 1, 'A'));
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['remove', 'upsert']);
    expect(elementFrames()[1]?.op).toMatchObject({ element: { id: 'x', version: 3 } });
  });

  it('keeps order and dedupes past 1000 queued ids', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P');
    const ids = Array.from({ length: 1000 }, (_, i) => `e${String(i)}`);
    for (const id of ids) store.add(shape(id), REMOTE);

    for (const id of ids) store.update(id, { position: { x: 1, y: 0 } });
    store.update('e500', { position: { x: 2, y: 0 } });
    store.remove('e3');
    store.add(shape('e1000', 1, 'A'));
    vi.advanceTimersByTime(50);

    const sent = elementFrames().map(({ op }) => `${op.kind}:${idsOf(op).join()}`);
    expect(sent).toEqual([
      ...ids.filter((id) => id !== 'e3').map((id) => `upsert:${id}`),
      'remove:e3',
      'upsert:e1000',
    ]);
    expect(elementFrames()[499]?.op).toMatchObject({ element: { id: 'e500', position: { x: 2 } } });
  });

  it('flushes the queue before a clear', () => {
    const { store, capabilities, sentKinds } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);
    store.add(shape('y'), REMOTE);

    store.remove('x');
    store.clear();

    expect(sentKinds().slice(-2)).toEqual(['remove', 'clear']);
  });

  it('holds queued work and the snapshot request until reconnect admission', () => {
    const { store, capabilities, reconnect, sentKinds } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    reconnect();

    expect(sentKinds().slice(-1)).toEqual(['capabilities']);
    capabilities('P');
    expect(sentKinds().slice(-2)).toEqual(['upsert', 'request-snapshot']);
  });

  it('batches queued element edits after the queued snapshot request on opBatching admission', () => {
    const { store, capabilities, frames } = setup();
    store.add(shape('x'));
    store.add(shape('y'));
    vi.advanceTimersByTime(50);

    capabilities('hub', true);

    expect(frames.map(({ op }) => op)).toContainEqual({ kind: 'request-snapshot' });
    expect(frames.map(({ op }) => op)).toContainEqual({
      kind: 'batch',
      ops: [
        expect.objectContaining({ kind: 'upsert', element: expect.objectContaining({ id: 'x' }) }),
        expect.objectContaining({ kind: 'upsert', element: expect.objectContaining({ id: 'y' }) }),
      ],
    });
    expect(frames.map(({ op }) => op.kind).slice(-2)).toEqual(['request-snapshot', 'batch']);
  });

  it('flushes the queue before answering a snapshot request', () => {
    const { store, deliver, capabilities, sentKinds } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    deliver('P', { kind: 'request-snapshot' });

    expect(sentKinds().slice(-2)).toEqual(['upsert', 'snapshot']);
  });

  it('flushes the queue on stop and sends nothing afterwards', () => {
    const { store, client, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    client.stop();
    expect(elementFrames()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(elementFrames()).toHaveLength(1);
  });

  it('keeps an edit queued just before a reconcile snapshot by the live tie-break', () => {
    const { store, deliver, capabilities, reconnect, elementFrames } = setup();
    capabilities('hub');
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 5, 'B')] });
    reconnect();
    capabilities('hub');

    store.update('x', { position: { x: 9, y: 0 } });
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 6, LOSING_EDITOR)] });
    vi.advanceTimersByTime(50);

    expect(store.getById('x')).toMatchObject({ version: 6, position: { x: 9, y: 0 } });
    expect(elementFrames().at(-1)?.op).toMatchObject({
      kind: 'upsert',
      element: { id: 'x', version: 6, editor: 'A', position: { x: 9, y: 0 } },
    });
  });

  it('shields an upsert queued before a reconnect from the reconcile snapshot', () => {
    const { store, deliver, capabilities, reconnect, elementFrames } = setup();
    capabilities('hub');
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 5, 'B')] });

    store.update('x', { position: { x: 9, y: 0 } });
    reconnect();
    capabilities('hub');
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [shape('x', 6, LOSING_EDITOR)] });

    expect(store.getById('x')).toMatchObject({ version: 6, position: { x: 9, y: 0 } });
    expect(elementFrames().at(-1)?.op).toMatchObject({
      kind: 'upsert',
      element: { id: 'x', version: 6, editor: 'A', position: { x: 9, y: 0 } },
    });
  });

  it('sends individual ops after reconnecting to a hub without opBatching', () => {
    const { store, capabilities, reconnect, elementFrames } = setup();
    capabilities('hub', true);
    store.add(shape('x'), REMOTE);
    store.update('x', { position: { x: 1, y: 0 } });
    vi.advanceTimersByTime(50);
    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['batch']);

    reconnect();
    capabilities('hub', false);
    store.update('x', { position: { x: 2, y: 0 } });
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['batch', 'upsert']);
  });

  it('sends an element created while the socket is down as a single upsert a 0.28 hub keeps', () => {
    const { store, deliver, capabilities, reconnect, socketClosed, elementFrames } = setup();
    capabilities('hub', true);
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [] });

    socketClosed();
    store.add(shape('n', 1, 'A'));
    vi.advanceTimersByTime(50);
    reconnect();
    capabilities('hub', false);
    // A 0.28 hub drops batch frames, so its snapshot holds only the single upserts.
    const accepted = elementFrames().flatMap(({ op }) =>
      op.kind === 'upsert' ? [op.element] : [],
    );
    deliver('hub', { kind: 'snapshot', to: 'A', elements: accepted });

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['upsert']);
    expect(store.getById('n')).toBeDefined();
  });

  it('batches again once a reconnected hub confirms opBatching', () => {
    const { store, capabilities, reconnect, socketClosed, elementFrames } = setup();
    capabilities('hub', true);
    store.add(shape('x'), REMOTE);

    socketClosed();
    reconnect();
    capabilities('hub', true);
    store.update('x', { position: { x: 1, y: 0 } });
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['batch']);
  });

  it('drops the queue instead of flushing it to a peer below protocol 2', () => {
    const { store, deliver, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    deliver('Q', {
      kind: 'capabilities',
      capabilities: { ...createCurrentCapabilities([]), protocolVersion: 1 },
    });
    vi.advanceTimersByTime(50);

    expect(elementFrames()).toEqual([]);
  });

  it('does not batch for a peer that advertised opBatching', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P', true);
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['upsert']);
  });

  it('never applies a queued op to the store twice', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('hub', true);
    store.add(shape('x'), REMOTE);
    let updates = 0;
    store.on('update', () => updates++);

    store.update('x', { position: { x: 1, y: 0 } });
    vi.advanceTimersByTime(50);
    store.update('x', { position: { x: 2, y: 0 } });
    vi.advanceTimersByTime(50);
    expect(updates).toBe(2);

    // Re-adding over the remove's tombstone takes the flush-time version lift: one store write.
    store.remove('x');
    store.add(shape('x', 1, 'A'));
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);

    expect(updates).toBe(3);
    expect(store.getById('x')).toMatchObject({ version: 5 });
    expect(elementFrames().at(-1)?.op).toEqual({
      kind: 'batch',
      ops: [
        { kind: 'remove', id: 'x', version: 4, editor: 'A' },
        { kind: 'upsert', element: expect.objectContaining({ id: 'x', version: 5, editor: 'A' }) },
      ],
    });
  });

  it('splits a batch by UTF-8 bytes and sends an op too large for a batch alone', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('hub', true);
    const text = (id: string, chars: number): CanvasElement => ({
      ...createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 1, h: 1 },
        data: { s: 'é'.repeat(chars) },
      }),
      id,
    });

    for (const id of ['a', 'b', 'c']) store.add(text(id, 200_000));
    store.add(text('huge', 524_280));
    store.add(text('d', 10));
    vi.advanceTimersByTime(50);

    const frames = elementFrames();
    expect(frames.map(({ op }) => [op.kind, idsOf(op)])).toEqual([
      ['batch', ['a', 'b']],
      ['batch', ['c']],
      ['upsert', ['huge']],
      ['batch', ['d']],
    ]);
    for (const frame of frames.filter(({ op }) => op.kind === 'batch')) {
      expect(new TextEncoder().encode(frame.raw).length).toBeLessThanOrEqual(
        SYNC_LIMITS.maxFrameBytes,
      );
    }
  });

  it('sends an element too deep for a batch frame as a single op, in order', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('hub', true);
    let data: Record<string, unknown> = {};
    for (let i = 0; i < 27; i++) data = { n: data };
    const deep: CanvasElement = {
      ...createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 }, data }),
      id: 'deep',
    };

    store.add(shape('a', 1, 'A'));
    store.add(deep);
    store.add(shape('b', 1, 'A'));
    vi.advanceTimersByTime(50);

    const frames = elementFrames();
    expect(frames.map(({ op }) => [op.kind, idsOf(op)])).toEqual([
      ['batch', ['a']],
      ['upsert', ['deep']],
      ['batch', ['b']],
    ]);
    for (const { raw } of frames) {
      expect(hasJsonDepthAtMost(raw, SYNC_LIMITS.maxFrameJsonDepth)).toBe(true);
    }
  });

  it('caps a batch at maxBatchOps ops', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('hub', true);

    for (let i = 0; i < SYNC_LIMITS.maxBatchOps + 1; i++) store.add(shape(`e${String(i)}`, 1, 'A'));
    vi.advanceTimersByTime(50);

    expect(elementFrames().map(({ op }) => idsOf(op).length)).toEqual([SYNC_LIMITS.maxBatchOps, 1]);
  });

  it('sends a remove issued from a store listener during a synchronous flush once, in order', () => {
    const { store, capabilities, queueEcho, elementFrames } = setup({
      flushIntervalMs: 0,
      echo: true,
    });
    capabilities('P');
    store.add(shape('c'), REMOTE);
    store.add(shape('d'), REMOTE);
    store.add(shape('x'), REMOTE);
    store.on('update', ({ current }, meta) => {
      if (current.id === 'c' && meta.origin === 'remote') store.remove('d');
    });
    queueEcho('P', { kind: 'upsert', element: shape('c', 4, 'P') });

    store.update('x', { position: { x: 1, y: 0 } });

    expect(elementFrames().map(({ op }) => [op.kind, idsOf(op)])).toEqual([
      ['upsert', ['x']],
      ['remove', ['d']],
    ]);
  });
});

describe('SyncClient flush cadence', () => {
  it('sends synchronously with flushIntervalMs 0', () => {
    const { store, capabilities, elementFrames } = setup({ flushIntervalMs: 0 });
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    store.update('x', { position: { x: 2, y: 0 } });

    expect(elementFrames().map(({ op }) => op.kind)).toEqual(['upsert', 'upsert']);
  });

  it('flushes the first op of an idle period on the next tick and waits the interval after', () => {
    const { store, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    expect(elementFrames()).toHaveLength(0);
    vi.advanceTimersByTime(0);
    expect(elementFrames()).toHaveLength(1);

    vi.advanceTimersByTime(20);
    store.update('x', { position: { x: 2, y: 0 } });
    vi.advanceTimersByTime(29);
    expect(elementFrames()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(elementFrames()).toHaveLength(2);
  });

  it('flush() sends the queue immediately', () => {
    const { store, client, capabilities, elementFrames } = setup();
    capabilities('P');
    store.add(shape('x'), REMOTE);

    store.update('x', { position: { x: 1, y: 0 } });
    client.flush();

    expect(elementFrames()).toHaveLength(1);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects flushIntervalMs %s',
    (flushIntervalMs) => {
      expect(
        () =>
          new SyncClient({
            store: new ElementStore(),
            transport: {
              send: () => undefined,
              onMessage: () => () => undefined,
              close: () => undefined,
            },
            flushIntervalMs,
          }),
      ).toThrow(RangeError);
    },
  );

  it('advertises opBatching in its capabilities', () => {
    const { frames } = setup();
    expect(frames[0]?.op).toMatchObject({ kind: 'capabilities', capabilities: { opBatching: 1 } });
  });
});

describe('SyncClient incoming batch', () => {
  it('applies the ops of a batch in order', () => {
    const { store, deliver, capabilities } = setup();
    capabilities('hub', true);

    deliver('hub', {
      kind: 'batch',
      ops: [
        { kind: 'upsert', element: shape('x', 1, 'B') },
        { kind: 'remove', id: 'x', version: 2, editor: 'B' },
        { kind: 'upsert', element: shape('y', 1, 'B') },
      ],
    });

    expect(store.getById('x')).toBeUndefined();
    expect(store.getById('y')).toMatchObject({ version: 1 });
  });

  it('drops a pre-admission batch carrying an extension upsert', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const { store, deliver, capabilities } = setup({ registry });
    const template = templateElementTypeDefinition.wrap(
      createTemplate({ position: { x: 0, y: 0 }, index: 'a0', templateShape: 'circle', radius: 3 }),
    );

    deliver('hub', { kind: 'batch', ops: [{ kind: 'upsert', element: template }] });
    expect(store.getById(template.id)).toBeUndefined();
    capabilities('hub');

    expect(store.getById(template.id)).toBeUndefined();
  });

  it('applies a batch remove after the held upsert it targets', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const { store, deliver, capabilities } = setup({ registry });
    const template = templateElementTypeDefinition.wrap(
      createTemplate({ position: { x: 0, y: 0 }, index: 'a0', templateShape: 'circle', radius: 3 }),
    );

    deliver('hub', { kind: 'upsert', element: template });
    deliver('hub', {
      kind: 'batch',
      ops: [{ kind: 'remove', id: template.id, version: template.version + 1, editor: 'hub' }],
    });
    capabilities('hub');

    expect(store.getById(template.id)).toBeUndefined();
  });
});
