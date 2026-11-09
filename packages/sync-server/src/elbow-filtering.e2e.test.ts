import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { ElementStore, createArrow, createShape, createText, exportSvg } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport, createCurrentCapabilities } from '@fieldnotes/sync';
import { createSyncServer } from './create-sync-server';
import { MemoryHubBackend } from './memory-hub-backend';

type Server = ReturnType<typeof createSyncServer>;

interface Peer {
  readonly store: ElementStore;
  readonly client: SyncClient;
  readonly transport: WebSocketTransport;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object');
  return Object.fromEntries(Object.entries(value));
}

const ARROW_KEYS = [
  'bend',
  'cachedControlPoint',
  'color',
  'editor',
  'fixedSegments',
  'from',
  'fromBinding',
  'id',
  'index',
  'layerId',
  'locked',
  'position',
  'routing',
  'to',
  'toBinding',
  'type',
  'version',
  'width',
];
const TEXT_KEYS = [
  'color',
  'containerId',
  'editor',
  'fontSize',
  'id',
  'index',
  'layerId',
  'locked',
  'parentId',
  'position',
  'size',
  'text',
  'textAlign',
  'type',
  'version',
];
const EXPECTED_PUBLIC_LABEL = Object.freeze({
  id: 'arrow-label',
  type: 'text',
  position: { x: 130, y: 10 },
  index: 'a3',
  version: 1,
  locked: false,
  layerId: '',
  size: { w: 80, h: 20 },
  text: '',
  fontSize: 16,
  color: '#1a1a1a',
  textAlign: 'left',
  parentId: 'arrow',
  containerId: 'arrow',
  editor: 'gm-client',
});

function expectExactDocumentBytes(
  frame: string,
  phase: 'snapshot' | 'upsert' | 'correction',
  version: number,
): void {
  const op = record(record(JSON.parse(frame)).op);
  const values = op.kind === 'snapshot' ? op.elements : [op.element];
  if (!Array.isArray(values)) throw new Error('expected element bytes');
  const documents = values
    .map(record)
    .filter((element) => element.type === 'arrow' || element.type === 'text');
  if (phase === 'snapshot') expect(documents).toHaveLength(2);
  const label = documents.find((element) => element.id === EXPECTED_PUBLIC_LABEL.id);
  if (phase === 'snapshot' || label) expect(label).toEqual(EXPECTED_PUBLIC_LABEL);
  for (const value of values) {
    const element = record(value);
    if (element.type === 'arrow') {
      expect(Object.keys(element).sort()).toEqual(ARROW_KEYS);
      expect(element).toMatchObject({
        version,
        editor: 'gm-client',
        routing: 'elbow',
        fixedSegments: [{ axis: 'x', value: 170 }],
      });
    }
    if (element.type === 'text') {
      expect(Object.keys(element).sort()).toEqual(TEXT_KEYS);
      expect(element).toEqual(EXPECTED_PUBLIC_LABEL);
    }
  }
}

function arrowPath(svg: string, color: string): string {
  const paths = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="([^"]+)"/g)];
  const match = paths.filter((item) => item[2] === color);
  if (match.length !== 1 || !match[0]?.[1]) throw new Error('missing arrow path');
  return match[0][1];
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: condition not met');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('filtered elbow documents (end-to-end)', () => {
  const servers: Server[] = [];
  const clients: SyncClient[] = [];
  const transports: WebSocketTransport[] = [];
  const sockets: WsClient[] = [];

  function startServer(): { server: Server; port: number; backend: MemoryHubBackend } {
    const backend = new MemoryHubBackend();
    const server = createSyncServer({
      port: 0,
      backend,
      authenticate: ({ req }) => {
        const params = new URL(req.url ?? '', 'http://x').searchParams;
        const role = params.get('role');
        return role ? { userId: params.get('probe') === '1' ? 'player-bytes' : role, role } : null;
      },
      authorize: ({ role, userId, op }) =>
        role === 'gm' || (userId === 'player' && op.kind === 'upsert'),
      canRead: ({ role, audience }) => audience !== 'private' || role === 'gm',
      resolveAudience: ({ element }) => element.audience,
    });
    servers.push(server);
    const address = server.wss.address();
    if (!address || typeof address === 'string' || !Number.isInteger(address.port))
      throw new Error('missing server port');
    return { server, port: address.port, backend };
  }

  function connect(port: number, role: 'gm' | 'player', clientId: string): Peer {
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=elbow&role=${role}`);
    const store = new ElementStore();
    const client = new SyncClient({
      store,
      transport,
      clientId,
      flushIntervalMs: 0,
    });
    transports.push(transport);
    clients.push(client);
    client.start();
    return { store, client, transport };
  }

  async function connectRaw(port: number): Promise<{ socket: WsClient; frames: string[] }> {
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=elbow&role=player&probe=1`);
    const frames: string[] = [];
    sockets.push(socket);
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({
        from: 'player-bytes',
        op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
      }),
    );
    await waitFor(() => frames.some((frame) => frame.includes('"kind":"capabilities"')));
    frames.length = 0;
    return { socket, frames };
  }

  afterEach(async () => {
    for (const client of clients) client.stop();
    clients.length = 0;
    for (const transport of transports) transport.close();
    transports.length = 0;
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    for (const server of servers) await server.close();
    servers.length = 0;
  });

  it('keeps authored elbow documents stable while filtered readers export their admitted routes', async () => {
    const { port } = startServer();
    const writer = connect(port, 'gm', 'gm-writer');
    const gm = connect(port, 'gm', 'gm-reader');
    const player = connect(port, 'player', 'player-reader');

    const source = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 40, h: 40 } }),
      id: 'source',
    };
    const target = {
      ...createShape({ position: { x: 300, y: 0 }, size: { w: 40, h: 40 } }),
      id: 'target',
    };
    const arrow = {
      ...createArrow({
        from: { x: 20, y: 20 },
        to: { x: 320, y: 20 },
        fromBinding: { elementId: source.id },
        toBinding: { elementId: target.id },
        routing: 'elbow',
        color: '#13579b',
      }),
      id: 'arrow',
      ownerId: 'gm',
    };
    const label = {
      ...createText({ position: { x: 140, y: 10 }, size: { w: 80, h: 20 }, text: '' }),
      id: 'arrow-label',
      parentId: arrow.id,
      containerId: arrow.id,
    };
    const obstacle = {
      ...createShape({ position: { x: 140, y: -20 }, size: { w: 60, h: 80 } }),
      id: 'private-obstacle',
      audience: 'private',
      ownerId: 'gm',
    };

    writer.store.add(source);
    writer.store.add(target);
    writer.store.add(arrow);
    writer.store.add(label);
    writer.store.add(obstacle);

    await waitFor(
      () =>
        gm.store.getById(label.id)?.type === 'text' &&
        player.store.getById(label.id)?.type === 'text',
    );
    expect(player.store.getById(obstacle.id)).toBeUndefined();

    const gmArrow = gm.store.getById(arrow.id);
    const playerArrow = player.store.getById(arrow.id);
    const gmLabel = gm.store.getById(label.id);
    const playerLabel = player.store.getById(label.id);
    expect(gmArrow).toEqual(playerArrow);
    expect(gmLabel).toEqual(playerLabel);
    expect(gmArrow).toMatchObject({ routing: 'elbow' });
    expect(gmArrow).not.toHaveProperty('fixedSegments');

    const [blockedSvg, clearSvg] = await Promise.all([
      exportSvg(gm.store),
      exportSvg(player.store),
    ]);
    const blockedPath = arrowPath(blockedSvg, arrow.color);
    const clearPath = arrowPath(clearSvg, arrow.color);
    expect(clearPath).toBe('M40 20 L300 20');
    expect(blockedPath).not.toBe(clearPath);

    const updates: { id: string; origin: string | undefined }[] = [];
    const playerUpdates: { id: string; origin: string | undefined }[] = [];
    const unsubscribe = gm.store.on('update', ({ current }, meta) =>
      updates.push({ id: current.id, origin: meta.origin }),
    );
    const unsubscribePlayer = player.store.on('update', ({ current }, meta) =>
      playerUpdates.push({ id: current.id, origin: meta.origin }),
    );
    const gmArrowBefore = structuredClone(gm.store.getById(arrow.id));
    const gmLabelBefore = structuredClone(gm.store.getById(label.id));
    const playerArrowBefore = structuredClone(player.store.getById(arrow.id));
    const playerLabelBefore = structuredClone(player.store.getById(label.id));
    try {
      writer.store.update(obstacle.id, { position: { x: 140, y: 80 } });
      await waitFor(() => gm.store.getById(obstacle.id)?.version === 2);

      const [movedSvg, playerSvg] = await Promise.all([
        exportSvg(gm.store),
        exportSvg(player.store),
      ]);
      expect(arrowPath(movedSvg, arrow.color)).toBe(clearPath);
      expect(arrowPath(playerSvg, arrow.color)).toBe(clearPath);
      expect(gm.store.getById(arrow.id)).toEqual(gmArrowBefore);
      expect(gm.store.getById(label.id)).toEqual(gmLabelBefore);
      expect(player.store.getById(arrow.id)).toEqual(playerArrowBefore);
      expect(player.store.getById(label.id)).toEqual(playerLabelBefore);
      expect(updates).toEqual([{ id: obstacle.id, origin: 'remote' }]);
      expect(playerUpdates).toEqual([]);
    } finally {
      unsubscribe();
      unsubscribePlayer();
    }

    gm.store.update(arrow.id, { fixedSegments: [{ axis: 'x', value: 170 }] });
    await waitFor(
      () =>
        player.store.getById(arrow.id)?.type === 'arrow' &&
        player.store.getById(arrow.id)?.version === 2,
    );
    expect(player.store.getById(arrow.id)).toMatchObject({
      routing: 'elbow',
      fixedSegments: [{ axis: 'x', value: 170 }],
    });
  });

  it('filters snapshot, upsert, correction and reconnect bytes without route data', async () => {
    const { server, port, backend } = startServer();
    const gm = connect(port, 'gm', 'gm-client');
    const source = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 40, h: 40 } }),
      id: 'source',
    };
    const target = {
      ...createShape({ position: { x: 300, y: 0 }, size: { w: 40, h: 40 } }),
      id: 'target',
    };
    const arrow = {
      ...createArrow({
        from: { x: 20, y: 20 },
        to: { x: 320, y: 20 },
        fromBinding: { elementId: source.id },
        toBinding: { elementId: target.id },
        routing: 'elbow',
        fixedSegments: [{ axis: 'x', value: 170 }],
      }),
      id: 'arrow',
    };
    const label = {
      ...createText({ position: { x: 140, y: 10 }, size: { w: 80, h: 20 }, text: '' }),
      id: 'arrow-label',
      parentId: arrow.id,
      containerId: arrow.id,
    };
    const obstacle = {
      ...createShape({ position: { x: 140, y: -20 }, size: { w: 60, h: 80 } }),
      id: 'private-obstacle',
      audience: 'private',
      ownerId: 'gm',
    };
    gm.store.add(source);
    gm.store.add(target);
    gm.store.add(arrow);
    gm.store.add(label);
    gm.store.add(obstacle);
    await waitFor(async () => (await backend.getRecord('elbow', arrow.id))?.kind === 'element');
    const stored = await backend.getRecord('elbow', arrow.id);
    if (!stored || stored.kind !== 'element') throw new Error('missing canonical arrow');
    expect(stored.element.ownerId).toBe('gm');

    const raw = await connectRaw(port);
    raw.socket.send(JSON.stringify({ from: 'player-bytes', op: { kind: 'request-snapshot' } }));
    await waitFor(() => raw.frames.some((frame) => frame.includes('"kind":"snapshot"')));
    const snapshot = raw.frames.find((frame) => frame.includes('"kind":"snapshot"')) ?? '';
    expect(snapshot).not.toContain(obstacle.id);
    expect(snapshot).not.toContain('ownerId');
    expect(snapshot).not.toMatch(/route(?:Points|Cache)?/i);
    expectExactDocumentBytes(snapshot, 'snapshot', 1);

    raw.frames.length = 0;
    gm.store.update(arrow.id, { bend: 25 });
    await waitFor(() => raw.frames.some((frame) => frame.includes('"kind":"upsert"')));
    const upsert = raw.frames.find((frame) => frame.includes('"kind":"upsert"')) ?? '';
    expect(upsert).not.toContain(obstacle.id);
    expect(upsert).not.toContain('ownerId');
    expect(upsert).not.toMatch(/route(?:Points|Cache)?/i);
    expectExactDocumentBytes(upsert, 'upsert', 2);

    const canonical = gm.store.getById(arrow.id);
    if (!canonical || canonical.type !== 'arrow') throw new Error('missing canonical arrow');
    raw.frames.length = 0;
    raw.socket.send(
      JSON.stringify({
        from: 'player-bytes',
        op: { kind: 'upsert', element: { ...canonical, bend: 999 } },
      }),
    );
    await waitFor(() => raw.frames.some((frame) => frame.includes('"kind":"upsert"')));
    const correction = raw.frames.find((frame) => frame.includes('"kind":"upsert"')) ?? '';
    expect(correction).toContain('"bend":25');
    expect(correction).not.toContain(obstacle.id);
    expect(correction).not.toContain('ownerId');
    expect(correction).not.toMatch(/route(?:Points|Cache)?/i);
    expectExactDocumentBytes(correction, 'correction', 2);

    const closed = new Promise<void>((resolve) => raw.socket.once('close', resolve));
    raw.socket.close();
    await closed;
    const reconnect = await connectRaw(port);
    reconnect.socket.send(
      JSON.stringify({ from: 'player-bytes', op: { kind: 'request-snapshot' } }),
    );
    await waitFor(() => reconnect.frames.some((frame) => frame.includes('"kind":"snapshot"')));
    const reconnectSnapshot =
      reconnect.frames.find((frame) => frame.includes('"kind":"snapshot"')) ?? '';
    expect(reconnectSnapshot).not.toContain(obstacle.id);
    expect(reconnectSnapshot).not.toContain('ownerId');
    expect(reconnectSnapshot).not.toMatch(/route(?:Points|Cache)?/i);
    expectExactDocumentBytes(reconnectSnapshot, 'snapshot', 2);
    expect(reconnectSnapshot).toContain('"routing":"elbow"');
    expect(reconnectSnapshot).toContain('"fixedSegments":[{"axis":"x","value":170}]');
    expect(reconnectSnapshot).toContain('"version":2');
    expect(reconnectSnapshot).toContain('"editor":"gm-client"');
    expect(server.hub.roomCount()).toBeGreaterThan(0);
  });

  it('preserves optional elbow fields through an old-style spread and emits no writes for obstacle routing', async () => {
    const { port } = startServer();
    const gm = connect(port, 'gm', 'gm-client');
    const player = connect(port, 'player', 'player-client');
    const arrow = {
      ...createArrow({
        from: { x: 20, y: 20 },
        to: { x: 320, y: 20 },
        routing: 'elbow',
        fixedSegments: [{ axis: 'y', value: 20 }],
      }),
      id: 'arrow',
    };
    const label = {
      ...createText({ position: { x: 140, y: 10 }, size: { w: 80, h: 20 }, text: '' }),
      id: 'arrow-label',
      parentId: arrow.id,
      containerId: arrow.id,
    };
    const obstacle = {
      ...createShape({ position: { x: 140, y: -20 }, size: { w: 60, h: 80 } }),
      id: 'private-obstacle',
      audience: 'private',
      ownerId: 'gm',
    };
    gm.store.add(arrow);
    gm.store.add(label);
    gm.store.add(obstacle);
    await waitFor(() => player.store.getById(label.id)?.type === 'text');

    const events: { id: string; origin: string | undefined }[] = [];
    const removeListener = gm.store.on('update', ({ current }, meta) => {
      events.push({ id: current.id, origin: meta.origin });
    });
    const playerEvents: { id: string; origin: string | undefined }[] = [];
    const removePlayerListener = player.store.on('update', ({ current }, meta) => {
      playerEvents.push({ id: current.id, origin: meta.origin });
    });
    try {
      const received = player.store.getById(arrow.id);
      if (!received || received.type !== 'arrow') throw new Error('missing filtered arrow');
      player.store.update(arrow.id, { ...received, to: { x: 340, y: 20 } });
      await waitFor(() => {
        const updated = gm.store.getById(arrow.id);
        return updated?.type === 'arrow' && updated.to.x === 340;
      });
      expect(gm.store.getById(arrow.id)).toMatchObject({
        from: { x: 20, y: 20 },
        to: { x: 340, y: 20 },
        version: 2,
        editor: 'player-client',
        routing: 'elbow',
        fixedSegments: [{ axis: 'y', value: 20 }],
      });
      expect(events).toEqual([
        { id: arrow.id, origin: 'remote' },
        { id: label.id, origin: 'remote' },
      ]);
      expect(playerEvents).toEqual([
        { id: arrow.id, origin: undefined },
        { id: label.id, origin: undefined },
      ]);

      const gmArrowBefore = structuredClone(gm.store.getById(arrow.id));
      const gmLabelBefore = structuredClone(gm.store.getById(label.id));
      const playerArrowBefore = structuredClone(player.store.getById(arrow.id));
      const playerLabelBefore = structuredClone(player.store.getById(label.id));
      events.length = 0;
      playerEvents.length = 0;
      gm.store.update(obstacle.id, { position: { x: 140, y: 80 } });
      await waitFor(() => gm.store.getById(obstacle.id)?.version === 2);
      await Promise.all([exportSvg(gm.store), exportSvg(player.store)]);
      expect(events).toEqual([{ id: obstacle.id, origin: undefined }]);
      expect(playerEvents).toEqual([]);
      expect(gm.store.getById(arrow.id)).toEqual(gmArrowBefore);
      expect(gm.store.getById(label.id)).toEqual(gmLabelBefore);
      expect(player.store.getById(arrow.id)).toEqual(playerArrowBefore);
      expect(player.store.getById(label.id)).toEqual(playerLabelBefore);
    } finally {
      removeListener();
      removePlayerListener();
    }
  });
});
