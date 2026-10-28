import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElementRegistry, ElementStore } from '@fieldnotes/core';
import type { CanvasElement, ExtensionElementEnvelope } from '@fieldnotes/core';
import { SyncClient } from './sync-client';
import type { ResolveLocalOnly } from './sync-client';
import { createCurrentCapabilities } from './capabilities';
import type { SyncOp } from './protocol';
import type { SyncTransport } from './sync-transport';

function versionedRegistry() {
  const migrate = vi.fn((data: Record<string, unknown>, from: number) => {
    if (data['name'] === 'bad') throw new Error('cannot migrate');
    return { label: `${String(data['name'])}@${from}` };
  });
  const registry = new ElementRegistry();
  registry.register<ExtensionElementEnvelope>({
    type: 'test:versioned',
    legacyTypes: [],
    decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
    validateData: () => true,
    unwrap: (element) => element,
    wrap: (element) => element,
    bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
    dataVersion: 3,
    migrate,
  });
  return { registry, migrate };
}

function ext(
  id: string,
  data: Record<string, unknown>,
  dataVersion?: number,
  version = 1,
): ExtensionElementEnvelope {
  const base: ExtensionElementEnvelope = {
    id,
    type: 'extension',
    extensionType: 'test:versioned',
    position: { x: 0, y: 0 },
    index: 'a0',
    version,
    editor: 'P',
    locked: false,
    layerId: '',
    data,
  };
  return dataVersion === undefined ? base : { ...base, dataVersion };
}

/** One client on a fake transport; `peer` has already completed the capability handshake. */
function setup(
  store: ElementStore,
  elementRegistry?: ElementRegistry,
  peer = 'P',
  resolveLocalOnly?: ResolveLocalOnly,
) {
  const sent: string[] = [];
  let receive: (message: string) => void = () => undefined;
  let reconnect: () => void = () => undefined;
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
    close: () => undefined,
  };
  const client = new SyncClient({
    flushIntervalMs: 0,
    store,
    transport,
    clientId: 'A',
    elementRegistry,
    resolveLocalOnly,
  });
  client.start();
  const deliver = (from: string, op: SyncOp | Record<string, unknown>): void =>
    receive(JSON.stringify({ from, op }));
  const capabilities = (from: string): void =>
    deliver(from, { kind: 'capabilities', capabilities: createCurrentCapabilities([]) });
  capabilities(peer);
  const ops = (): SyncOp[] => sent.map((m) => (JSON.parse(m) as { op: SyncOp }).op);
  const reconcile = (): void => {
    reconnect();
    capabilities(peer);
  };
  return { client, deliver, ops, reconcile };
}

function upsert(element: CanvasElement): SyncOp {
  return { kind: 'upsert', element };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SyncClient incoming extension data migration', () => {
  it('migrates a remote upsert without dataVersion', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store);

    deliver('P', upsert(ext('a', { name: 'a' })));

    expect(store.getById('a')).toMatchObject({ data: { label: 'a@1' }, dataVersion: 3 });
  });

  it('migrates a remote upsert at an older dataVersion', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store);

    deliver('P', upsert(ext('a', { name: 'a' }, 2)));

    expect(store.getById('a')).toMatchObject({ data: { label: 'a@2' }, dataVersion: 3 });
  });

  it('keeps a remote upsert with a newer dataVersion as is', () => {
    const { registry, migrate } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store);

    deliver('P', upsert(ext('a', { label: 'x' }, 4)));

    expect(store.getById('a')).toMatchObject({ data: { label: 'x' }, dataVersion: 4 });
    expect(migrate).not.toHaveBeenCalled();
  });

  it('migrates snapshot elements', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store, undefined, 'hub');

    deliver('hub', { kind: 'snapshot', to: 'A', elements: [ext('s', { name: 's' })] });

    expect(store.getById('s')).toMatchObject({ data: { label: 's@1' }, dataVersion: 3 });
  });

  it('migrates upserts inside a batch', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store, undefined, 'hub');

    deliver('hub', {
      kind: 'batch',
      ops: [upsert(ext('x', { name: 'x' })), upsert(ext('y', { name: 'y' }, 2))],
    });

    expect(store.getById('x')).toMatchObject({ data: { label: 'x@1' }, dataVersion: 3 });
    expect(store.getById('y')).toMatchObject({ data: { label: 'y@2' }, dataVersion: 3 });
  });

  it('uses a registry passed as elementRegistry', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore();
    const { deliver } = setup(store, registry);

    deliver('P', upsert(ext('a', { name: 'a' })));

    expect(store.getById('a')).toMatchObject({ data: { label: 'a@1' }, dataVersion: 3 });
  });

  it('does not re-broadcast a migrated remote upsert', () => {
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { client, deliver, ops } = setup(store);

    deliver('P', upsert(ext('a', { name: 'a' })));
    client.flush();

    expect(ops().some((op) => op.kind === 'upsert')).toBe(false);
  });

  it('skips an element whose migrate throws and reports it', () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store);

    deliver('P', upsert(ext('bad', { name: 'bad' })));

    expect(store.getById('bad')).toBeUndefined();
    expect(reportError).toHaveBeenCalledOnce();
    const [error] = reportError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', expect.stringContaining('Invalid element "bad"'));
  });

  it('keeps the local copy when an update fails to migrate', () => {
    vi.stubGlobal('reportError', vi.fn());
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    store.add(ext('k', { label: 'local' }, 3));
    const { deliver } = setup(store);

    deliver('P', upsert(ext('k', { name: 'bad' }, undefined, 2)));

    expect(store.getById('k')).toMatchObject({ data: { label: 'local' }, version: 1 });
  });

  it('applies the rest of a batch after a failed element', () => {
    vi.stubGlobal('reportError', vi.fn());
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    const { deliver } = setup(store, undefined, 'hub');

    deliver('hub', {
      kind: 'batch',
      ops: [upsert(ext('bad', { name: 'bad' })), upsert(ext('good', { name: 'good' }))],
    });

    expect(store.getById('bad')).toBeUndefined();
    expect(store.getById('good')).toMatchObject({ data: { label: 'good@1' }, dataVersion: 3 });
  });

  it('keeps the local copy when a reconcile snapshot element fails to migrate', () => {
    vi.stubGlobal('reportError', vi.fn());
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    store.add(ext('k', { label: 'local' }, 3));
    const { deliver, reconcile } = setup(store, undefined, 'hub');
    reconcile();

    deliver('hub', {
      kind: 'snapshot',
      to: 'A',
      elements: [ext('k', { name: 'bad' }, undefined, 2)],
    });

    expect(store.getById('k')).toMatchObject({ data: { label: 'local' } });
  });

  it('marks an element hub-known when its upsert fails to migrate', () => {
    vi.stubGlobal('reportError', vi.fn());
    const { registry } = versionedRegistry();
    const store = new ElementStore(registry);
    store.add(ext('k', { label: 'local' }, 3));
    const resolveLocalOnly = vi.fn<ResolveLocalOnly>();
    const { deliver, reconcile } = setup(store, undefined, 'hub', resolveLocalOnly);

    deliver('hub', upsert(ext('k', { name: 'bad' }, undefined, 2)));
    reconcile();
    deliver('hub', { kind: 'snapshot', to: 'A', elements: [] });

    expect(resolveLocalOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        localOnly: [{ element: expect.objectContaining({ id: 'k' }), hubKnown: true }],
      }),
    );
  });
});
