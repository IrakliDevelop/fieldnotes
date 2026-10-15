import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  AuthorityCheckpointAssembler,
  createAuthorityCapabilities,
  createAuthorityOperationId,
  parseAuthorityServerFrame,
  prepareAuthorityCheckpoint,
} from '@fieldnotes/sync';
import { createSyncServer } from './create-sync-server';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import { projectAuthorityState } from './authority-projection';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';
import type {
  AuthorityDriver,
  AuthorityExtension,
  AuthorityRoomDefinition,
} from './authority-types';

const definition: AuthorityRoomDefinition = {
  id: 'definition',
  extensions: [],
  project: (_context, state) => state,
  canReadOwnerId: () => false,
};
const sockets: WebSocket[] = [];
const servers: ReturnType<typeof createSyncServer>[] = [];

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  for (const server of servers) await server.close();
  servers.length = 0;
});

it('delivers a committed depth-64 Unicode extension after atomic depth-65 rejection', async () => {
  const nested = (arrayCount: number): unknown => {
    let value: unknown = { ['😀']: 'é😀' };
    for (let index = 0; index < arrayCount; index++) value = [value];
    return value;
  };
  let arrayCount = 60;
  const extension: AuthorityExtension = {
    requirement: { key: 'unicode', pluginName: 'vtt', version: 1, validate: () => true },
    extensionKinds: ['unicode:update'],
    prepare: () => nested(arrayCount) as never,
    changes: () => [],
  };
  const roomDefinition: AuthorityRoomDefinition = { ...definition, extensions: [extension] };
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision('table');
  store.policy.extensions = [extension];
  store.policy.canUseExtension = () => true;
  const driver = new AuthorityFixtureDriver(store);
  const read = {
    room: 'table',
    actorId: 'actor',
    ownershipId: 'owner',
    connectionId: 'connection',
    definitionId: 'definition',
    deadlineAt: store.now + 60_000,
    signal: new AbortController().signal,
  };
  const commit = async (issuedAt: number) => {
    const prepared = prepareAuthorityProposal(
      read,
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'propose',
        generation: 'g',
        clientOperationId: createAuthorityOperationId(issuedAt),
        mutation: { kind: 'extension', extensionKind: 'unicode:update', payload: {} },
      }),
    );
    return driver.commit(
      { ...prepared.context, ownershipId: 'owner', definitionId: 'definition' },
      {
        proposal: prepared.proposal,
        intent: prepareAuthorityIntent(prepared.proposal, [extension]),
      },
    );
  };
  expect((await commit(store.now)).status).toBe('committed');
  const room = store.getRoom('table');
  if (!room) throw new Error('Expected room');
  const before = {
    state: room.state,
    position: room.position,
    cas: room.casToken,
    dedupe: room.dedupe.size,
    floor: room.retiredIssuedAtFloor,
    images: room.images.size,
    entries: room.entries.length,
  };
  arrayCount = 61;
  expect(await commit(store.now + 1)).toEqual({ status: 'rejected', reason: 'overloaded' });
  expect(room.state).toBe(before.state);
  expect(room.position).toBe(before.position);
  expect(room.casToken).toBe(before.cas);
  expect(room.dedupe.size).toBe(before.dedupe);
  expect(room.retiredIssuedAtFloor).toBe(before.floor);
  expect(room.images.size).toBe(before.images);
  expect(room.entries).toHaveLength(before.entries);

  const visible = projectAuthorityState(roomDefinition, read, room.state);
  expect(visible.state.extensions.unicode?.data).toEqual(nested(60));
  const capture = await driver.checkpoint(read, read);
  const c2 = await prepareAuthorityCheckpoint(
    {
      cursor: { generation: 'g', streamId: '0'.repeat(32), revision: 0 },
      ...capture.state,
    },
    { requestId: 'direct', checkpointId: 'direct', requiredExtensions: [extension.requirement] },
  );
  c2.dispose();
  await capture.release();

  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: { authorize: () => true },
    authority: {
      driver,
      resolveRoom: (roomName) => (roomName === 'table' ? roomDefinition : null),
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const port = (server.wss.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}?room=table`);
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'actor',
      op: {
        kind: 'capabilities',
        capabilities: createAuthorityCapabilities(['unicode:update'], [extension.requirement]),
      },
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
    ).toBe(true),
  );
  const assembler = new AuthorityCheckpointAssembler({
    requestId: 'depth64',
    generation: 'g',
    requiredExtensions: [extension.requirement],
  });
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'depth64',
      generation: 'g',
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end'),
    ).toBe(true),
  );
  let received = false;
  for (const frame of frames) {
    if (!parseAuthorityServerFrame(frame)?.kind.startsWith('checkpoint-')) continue;
    const result = await assembler.accept(frame);
    if (result.status === 'complete') {
      received = true;
      expect(result.checkpoint.extensions.unicode?.data).toEqual(nested(60));
    }
  }
  expect(received).toBe(true);
  expect(socket.readyState).toBe(WebSocket.OPEN);
}, 10_000);

it('negotiates over real sockets, installs a complete checkpoint, and delivers author state', async () => {
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision('table');
  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: { authorize: () => true },
    authority: {
      driver: new AuthorityFixtureDriver(store),
      resolveRoom: (room) => (room === 'table' ? definition : null),
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const port = (server.wss.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}?room=table`);
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'actor',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
    ).toBe(true),
  );
  const assembler = new AuthorityCheckpointAssembler({
    requestId: 'req',
    generation: 'g',
    requiredExtensions: [],
  });
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'req',
      generation: 'g',
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end'),
    ).toBe(true),
  );
  let complete = false;
  for (const frame of frames) {
    if (!parseAuthorityServerFrame(frame)?.kind.startsWith('checkpoint-')) continue;
    const result = await assembler.accept(frame);
    if (result.status === 'complete') {
      complete = true;
      expect(result.checkpoint.elements).toEqual([]);
      expect(result.checkpoint.cursor.revision).toBe(0);
    }
  }
  expect(complete).toBe(true);
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'propose',
      generation: 'g',
      clientOperationId: createAuthorityOperationId(store.now),
      mutation: {
        kind: 'upsert',
        element: {
          id: 'shape',
          type: 'shape',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'default',
          shape: 'rectangle',
          size: { w: 1, h: 1 },
          strokeColor: 'red',
          strokeWidth: 1,
          fillColor: 'blue',
        },
      },
    }),
  );
  await vi.waitFor(() =>
    expect(frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'receipt')).toBe(true),
  );
  await vi.waitFor(() =>
    expect(frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'changes')).toBe(true),
  );
  expect(server.hub.roomCount()).toBe(0);
}, 10_000);

it('refuses a legacy client before checkpoint or room membership', async () => {
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision('table');
  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: {},
    authority: {
      driver: new AuthorityFixtureDriver(store),
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const port = (server.wss.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}?room=table`);
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'legacy',
      op: { kind: 'capabilities', capabilities: { protocolVersions: [3] } },
    }),
  );
  const code = await new Promise<number>((resolve) => socket.once('close', resolve));
  expect(code).toBe(4406);
  expect(
    frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'upgrade-required'),
  ).toBe(true);
  expect(server.hub.roomCount()).toBe(0);
}, 10_000);

it('enforces one explicit checkpoint request per ten seconds over a real socket', async () => {
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision('table');
  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: {},
    authority: {
      driver: new AuthorityFixtureDriver(store),
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const socket = new WebSocket(
    `ws://127.0.0.1:${(server.wss.address() as AddressInfo).port}?room=table`,
  );
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'actor',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
    ).toBe(true),
  );
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'first',
      generation: 'g',
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end'),
    ).toBe(true),
  );
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'second',
      generation: 'g',
    }),
  );
  const code = await new Promise<number>((resolve) => socket.once('close', resolve));
  expect(code).toBe(1013);
  expect(
    frames.filter((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-begin'),
  ).toHaveLength(1);
}, 10_000);

it('stops an incomplete checkpoint at the outbound authorization boundary', async () => {
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision('table');
  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: {
      authorize: ({ direction, message }) =>
        direction !== 'outbound' || parseAuthorityServerFrame(message)?.kind !== 'checkpoint-end',
    },
    authority: {
      driver: new AuthorityFixtureDriver(store),
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const socket = new WebSocket(
    `ws://127.0.0.1:${(server.wss.address() as AddressInfo).port}?room=table`,
  );
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'actor',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
    ).toBe(true),
  );
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'req',
      generation: 'g',
    }),
  );
  const code = await new Promise<number>((resolve) => socket.once('close', resolve));
  expect(code).toBe(4403);
  expect(
    frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-begin'),
  ).toBe(true);
  expect(frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end')).toBe(
    false,
  );
}, 10_000);

it.each(['definition', 'generation'] as const)(
  'does not deliver a stale checkpoint-end over a real socket after %s replacement in authorization',
  async (replacement) => {
    const cut = { generation: 'g', revision: 'cut' };
    let head = cut;
    let room: AuthorityRoomDefinition | null = definition;
    let allowEnd: ((value: boolean) => void) | undefined;
    const driver = {
      head: async () => head,
      checkpoint: async () => ({
        position: cut,
        state: { elements: [], layers: [], extensions: {} },
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const server = createSyncServer({
      port: 0,
      authenticate: () => ({ userId: 'actor' }),
      framePolicy: {
        authorize: ({ direction, message }) => {
          if (
            direction === 'outbound' &&
            parseAuthorityServerFrame(message)?.kind === 'checkpoint-end'
          )
            return new Promise<boolean>((resolve) => {
              allowEnd = resolve;
            });
          return true;
        },
      },
      authority: {
        driver,
        resolveRoom: () => room,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
    });
    servers.push(server);
    const socket = new WebSocket(
      `ws://127.0.0.1:${(server.wss.address() as AddressInfo).port}?room=table`,
    );
    sockets.push(socket);
    const frames: string[] = [];
    socket.on('message', (data) => frames.push(String(data)));
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    try {
      await new Promise<void>((resolve) => socket.once('open', resolve));
      socket.send(
        JSON.stringify({
          from: 'actor',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      await vi.waitFor(() =>
        expect(
          frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
        ).toBe(true),
      );
      socket.send(
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'req',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(allowEnd).toBeDefined());
      if (replacement === 'definition') room = null;
      else head = { generation: 'other', revision: 'new' };
      allowEnd?.(true);
      expect(await closed).toBe(1013);
      expect(
        frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-begin'),
      ).toBe(true);
      expect(
        frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end'),
      ).toBe(false);
    } finally {
      allowEnd?.(true);
    }
  },
  10_000,
);

it('requires exact synthetic extension inventory and streams its complete state', async () => {
  const requirement = {
    key: 'synthetic',
    pluginName: 'fixture',
    version: 1,
    validate: (data: unknown) => typeof data === 'string',
  };
  const extended: AuthorityRoomDefinition = {
    ...definition,
    extensions: [
      { requirement, extensionKinds: ['spark'], prepare: () => null, changes: () => [] },
    ],
  };
  const cut = { generation: 'g', revision: 'cut' };
  const driver = {
    head: async () => cut,
    checkpoint: async () => ({
      position: cut,
      token: 'lease',
      expiresAt: Date.now() + 5000,
      state: {
        elements: [],
        layers: [],
        extensions: {
          synthetic: { pluginName: 'fixture', version: 1, data: 'sentinel' },
        },
      },
      release: async () => undefined,
    }),
    readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const server = createSyncServer({
    port: 0,
    authenticate: () => ({ userId: 'actor' }),
    framePolicy: {},
    authority: {
      driver,
      resolveRoom: () => extended,
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
  });
  servers.push(server);
  const port = (server.wss.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}?room=table`);
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(
    JSON.stringify({
      from: 'actor',
      op: {
        kind: 'capabilities',
        capabilities: createAuthorityCapabilities(['spark'], [requirement]),
      },
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'resync-required'),
    ).toBe(true),
  );
  socket.send(
    JSON.stringify({
      protocol: 'authority:1',
      kind: 'checkpoint-request',
      requestId: 'req',
      generation: 'g',
    }),
  );
  await vi.waitFor(() =>
    expect(
      frames.some((frame) => parseAuthorityServerFrame(frame)?.kind === 'checkpoint-end'),
    ).toBe(true),
  );
  const assembler = new AuthorityCheckpointAssembler({
    requestId: 'req',
    generation: 'g',
    requiredExtensions: [requirement],
  });
  let completed = false;
  for (const frame of frames) {
    if (!parseAuthorityServerFrame(frame)?.kind.startsWith('checkpoint-')) continue;
    const result = await assembler.accept(frame);
    if (result.status === 'complete') {
      completed = true;
      expect(result.checkpoint.extensions.synthetic?.data).toBe('sentinel');
    }
  }
  expect(completed).toBe(true);
  const legacy = new WebSocket(`ws://127.0.0.1:${port}?room=table`);
  sockets.push(legacy);
  await new Promise<void>((resolve) => legacy.once('open', resolve));
  legacy.send(
    JSON.stringify({
      from: 'actor',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities(['spark']) },
    }),
  );
  const code = await new Promise<number>((resolve) => legacy.once('close', resolve));
  expect(code).toBe(4406);
}, 10_000);
