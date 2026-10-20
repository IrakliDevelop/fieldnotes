import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementStore, createNote, createShape, createStroke } from '@fieldnotes/core';
import type { ShapeElement } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
import { createCurrentCapabilities } from './capabilities';
import { SyncLimitError } from './limits';
import { parseLegacyEnvelope } from './protocol';
import type { SyncOp } from './protocol';
import type { SyncTransport } from './sync-transport';

const REMOTE = { origin: 'remote' };

function shape(id: string, version = 1): ShapeElement {
  const base = createShape({
    index: 'a0',
    version,
    position: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  });
  return { ...base, id, editor: 'B' };
}

function setup(options: { tombstoneRetentionMs?: number; hubKnownIds?: Set<string> } = {}) {
  const store = new ElementStore();
  const raw: string[] = [];
  let receive: (message: string) => void = () => undefined;
  let closed = false;
  const transport: SyncTransport = {
    send: (message) => raw.push(message),
    onMessage: (handler) => {
      receive = handler;
      return () => undefined;
    },
    close: () => {
      closed = true;
    },
  };
  const client = new SyncClient({
    store,
    transport,
    clientId: 'A',
    flushIntervalMs: 0,
    ...options,
  });
  client.start();
  const deliver = (from: string, op: SyncOp | Record<string, unknown>): void =>
    receive(JSON.stringify({ from, op }));
  deliver('P', { kind: 'capabilities', capabilities: createCurrentCapabilities([]) });
  const ops = (): SyncOp[] => raw.map((message) => (JSON.parse(message) as { op: SyncOp }).op);
  const sentIds = (): string[] =>
    ops().flatMap((op) =>
      op.kind === 'upsert' ? [op.element.id] : op.kind === 'remove' ? [op.id] : [],
    );
  return { store, raw, ops, sentIds, deliver, isClosed: () => closed };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SyncClient sender-side limits', () => {
  it('skips an oversize stroke, reports a SyncLimitError and still sends the rest', () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { store, sentIds } = setup();
    const points = Array.from({ length: 100_001 }, () => ({ x: 0, y: 0, pressure: 0.5 }));
    const big = { ...createStroke({ points, index: 'a0' }), id: 'big' };

    store.add(big);
    store.add(shape('ok'));

    expect(sentIds()).toEqual(['ok']);
    expect(reportError).toHaveBeenCalledTimes(1);
    const error: unknown = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(SyncLimitError);
    expect(error).toMatchObject({ elementId: 'big', limit: 'maxStrokePoints' });
    expect(store.getById('big')).toBeDefined();
  });

  it('skips an oversize op without reportError present', () => {
    vi.stubGlobal('reportError', undefined);
    const { store, sentIds } = setup();
    store.add({ ...shape('s'), fillColor: 'x'.repeat(257) });

    expect(sentIds()).toEqual([]);
  });
});

describe('SyncClient hubKnownIds', () => {
  it('drops ids on local remove, remote remove and clear', () => {
    const known = new Set<string>();
    const { store, deliver } = setup({ hubKnownIds: known });
    store.add(shape('local'));
    store.add(shape('kept'));
    deliver('hub', { kind: 'upsert', element: shape('remote') });
    expect([...known].sort()).toEqual(['kept', 'local', 'remote']);

    store.remove('local');
    deliver('hub', { kind: 'remove', id: 'remote', version: 2, editor: 'B' });
    expect([...known]).toEqual(['kept']);

    store.clear();
    expect(known.size).toBe(0);
  });

  it('keeps an id known after a remote upsert replaces its type', () => {
    const known = new Set<string>();
    const { store, deliver } = setup({ hubKnownIds: known });
    store.add(shape('x'), REMOTE);

    deliver('hub', {
      kind: 'upsert',
      element: { ...createNote({ index: 'a0', version: 2, position: { x: 0, y: 0 } }), id: 'x' },
    });

    expect(store.getById('x')?.type).toBe('note');
    expect(known.has('x')).toBe(true);
  });

  it('marks an id known from a stale remote upsert', () => {
    const known = new Set<string>();
    const { store, deliver } = setup({ hubKnownIds: known });
    store.add(shape('x', 5), REMOTE);

    deliver('P', { kind: 'upsert', element: shape('x', 1) });

    expect(store.getById('x')?.version).toBe(5);
    expect(known.has('x')).toBe(true);
  });
});

describe('SyncClient tombstone retention', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects tombstoneRetentionMs %s',
    (tombstoneRetentionMs) => {
      expect(
        () =>
          new SyncClient({
            store: new ElementStore(),
            transport: {
              send: () => undefined,
              onMessage: () => () => undefined,
              close: () => undefined,
            },
            tombstoneRetentionMs,
          }),
      ).toThrow(new RangeError('tombstoneRetentionMs must be a positive finite number'));
    },
  );

  it('prunes an expired tombstone from a peer snapshot answer and keeps a fresh one', () => {
    const { store, raw, deliver } = setup({ tombstoneRetentionMs: 1000 });
    store.add(shape('old'), REMOTE);
    store.add(shape('fresh'), REMOTE);
    store.remove('old');
    vi.setSystemTime(1500);
    store.remove('fresh');
    raw.length = 0;

    deliver('P', { kind: 'request-snapshot' });

    const answer = raw.map(parseLegacyEnvelope).find((env) => env?.op.kind === 'snapshot');
    expect(answer?.op).toMatchObject({ kind: 'snapshot', to: 'P', tombstones: [{ id: 'fresh' }] });
    expect(answer?.op.kind === 'snapshot' && answer.op.tombstones).toHaveLength(1);
  });

  it('keeps tombstones by default for a week', () => {
    const { store, raw, deliver } = setup();
    store.add(shape('x'), REMOTE);
    store.remove('x');
    vi.setSystemTime(604_800_000);
    raw.length = 0;

    deliver('P', { kind: 'request-snapshot' });

    const answer = raw.map(parseLegacyEnvelope).find((env) => env?.op.kind === 'snapshot');
    expect(answer?.op).toMatchObject({ tombstones: [{ id: 'x' }] });
  });

  it('prunes an expired tombstone when a snapshot is received', () => {
    const { store, deliver } = setup({ tombstoneRetentionMs: 1000 });
    store.add(shape('x'), REMOTE);
    store.remove('x');
    vi.setSystemTime(1500);

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [] });
    deliver('P', { kind: 'upsert', element: shape('x', 1) });

    expect(store.getById('x')).toBeDefined();
  });
});

describe('SyncClient unsupported reply', () => {
  const reply = {
    kind: 'unsupported',
    protocolVersion: 3,
    minProtocolVersion: 3,
    reason: 'too old',
  };

  it('stops and closes the transport on a hub unsupported reply', () => {
    const { store, sentIds, deliver, isClosed } = setup();

    deliver('hub', reply);
    store.add(shape('x'));

    expect(isClosed()).toBe(true);
    expect(sentIds()).toEqual([]);
  });

  it('ignores an unsupported op sent by a peer', () => {
    const { store, sentIds, deliver, isClosed } = setup();

    deliver('P', reply);
    store.add(shape('x'));

    expect(isClosed()).toBe(false);
    expect(sentIds()).toEqual(['x']);
  });
});
