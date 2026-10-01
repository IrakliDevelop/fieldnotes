import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  createAuthorityCapabilities,
  createAuthorityOperationId,
  parseEnvelope,
  type AuthorityMutation,
} from '@fieldnotes/sync';
import { authorityCapabilitiesMatch } from './authority-admission';
import { AuthorityRuntime } from './authority-runtime';
import { FrameBudget } from './bounded-frame-queue';
import { FrameTransport } from './frame-transport';
import { SyncHub } from './sync-hub';
import { registerAuthorityConnection } from './authority-connection';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import { InMemoryHubFanout } from './hub-fanout';
import type { AuthorityDriver, AuthorityRoomDefinition } from './authority-types';
import type { Connection } from './sync-hub';
import type { HubFanout } from './hub-fanout';

const definition: AuthorityRoomDefinition = {
  id: 'definition',
  extensions: [],
  project: (_context, state) => state,
  canReadOwnerId: () => false,
};
const element = {
  id: 'shape',
  type: 'shape' as const,
  position: { x: 0, y: 0 },
  zIndex: 0,
  locked: false,
  layerId: 'layer',
  shape: 'rectangle' as const,
  size: { w: 1, h: 1 },
  strokeColor: 'red',
  strokeWidth: 1,
  fillColor: 'blue',
};
const proposal = (id: string, mutation: AuthorityMutation) =>
  JSON.stringify({
    protocol: 'authority:1',
    kind: 'propose',
    generation: 'g',
    clientOperationId: id,
    mutation,
  });

const emptyAuthorityState = { elements: [], layers: [], extensions: {} };
const initialAuthorityPosition = { generation: 'g', revision: 'start' };
const authorityReference = { id: 'ref', byteLength: 1, nodes: 1 };

it.each(['capabilities', 'resync-required'] as const)(
  'frees metadata for live replay, publisher claims, and a ninth head while native %s stalls',
  async (holdStage) => {
    vi.useFakeTimers();
    const hub = new SyncHub();
    const budget = new FrameBudget(1);
    const position = { generation: 'g', revision: 'r' };
    let active = 0;
    let peak = 0;
    const metadata = async <T>(run: () => Promise<T>): Promise<T> => {
      active++;
      peak = Math.max(peak, active);
      try {
        return await run();
      } finally {
        active--;
      }
    };
    const head = vi.fn((_context: { connectionId: string }) => metadata(async () => position));
    const readAfter = vi.fn(() =>
      metadata(async () => ({ status: 'ok' as const, head: position, records: [] })),
    );
    const claimPublications = vi.fn(() => metadata(async () => []));
    const driver = {
      head,
      readAfter,
      claimPublications,
      markPublished: vi.fn(),
    } as unknown as AuthorityDriver;
    const fanout = new InMemoryHubFanout();
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      fanout,
      'worker',
    );
    const native: ((error?: Error) => void)[] = [];
    const writes: { id: string; kind: string }[] = [];
    const transports: FrameTransport[] = [];
    const negotiations: Promise<void>[] = [];
    const join = (id: string, stalled: boolean): Promise<void> => {
      const ws = {
        readyState: WebSocket.OPEN,
        send: (message: string, done: (error?: Error) => void) => {
          const frame = JSON.parse(message) as { kind?: string; op?: { kind?: string } };
          const kind = frame.kind ?? frame.op?.kind ?? '';
          writes.push({ id, kind });
          if (stalled && kind === holdStage) native.push(done);
          else done();
        },
      } as unknown as WebSocket;
      const connection: Connection = {
        id,
        room: id,
        signal: new AbortController().signal,
        close: vi.fn(),
        send: vi.fn(),
      };
      const transport = new FrameTransport(
        ws,
        hub,
        { connectionId: id, room: id },
        {},
        budget,
        vi.fn(),
      );
      transports.push(transport);
      registerAuthorityConnection(connection, {
        sendTracked: (frame) => transport.sendTracked(frame),
      });
      expect(runtime.admit(connection, definition)).toBe(true);
      return runtime.handleMessage(
        id,
        JSON.stringify({
          from: id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
    };
    try {
      await join('live', false);
      runtime.activate('live', position, emptyAuthorityState);
      for (let index = 0; index < 8; index++) negotiations.push(join(`slow-${index}`, true));
      for (let index = 0; index < 100 && native.length < 8; index++) await Promise.resolve();
      expect(native).toHaveLength(8);
      expect(head).toHaveBeenCalledTimes(9);
      const priorReads = readAfter.mock.calls.length;
      await fanout.publish(
        JSON.stringify({
          authority: 1,
          room: 'live',
          definitionId: definition.id,
          position,
        }),
      );
      negotiations.push(join('healthy', false));
      await vi.advanceTimersByTimeAsync(1000);
      expect(head.mock.calls.some((call) => call[0].connectionId === 'healthy')).toBe(true);
      expect(readAfter.mock.calls.length).toBeGreaterThan(priorReads);
      expect(claimPublications.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(peak).toBeLessThanOrEqual(8);
      for (let index = 0; index < 8; index++) {
        const id = `slow-${index}`;
        expect(writes.filter((write) => write.id === id).map((write) => write.kind)).toEqual(
          holdStage === 'capabilities' ? ['capabilities'] : ['capabilities', 'resync-required'],
        );
      }
      expect(budget.reserve('slow-0', 'slow-0', 'probe')).toBeNull();
      expect(runtime['peers'].get('slow-0')?.requestTimer).toBeUndefined();
      const duplicate = runtime.handleMessage(
        'slow-0',
        JSON.stringify({
          from: 'slow-0',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      await Promise.resolve();
      expect(writes.filter((write) => write.id === 'slow-0')).toHaveLength(
        holdStage === 'capabilities' ? 1 : 2,
      );
      native[0]?.();
      await negotiations[0];
      await duplicate;
      expect(writes.filter((write) => write.id === 'slow-0').map((write) => write.kind)).toEqual([
        'capabilities',
        'resync-required',
      ]);
      expect(runtime['peers'].get('slow-0')?.requestTimer).toBeDefined();
      const release = budget.reserve('slow-0', 'slow-0', 'probe');
      expect(release).toBeTypeOf('function');
      release?.();
    } finally {
      for (const transport of transports) transport.dispose();
      for (const callback of native) callback();
      runtime.close();
      hub.close();
      await Promise.all(negotiations);
      vi.useRealTimers();
    }
  },
);

it.each([
  ['capabilities', 'disconnect'],
  ['capabilities', 'timeout'],
  ['capabilities', 'shutdown'],
  ['capabilities', 'replacement'],
  ['resync-required', 'disconnect'],
  ['resync-required', 'timeout'],
  ['resync-required', 'shutdown'],
  ['resync-required', 'replacement'],
] as const)(
  'keeps a %s native send charged through %s until physical settlement',
  async (stage, ending) => {
    vi.useFakeTimers();
    const hub = new SyncHub();
    const budget = new FrameBudget(1);
    const controller = new AbortController();
    const sent: string[] = [];
    let native: ((error?: Error) => void) | undefined;
    const driver = {
      head: vi.fn(async () => initialAuthorityPosition),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        const frame = JSON.parse(message) as { kind?: string; op?: { kind?: string } };
        const kind = frame.kind ?? frame.op?.kind ?? '';
        sent.push(kind);
        if (kind === stage) native = done;
        else done();
      },
    } as unknown as WebSocket;
    const connection: Connection = {
      id: 'same',
      room: 'room',
      signal: controller.signal,
      close: vi.fn(() => transport.dispose()),
      send: vi.fn(),
    };
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'same', room: 'room' },
      {},
      budget,
      (code) => connection.close?.(code),
    );
    registerAuthorityConnection(connection, {
      sendTracked: (frame) => transport.sendTracked(frame),
    });
    const capabilities = JSON.stringify({
      from: 'same',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    });
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      const negotiation = runtime.handleMessage('same', capabilities);
      for (let index = 0; index < 30 && !native; index++) await Promise.resolve();
      expect(native).toBeDefined();
      expect(sent).toEqual(
        stage === 'capabilities' ? ['capabilities'] : ['capabilities', 'resync-required'],
      );
      expect(runtime['peers'].get('same')?.requestTimer).toBeUndefined();
      if (ending === 'disconnect') {
        controller.abort();
        transport.dispose();
      } else if (ending === 'timeout') {
        await vi.advanceTimersByTimeAsync(5000);
        expect(connection.close).toHaveBeenCalledWith(1013);
      } else if (ending === 'shutdown') {
        runtime.close();
      } else {
        runtime.remove('same');
        transport.dispose();
        const early: Connection = {
          id: 'same',
          room: 'room',
          signal: new AbortController().signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        registerAuthorityConnection(early, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        expect(runtime.admit(early, definition)).toBe(false);
      }
      await negotiation;
      expect(runtime.pinnedDefinitionId('room')).toBe('definition');
      expect(budget.reserve('same', 'room', 'probe')).toBeNull();
      native?.();
      for (let index = 0; index < 30; index++) await Promise.resolve();
      expect(runtime.pinnedDefinitionId('room')).toBeUndefined();
      const release = budget.reserve('same', 'room', 'probe');
      expect(release).toBeTypeOf('function');
      release?.();
      expect(sent).toEqual(
        stage === 'capabilities' ? ['capabilities'] : ['capabilities', 'resync-required'],
      );
      if (ending === 'replacement') {
        const successor: Connection = {
          id: 'same',
          room: 'room',
          signal: new AbortController().signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        const successorSent = vi.fn(() => ({
          completion: Promise.resolve(),
          settled: Promise.resolve(),
        }));
        registerAuthorityConnection(successor, { sendTracked: successorSent });
        expect(runtime.admit(successor, definition)).toBe(true);
        await runtime.handleMessage('same', capabilities);
        expect(successorSent).toHaveBeenCalledTimes(2);
        expect(successor.close).not.toHaveBeenCalled();
      }
    } finally {
      native?.();
      transport.dispose();
      runtime.close();
      hub.close();
      vi.useRealTimers();
    }
  },
);

it('keeps eight ignored-abort heads charged until actual settlement, then frees metadata before delivery', async () => {
  const pending: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const head = vi.fn((context: { connectionId: string }) => {
    active++;
    peak = Math.max(peak, active);
    const work = context.connectionId.startsWith('slow-')
      ? new Promise<typeof initialAuthorityPosition>((resolve) =>
          pending.push(() => resolve(initialAuthorityPosition)),
        )
      : Promise.resolve(initialAuthorityPosition);
    return work.finally(() => {
      active--;
    });
  });
  const driver = {
    head,
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const runtime = new AuthorityRuntime(
    {
      driver,
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
    },
    new InMemoryHubFanout(),
    'worker',
  );
  const hub = new SyncHub();
  const budget = new FrameBudget(1);
  const controllers: AbortController[] = [];
  const transports: FrameTransport[] = [];
  const native: ((error?: Error) => void)[] = [];
  const join = (id: string): Promise<void> => {
    const controller = new AbortController();
    controllers.push(controller);
    const connection: Connection = {
      id,
      room: id,
      signal: controller.signal,
      close: vi.fn(),
      send: vi.fn(),
    };
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        if (id === 'healthy') done();
        else native.push(done);
      },
    } as unknown as WebSocket;
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: id, room: id },
      {},
      budget,
      vi.fn(),
    );
    transports.push(transport);
    registerAuthorityConnection(connection, {
      sendTracked: (frame) => transport.sendTracked(frame),
    });
    expect(runtime.admit(connection, definition)).toBe(true);
    return runtime.handleMessage(
      id,
      JSON.stringify({
        from: id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
  };
  try {
    const negotiations = Array.from({ length: 8 }, (_, index) => join(`slow-${index}`));
    await vi.waitFor(() => expect(pending).toHaveLength(8));
    expect(active).toBe(8);
    controllers[0]?.abort();
    const healthy = join('healthy');
    await Promise.resolve();
    expect(head).toHaveBeenCalledTimes(8);
    expect(runtime['scheduler'].reserve('metadata')).toBeNull();
    pending[0]?.();
    await vi.waitFor(() => expect(head).toHaveBeenCalledTimes(9));
    expect(peak).toBeLessThanOrEqual(8);
    pending.slice(1).forEach((finish) => finish());
    await vi.waitFor(() => expect(active).toBe(0));
    await vi.waitFor(() => expect(native).toHaveLength(7));
    const release = runtime['scheduler'].reserve('metadata');
    expect(release).toBeTypeOf('function');
    release?.();
    controllers.forEach((controller) => controller.abort());
    transports.forEach((transport) => transport.dispose());
    native.forEach((callback) => callback());
    await Promise.all([...negotiations, healthy]);
  } finally {
    pending.forEach((finish) => finish());
    controllers.forEach((controller) => controller.abort());
    transports.forEach((transport) => transport.dispose());
    native.forEach((callback) => callback());
    runtime.close();
    hub.close();
  }
});

it('closes generically after a synchronous capabilities send throw without delivering resync', async () => {
  const sent = vi.fn(() => {
    throw new Error('private-sentinel');
  });
  const connection: Connection = {
    id: 'throwing',
    room: 'room',
    signal: new AbortController().signal,
    close: vi.fn(),
    send: vi.fn(),
  };
  registerAuthorityConnection(connection, { sendTracked: sent });
  const driver = {
    head: async () => initialAuthorityPosition,
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const runtime = new AuthorityRuntime(
    {
      driver,
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
    },
    new InMemoryHubFanout(),
    'worker',
  );
  try {
    expect(runtime.admit(connection, definition)).toBe(true);
    await runtime.handleMessage(
      'throwing',
      JSON.stringify({
        from: 'throwing',
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    expect(sent).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledWith(1013);
    expect(runtime.pinnedDefinitionId('room')).toBeUndefined();
  } finally {
    runtime.close();
  }
});

async function startResultBoundaryRuntime(driver: AuthorityDriver) {
  const sent: string[] = [];
  const close = vi.fn();
  const connection: Connection = {
    id: 'boundary',
    room: 'table',
    signal: new AbortController().signal,
    close,
    send: vi.fn(),
  };
  registerAuthorityConnection(connection, {
    sendTracked: (frame) => {
      sent.push(frame);
      return { completion: Promise.resolve(), settled: Promise.resolve() };
    },
  });
  const runtime = new AuthorityRuntime(
    {
      driver,
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
    },
    new InMemoryHubFanout(),
    'boundary-worker',
  );
  expect(runtime.admit(connection, definition)).toBe(true);
  await runtime.handleMessage(
    connection.id,
    JSON.stringify({
      from: connection.id,
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    }),
  );
  sent.length = 0;
  runtime.activate(connection.id, initialAuthorityPosition, emptyAuthorityState);
  return { runtime, connection, close, sent };
}

describe('authority returned-result boundary', () => {
  it.each([
    ['self-link', [{ previous: initialAuthorityPosition, position: initialAuthorityPosition }]],
    [
      'later self-link',
      [
        { previous: initialAuthorityPosition, position: { generation: 'g', revision: 'one' } },
        {
          previous: { generation: 'g', revision: 'one' },
          position: { generation: 'g', revision: 'one' },
        },
      ],
    ],
    [
      'third record cycles',
      [
        { previous: initialAuthorityPosition, position: { generation: 'g', revision: 'one' } },
        {
          previous: { generation: 'g', revision: 'one' },
          position: { generation: 'g', revision: 'two' },
        },
        {
          previous: { generation: 'g', revision: 'two' },
          position: { generation: 'g', revision: 'one' },
        },
      ],
    ],
  ] as const)('rejects a %s page before any evidence or reread', async (_label, links) => {
    const readAfter = vi.fn(async () => {
      if (readAfter.mock.calls.length > 1) throw new Error('bounded reread probe');
      return {
        status: 'ok',
        head: { generation: 'g', revision: 'advertised-head' },
        records: links.map((link) => ({
          ...link,
          before: authorityReference,
          after: authorityReference,
        })),
      };
    });
    const readEvidence = vi.fn(async () => ({
      status: 'available',
      lease: {
        before: emptyAuthorityState,
        after: emptyAuthorityState,
        token: 'evidence',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      },
    }));
    const checkpoint = vi.fn();
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter,
      readEvidence,
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(readEvidence).not.toHaveBeenCalled();
      expect(checkpoint).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it.each([
    ['missing expiry', { token: 'capture' }],
    ['NaN expiry', { token: 'capture', expiresAt: NaN }],
    ['infinite expiry', { token: 'capture', expiresAt: Infinity }],
    ['fractional expiry', { token: 'capture', expiresAt: Date.now() + 5000.5 }],
    ['missing token', { expiresAt: Date.now() + 5000 }],
    ['empty token', { token: '', expiresAt: Date.now() + 5000 }],
    ['oversized token', { token: 'x'.repeat(129), expiresAt: Date.now() + 5000 }],
    ['wrong token', { token: 4, expiresAt: Date.now() + 5000 }],
  ] as const)('rejects a capture with %s and releases it once', async (_label, header) => {
    const release = vi.fn(async () => undefined);
    const readAfter = vi.fn(async () => {
      if (readAfter.mock.calls.length > 1) throw new Error('bounded capture reread probe');
      return { status: 'gap', head: initialAuthorityPosition };
    });
    const checkpoint = vi.fn(async () => ({
      position: { generation: 'g', revision: 'next' },
      state: emptyAuthorityState,
      ...header,
      release,
    }));
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter,
      readEvidence: vi.fn(),
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(release).toHaveBeenCalledTimes(1);
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it('rejects an invalid later record before consuming an otherwise valid first record', async () => {
    const first = { generation: 'g', revision: 'first' };
    const second = { generation: 'g', revision: 'second' };
    const readAfter = vi.fn(async () => ({
      status: 'ok',
      head: second,
      records: [
        {
          previous: initialAuthorityPosition,
          position: first,
          before: authorityReference,
          after: authorityReference,
        },
        {
          previous: first,
          position: second,
          before: { ...authorityReference, nodes: 0 },
          after: authorityReference,
        },
      ],
    }));
    const readEvidence = vi.fn();
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter,
      readEvidence,
      checkpoint: vi.fn(),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(readEvidence).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it.each(['capture', 'evidence'] as const)(
    'rejects a malformed %s lease with receiver-preserving cleanup',
    async (path) => {
      const next = { generation: 'g', revision: 'next' };
      const release = vi.fn(function (this: { token: unknown }) {
        expect(this.token).toBe('');
        return Promise.resolve();
      });
      const lease = {
        position: next,
        state: emptyAuthorityState,
        before: emptyAuthorityState,
        after: emptyAuthorityState,
        token: '',
        expiresAt: Date.now() + 5000,
        release,
      };
      const readAfter = vi.fn(async () =>
        path === 'capture'
          ? { status: 'gap', head: next }
          : {
              status: 'ok',
              head: next,
              records: [
                {
                  previous: initialAuthorityPosition,
                  position: next,
                  before: authorityReference,
                  after: authorityReference,
                },
              ],
            },
      );
      const readEvidence = vi.fn(async () => ({ status: 'available', lease }));
      const checkpoint = vi.fn(async () => lease);
      const driver = {
        head: async () => initialAuthorityPosition,
        readAfter,
        readEvidence,
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
      try {
        await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
        expect(release).toHaveBeenCalledTimes(1);
        expect(readAfter).toHaveBeenCalledTimes(1);
        expect(sent).toEqual([]);
      } finally {
        runtime.close();
      }
    },
  );

  it.each([
    ['missing expiry', { token: 'evidence' }],
    ['NaN expiry', { token: 'evidence', expiresAt: NaN }],
    ['infinite expiry', { token: 'evidence', expiresAt: Infinity }],
    ['fractional expiry', { token: 'evidence', expiresAt: Date.now() + 5000.5 }],
    ['missing token', { expiresAt: Date.now() + 5000 }],
    ['empty token', { token: '', expiresAt: Date.now() + 5000 }],
    ['oversized token', { token: 'x'.repeat(129), expiresAt: Date.now() + 5000 }],
    ['wrong token', { token: 4, expiresAt: Date.now() + 5000 }],
  ] as const)('rejects evidence with %s and releases it once', async (_label, header) => {
    const next = { generation: 'g', revision: 'next' };
    const release = vi.fn(async () => undefined);
    const readAfter = vi.fn(async () => ({
      status: 'ok',
      head: next,
      records: [
        {
          previous: initialAuthorityPosition,
          position: next,
          before: authorityReference,
          after: authorityReference,
        },
      ],
    }));
    const readEvidence = vi.fn(async () => ({
      status: 'available',
      lease: { before: emptyAuthorityState, after: emptyAuthorityState, ...header, release },
    }));
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter,
      readEvidence,
      checkpoint: vi.fn(),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(release).toHaveBeenCalledTimes(1);
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(readEvidence).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it.each(['missing release', 'bad position', 'bad state', 'expired'] as const)(
    'fails a %s capture without installing a private cut',
    async (fault) => {
      const next = { generation: 'g', revision: 'next' };
      const release = vi.fn(async () => undefined);
      const capture = {
        position: fault === 'bad position' ? { generation: 'g', revision: '' } : next,
        state:
          fault === 'bad state'
            ? { elements: null, layers: [], extensions: {} }
            : emptyAuthorityState,
        token: 'token',
        expiresAt: fault === 'expired' ? Date.now() - 1 : Date.now() + 5000,
        ...(fault === 'missing release' ? {} : { release }),
      };
      const readAfter = vi.fn(async () => ({ status: 'gap', head: next }));
      const driver = {
        head: async () => initialAuthorityPosition,
        readAfter,
        readEvidence: vi.fn(),
        checkpoint: async () => capture,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const { runtime, close, sent } = await startResultBoundaryRuntime(driver);
      try {
        await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
        expect(release).toHaveBeenCalledTimes(fault === 'missing release' ? 0 : 1);
        expect(readAfter).toHaveBeenCalledTimes(1);
        expect(sent).toEqual([]);
      } finally {
        runtime.close();
      }
    },
  );

  it.each(['capture', 'evidence'] as const)(
    'owns a late malformed %s lease through cleanup settlement without affecting a same-ID successor',
    async (path) => {
      const next = { generation: 'g', revision: 'next' };
      let provideLease: ((value: unknown) => void) | undefined;
      const late = new Promise<unknown>((resolve) => {
        provideLease = resolve;
      });
      let settleRelease: (() => void) | undefined;
      const release = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settleRelease = resolve;
          }),
      );
      const readAfter = vi.fn(async () =>
        path === 'capture'
          ? { status: 'gap', head: next }
          : {
              status: 'ok',
              head: next,
              records: [
                {
                  previous: initialAuthorityPosition,
                  position: next,
                  before: authorityReference,
                  after: authorityReference,
                },
              ],
            },
      );
      const readEvidence = vi.fn(async () => late);
      const checkpoint = vi.fn(async () => late);
      const driver = {
        head: async () => initialAuthorityPosition,
        readAfter,
        readEvidence,
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const { runtime, connection, sent } = await startResultBoundaryRuntime(driver);
      try {
        await vi.waitFor(() =>
          expect(path === 'capture' ? checkpoint : readEvidence).toHaveBeenCalledTimes(1),
        );
        runtime.remove(connection.id);
        provideLease?.(
          path === 'capture'
            ? {
                position: next,
                state: emptyAuthorityState,
                token: '',
                expiresAt: Date.now() + 5000,
                release,
              }
            : {
                status: 'available',
                lease: {
                  before: emptyAuthorityState,
                  after: emptyAuthorityState,
                  token: '',
                  expiresAt: Date.now() + 5000,
                  release,
                },
              },
        );
        await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
        expect(runtime.pinnedDefinitionId('table')).toBe('definition');
        expect(sent).toEqual([]);
        settleRelease?.();
        await vi.waitFor(() => expect(runtime.pinnedDefinitionId('table')).toBeUndefined());
        const replacement: Connection = {
          ...connection,
          signal: new AbortController().signal,
          close: vi.fn(),
        };
        registerAuthorityConnection(replacement, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        expect(runtime.admit(replacement, definition)).toBe(true);
        expect(replacement.close).not.toHaveBeenCalled();
      } finally {
        settleRelease?.();
        runtime.close();
      }
    },
  );
});

describe('authority runtime commit gate', () => {
  it.each(['evidence', 'gap', 'history-unavailable'] as const)(
    'keeps reordered Unicode visible sets silent through %s and delivers the next visible commit',
    async (path) => {
      const initial = { generation: 'g', revision: 'initial' };
      const hiddenPosition = { generation: 'g', revision: 'hidden' };
      const visiblePosition = { generation: 'g', revision: 'visible' };
      const first = {
        elements: [
          { ...element, id: '\u00e9', audience: 'public' },
          { ...element, id: 'e\u0301', audience: 'public' },
          { ...element, id: 'private', audience: 'hidden' },
        ],
        layers: ['\u00e9', 'e\u0301'].map((id) => ({
          id,
          version: 1,
          editor: 'dm',
          definition: { id, name: id, visible: true, locked: false, order: 0, opacity: 1 },
        })),
        extensions: {},
      };
      const hidden = {
        ...first,
        elements: [
          { ...first.elements[1] },
          { ...first.elements[0] },
          { ...first.elements[2], position: { x: 9, y: 0 } },
        ],
        layers: [...first.layers].reverse(),
      };
      const visible = {
        ...hidden,
        elements: hidden.elements.map((item) =>
          item.id === '\u00e9' ? { ...item, position: { x: 4, y: 0 } } : item,
        ),
      };
      const hiddenRecord = {
        previous: initial,
        position: hiddenPosition,
        before: { id: 'before-hidden', byteLength: 1, nodes: 1 },
        after: { id: 'after-hidden', byteLength: 1, nodes: 1 },
      };
      const visibleRecord = {
        previous: hiddenPosition,
        position: visiblePosition,
        before: { id: 'before-visible', byteLength: 1, nodes: 1 },
        after: { id: 'after-visible', byteLength: 1, nodes: 1 },
      };
      let followUp = false;
      const readAfter = vi.fn(async (_context: unknown, cut: { revision: string }) => {
        if (cut.revision === 'initial')
          return path === 'gap'
            ? { status: 'gap' as const, head: hiddenPosition }
            : { status: 'ok' as const, head: hiddenPosition, records: [hiddenRecord] };
        if (cut.revision === 'hidden' && followUp)
          return { status: 'ok' as const, head: visiblePosition, records: [visibleRecord] };
        if (cut.revision === 'visible')
          return { status: 'ok' as const, head: visiblePosition, records: [] };
        return { status: 'ok' as const, head: hiddenPosition, records: [] };
      });
      const releaseEvidence = vi.fn(async () => undefined);
      const readEvidence = vi.fn(async (_context: unknown, record: typeof hiddenRecord) =>
        record.position.revision === 'hidden' && path === 'history-unavailable'
          ? { status: 'history-unavailable' as const }
          : {
              status: 'available' as const,
              lease: {
                before: record.position.revision === 'hidden' ? first : hidden,
                after: record.position.revision === 'hidden' ? hidden : visible,
                expiresAt: Date.now() + 5000,
                token: 'lease',
                release: releaseEvidence,
              },
            },
      );
      const releaseCapture = vi.fn(async () => undefined);
      const checkpoint = vi.fn(async () => ({
        position: hiddenPosition,
        state: hidden,
        expiresAt: Date.now() + 5000,
        token: 'capture',
        release: releaseCapture,
      }));
      const driver = {
        head: async () => (followUp ? visiblePosition : hiddenPosition),
        readAfter,
        readEvidence,
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const filtered: AuthorityRoomDefinition = {
        ...definition,
        project: (_context, state) => ({
          ...state,
          elements: state.elements.filter((item) => item.audience !== 'hidden'),
        }),
      };
      const fanout = new InMemoryHubFanout();
      const sent: string[] = [];
      const close = vi.fn();
      const connection: Connection = {
        id: 'unicode-reader',
        room: 'table',
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          sent.push(message);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => filtered,
          resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
        },
        fanout,
        'worker',
      );
      try {
        expect(runtime.admit(connection, filtered)).toBe(true);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: connection.id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        sent.length = 0;
        runtime.activate(connection.id, initial, first);
        if (path === 'evidence') {
          await vi.waitFor(() => expect(releaseEvidence).toHaveBeenCalledTimes(1));
          fanout.publish(
            JSON.stringify({
              authority: 1,
              room: 'table',
              definitionId: 'definition',
              position: hiddenPosition,
            }),
          );
        }
        await vi.waitFor(() =>
          expect(readAfter.mock.calls.some((call) => call[1].revision === 'hidden')).toBe(true),
        );
        expect(sent).toEqual([]);
        expect(close).not.toHaveBeenCalled();
        expect(releaseEvidence).toHaveBeenCalledTimes(path === 'evidence' ? 1 : 0);
        expect(releaseCapture).toHaveBeenCalledTimes(path === 'evidence' ? 0 : 1);
        followUp = true;
        fanout.publish(
          JSON.stringify({
            authority: 1,
            room: 'table',
            definitionId: 'definition',
            position: visiblePosition,
          }),
        );
        await vi.waitFor(() =>
          expect(sent.filter((message) => JSON.parse(message).kind === 'changes')).toHaveLength(1),
        );
        expect(sent.map((message) => JSON.parse(message).kind)).toEqual(['changes']);
        expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
          cursor: { revision: 1 },
          mutations: [{ kind: 'upsert', element: { id: '\u00e9', position: { x: 4 } } }],
        });
        expect(releaseEvidence).toHaveBeenCalledTimes(path === 'evidence' ? 2 : 1);
        expect(close).not.toHaveBeenCalled();
      } finally {
        runtime.close();
      }
    },
  );

  it.each(['gap', 'history-unavailable'] as const)(
    'recovers a changed visible Unicode set through %s',
    async (path) => {
      const initial = { generation: 'g', revision: 'initial' };
      const next = { generation: 'g', revision: 'next' };
      const before = {
        elements: [
          { ...element, id: '\u00e9' },
          { ...element, id: 'e\u0301' },
        ],
        layers: [],
        extensions: {},
      };
      const changed = {
        ...before,
        elements: [{ ...before.elements[1] }, { ...before.elements[0], position: { x: 4, y: 0 } }],
      };
      const checkpoint = vi.fn(async () => ({
        position: next,
        state: changed,
        token: 'capture',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }));
      const driver = {
        head: async () => initial,
        readAfter: async () =>
          path === 'gap'
            ? { status: 'gap', head: next }
            : {
                status: 'ok',
                head: next,
                records: [
                  {
                    previous: initial,
                    position: next,
                    before: { id: 'before', byteLength: 1, nodes: 1 },
                    after: { id: 'after', byteLength: 1, nodes: 1 },
                  },
                ],
              },
        readEvidence: async () => ({ status: 'history-unavailable' }),
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const sent: string[] = [];
      const close = vi.fn();
      const connection: Connection = {
        id: 'changed-reader',
        room: 'table',
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          sent.push(message);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => definition,
          resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
        },
        new InMemoryHubFanout(),
        'worker',
      );
      try {
        expect(runtime.admit(connection, definition)).toBe(true);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: connection.id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        sent.length = 0;
        runtime.activate(connection.id, initial, before);
        await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
        await vi.waitFor(() =>
          expect(sent.some((message) => JSON.parse(message).kind === 'resync-required')).toBe(true),
        );
        expect(close).not.toHaveBeenCalled();
      } finally {
        runtime.close();
      }
    },
  );
  it('bounds mixed heads, heavy replay retries, claim and mark at eight metadata calls', async () => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    const empty = { elements: [], layers: [], extensions: {} };
    const record = {
      previous: initial,
      position: next,
      before: { id: 'before', byteLength: 1, nodes: 1 },
      after: { id: 'after', byteLength: 1, nodes: 1 },
    };
    let active = 0;
    let peak = 0;
    const metadata = <T>(work: Promise<T>): Promise<T> => {
      active++;
      peak = Math.max(peak, active);
      return work.finally(() => {
        active--;
      });
    };
    let finishClaim: ((value: readonly unknown[]) => void) | undefined;
    const firstClaim = new Promise<readonly unknown[]>((resolve) => {
      finishClaim = resolve;
    });
    let finishMark: (() => void) | undefined;
    const mark = new Promise<void>((resolve) => {
      finishMark = resolve;
    });
    const headFinishes: (() => void)[] = [];
    const head = vi.fn((context: { connectionId: string }) =>
      context.connectionId.startsWith('pending-')
        ? metadata(
            new Promise<typeof initial>((resolve) => headFinishes.push(() => resolve(initial))),
          )
        : metadata(Promise.resolve(initial)),
    );
    let finishHolders: (() => void)[] = [];
    const heldEvidence = new Promise<void>((resolve) => {
      finishHolders = [resolve];
    });
    const readAfter = vi.fn((context: { connectionId: string }) => {
      if (!context.connectionId) throw new Error('missing peer ID');
      return metadata(Promise.resolve({ status: 'ok' as const, head: next, records: [record] }));
    });
    const claim = {
      room: 'other-room',
      definitionId: definition.id,
      position: next,
      ownerId: 'worker',
      token: 'claim',
      expiresAt: Date.now() + 5000,
    };
    const claimPublications = vi
      .fn()
      .mockImplementationOnce(() => metadata(firstClaim))
      .mockImplementation(() => metadata(Promise.resolve([])));
    const markPublished = vi.fn(() => metadata(mark));
    const readEvidence = vi.fn(async (context: { connectionId: string }) => {
      if (context.connectionId.startsWith('holder-')) await heldEvidence;
      return {
        status: 'available',
        lease: {
          before: empty,
          after: empty,
          token: 'lease',
          expiresAt: Date.now() + 5000,
          release: async () => undefined,
        },
      };
    });
    const driver = {
      head,
      readAfter,
      readEvidence,
      claimPublications,
      markPublished,
    } as unknown as AuthorityDriver;
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const controllers: AbortController[] = [];
    const join = async (id: string, live: boolean): Promise<void> => {
      const controller = new AbortController();
      controllers.push(controller);
      const connection: Connection = {
        id,
        room: id,
        signal: controller.signal,
        close: vi.fn(),
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
      });
      expect(runtime.admit(connection, definition)).toBe(true);
      const negotiation = runtime.handleMessage(
        id,
        JSON.stringify({
          from: id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      if (live) {
        await negotiation;
        runtime.activate(id, initial, empty);
      }
    };
    try {
      await vi.waitFor(() => expect(claimPublications).toHaveBeenCalledTimes(1));
      for (const id of ['holder-1', 'holder-2', 'retry-1', 'retry-2']) await join(id, true);
      await vi.waitFor(() => expect(readAfter).toHaveBeenCalledTimes(4));
      for (let index = 0; index < 8; index++) await join(`pending-${index}`, false);
      await vi.waitFor(() => expect(headFinishes).toHaveLength(5));
      expect(peak).toBeLessThanOrEqual(8);
      finishClaim?.([claim]);
      await vi.waitFor(() => expect(markPublished).toHaveBeenCalledTimes(1));
      expect(peak).toBeLessThanOrEqual(8);
      finishHolders.forEach((finish) => finish());
      await vi.waitFor(() => expect(readEvidence).toHaveBeenCalledTimes(4));
      await vi.waitFor(() => expect(headFinishes).toHaveLength(7));
      expect(
        readAfter.mock.calls.filter((call) => call[0].connectionId.startsWith('retry-')),
      ).toHaveLength(2);
      expect(headFinishes).toHaveLength(7);
      headFinishes[0]?.();
      await vi.waitFor(() => expect(headFinishes).toHaveLength(8));
      expect(peak).toBeLessThanOrEqual(8);
      controllers.forEach((controller) => controller.abort());
      runtime.close();
      expect(active).toBeGreaterThan(0);
      headFinishes.forEach((finish) => finish());
      finishMark?.();
      await vi.waitFor(() => expect(active).toBe(0));
      expect(
        readAfter.mock.calls.filter((call) => call[0].connectionId.startsWith('retry-')),
      ).toHaveLength(2);
    } finally {
      finishClaim?.([]);
      finishHolders.forEach((finish) => finish());
      headFinishes.forEach((finish) => finish());
      finishMark?.();
      runtime.close();
    }
  });
  it('keeps a replacement with the same ID after the old head settles and old lifetime aborts', async () => {
    let finishOld: ((value: { generation: string; revision: string }) => void) | undefined;
    const head = vi.fn((context: { connectionId: string }) =>
      context.connectionId === 'same' && head.mock.calls.length === 1
        ? new Promise<{ generation: string; revision: string }>((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve({ generation: 'g', revision: 'r' }),
    );
    const driver = {
      head,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const oldController = new AbortController();
    const makeConnection = (signal: AbortSignal): Connection => {
      const connection: Connection = {
        id: 'same',
        room: 'table',
        signal,
        close: vi.fn(),
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
      });
      return connection;
    };
    const capabilities = JSON.stringify({
      from: 'same',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    });
    try {
      const old = makeConnection(oldController.signal);
      expect(runtime.admit(old, definition)).toBe(true);
      const oldWork = runtime.handleMessage('same', capabilities);
      await vi.waitFor(() => expect(head).toHaveBeenCalledTimes(1));
      runtime.remove('same');
      finishOld?.({ generation: 'g', revision: 'r' });
      await oldWork;
      await vi.waitFor(() => expect(runtime.pinnedDefinitionId('table')).toBeUndefined());
      const replacementController = new AbortController();
      const replacement = makeConnection(replacementController.signal);
      expect(runtime.admit(replacement, definition)).toBe(true);
      oldController.abort();
      await runtime.handleMessage('same', capabilities);
      expect(head).toHaveBeenCalledTimes(2);
      expect(replacement.close).not.toHaveBeenCalled();
      expect(replacementController.signal.aborted).toBe(false);
    } finally {
      finishOld?.({ generation: 'g', revision: 'r' });
      runtime.close();
    }
  });

  it.each([
    { result: { status: 'integration-typo' } },
    { result: null },
    { result: { status: 'available' } },
    { result: { status: 'generation-changed', head: null } },
  ])(
    'fails one malformed evidence result without retrying an unchanged cut: $result',
    async ({ result }) => {
      const initial = { generation: 'g', revision: 'first' };
      const next = { generation: 'g', revision: 'second' };
      const readAfter = vi.fn(async () => {
        if (readAfter.mock.calls.length > 2) throw new Error('probe guard');
        return {
          status: 'ok' as const,
          head: next,
          records: [
            {
              previous: initial,
              position: next,
              before: { id: 'before', byteLength: 1, nodes: 1 },
              after: { id: 'after', byteLength: 1, nodes: 1 },
            },
          ],
        };
      });
      const checkpoint = vi.fn();
      const driver = {
        head: async () => initial,
        readAfter,
        readEvidence: async () => result,
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const close = vi.fn();
      const connection: Connection = {
        id: 'malformed',
        room: 'table',
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
      });
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => definition,
          resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
        },
        new InMemoryHubFanout(),
        'worker',
      );
      try {
        expect(runtime.admit(connection, definition)).toBe(true);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: connection.id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        runtime.activate(connection.id, initial, { elements: [], layers: [], extensions: {} });
        await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
        expect(readAfter).toHaveBeenCalledTimes(1);
        expect(checkpoint).not.toHaveBeenCalled();
      } finally {
        runtime.close();
      }
    },
  );

  it.each([
    { output: [{ kind: 'extension', extensionKind: 'synthetic-change' }] },
    { output: { kind: 'extension', extensionKind: 'synthetic-change', payload: 1 } },
  ])('closes on invalid extension changes without recovery or mutation', async ({ output }) => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    const extension = {
      requirement: {
        key: 'synthetic',
        pluginName: 'test',
        version: 1,
        validate: (data: unknown) => typeof data === 'number',
      },
      extensionKinds: ['synthetic-change'],
      prepare: () => null,
      changes: () => output,
    };
    const localDefinition = {
      ...definition,
      extensions: [extension],
    } as unknown as AuthorityRoomDefinition;
    const state = (data: number) => ({
      elements: [],
      layers: [],
      extensions: { synthetic: { pluginName: 'test', version: 1, data } },
    });
    const checkpoint = vi.fn();
    const readAfter = vi.fn(async () => ({
      status: 'ok' as const,
      head: next,
      records: [
        {
          previous: initial,
          position: next,
          before: { id: 'before', byteLength: 1, nodes: 1 },
          after: { id: 'after', byteLength: 1, nodes: 1 },
        },
      ],
    }));
    const driver = {
      head: async () => initial,
      readAfter,
      readEvidence: async () => ({
        status: 'available',
        lease: {
          before: state(0),
          after: state(1),
          expiresAt: Date.now() + 5000,
          token: 'lease',
          release: async () => undefined,
        },
      }),
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const frames: string[] = [];
    const connection: Connection = {
      id: 'bad-extension',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (frame) => {
        frames.push(frame);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => localDefinition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      expect(runtime.admit(connection, localDefinition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities(
              ['synthetic-change'],
              [extension.requirement],
            ),
          },
        }),
      );
      runtime.activate(connection.id, initial, state(0));
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(checkpoint).not.toHaveBeenCalled();
      expect(
        frames.some(
          (frame) =>
            ['changes', 'resync-required'].includes(JSON.parse(frame).kind) &&
            JSON.parse(frame).reason === 'gap',
        ),
      ).toBe(false);
      expect(frames.some((frame) => JSON.parse(frame).kind === 'changes')).toBe(false);
    } finally {
      runtime.close();
    }
  });

  it('rejects an unknown metadata page status before reading its records', async () => {
    const initial = { generation: 'g', revision: 'first' };
    const readEvidence = vi.fn();
    const driver = {
      head: async () => initial,
      readAfter: async () => ({
        status: 'integration-typo',
        head: initial,
        records: [
          {
            previous: initial,
            position: { generation: 'g', revision: 'second' },
            before: { id: 'before', byteLength: 1, nodes: 1 },
            after: { id: 'after', byteLength: 1, nodes: 1 },
          },
        ],
      }),
      readEvidence,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const connection: Connection = {
      id: 'bad-page',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      runtime.activate(connection.id, initial, { elements: [], layers: [], extensions: {} });
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(readEvidence).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });
  it('bounds 32 simultaneous and 40 disconnect/reconnect negotiation heads at eight', async () => {
    const finish: (() => void)[] = [];
    const head = vi.fn(
      () =>
        new Promise<{ generation: string; revision: string }>((resolve) =>
          finish.push(() => resolve({ generation: 'g', revision: 'r' })),
        ),
    );
    const driver = {
      head,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const pending: Promise<void>[] = [];
    const close: ReturnType<typeof vi.fn>[] = [];
    const controllers: AbortController[] = [];
    try {
      for (let index = 0; index < 32; index++) {
        const controller = new AbortController();
        controllers.push(controller);
        const connection: Connection = {
          id: `peer-${index}`,
          room: `room-${index}`,
          signal: controller.signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        close.push(connection.close as ReturnType<typeof vi.fn>);
        registerAuthorityConnection(connection, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        runtime.admit(connection, definition);
        pending.push(
          runtime.handleMessage(
            connection.id,
            JSON.stringify({
              from: connection.id,
              op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
            }),
          ),
        );
      }
      await vi.waitFor(() => expect(head).toHaveBeenCalledTimes(8));
      controllers.forEach((controller) => controller.abort());
      for (let index = 32; index < 40; index++) {
        const controller = new AbortController();
        const connection: Connection = {
          id: `peer-${index}`,
          room: `room-${index}`,
          signal: controller.signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        registerAuthorityConnection(connection, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        runtime.admit(connection, definition);
        pending.push(
          runtime.handleMessage(
            connection.id,
            JSON.stringify({
              from: connection.id,
              op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
            }),
          ),
        );
        controller.abort();
      }
      expect(head).toHaveBeenCalledTimes(8);
      expect(close.slice(0, 8).every((fn) => !fn.mock.calls.length)).toBe(true);
      finish[0]?.();
      await vi.waitFor(() => expect(runtime.pinnedDefinitionId('room-0')).toBeUndefined());
      expect(head).toHaveBeenCalledTimes(8);
      finish.forEach((resolve) => resolve());
      await Promise.all(pending);
      expect(head).toHaveBeenCalledTimes(8);
      await vi.waitFor(() => expect(runtime.pinnedDefinitionId('room-7')).toBeUndefined());
    } finally {
      finish.forEach((resolve) => resolve());
      runtime.close();
    }
  });
  it('rejects an opaque head whose UTF-8 position exceeds the byte bound', async () => {
    const driver = {
      head: async () => ({ generation: 'g', revision: 'é'.repeat(65) }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const connection: Connection = {
      id: 'wide-head',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: () => ({
        completion: Promise.resolve(),
        settled: Promise.resolve(),
      }),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'wide-head',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      expect(close).toHaveBeenCalledWith(1013);
    } finally {
      runtime.close();
    }
  });

  it('polls an active head to recover a lost final publication wake', async () => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    let head = initial;
    const readAfter = vi.fn(async (_context: unknown, afterPosition: { revision: string }) =>
      head === initial || afterPosition.revision === next.revision
        ? { status: 'ok' as const, head, records: [] }
        : { status: 'gap' as const, head },
    );
    const driver = {
      head: vi.fn(async () => head),
      readAfter,
      checkpoint: async () => ({
        position: next,
        state: { elements: [], layers: [], extensions: {} },
        token: 'capture',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const connection: Connection = {
      id: 'poll-reader',
      room: 'table',
      signal: new AbortController().signal,
      close: vi.fn(),
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: () => ({
        completion: Promise.resolve(),
        settled: Promise.resolve(),
      }),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'poll-reader',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      runtime.activate(connection.id, initial, { elements: [], layers: [], extensions: {} });
      await vi.waitFor(() => expect(readAfter).toHaveBeenCalledTimes(1));
      head = next;
      await vi.waitFor(() => expect(readAfter.mock.calls.length).toBeGreaterThanOrEqual(2), {
        timeout: 2500,
      });
      expect(driver.head).toHaveBeenCalledTimes(2);
    } finally {
      runtime.close();
    }
  });

  it('releases evidence before sending and waits for actual send settlement before another read', async () => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    const newest = { generation: 'g', revision: 'third' };
    let head = next;
    const before = { elements: [], layers: [], extensions: {} };
    const after = { elements: [element], layers: [], extensions: {} };
    const afterNewest = {
      elements: [{ ...element, position: { x: 3, y: 0 } }],
      layers: [],
      extensions: {},
    };
    const releaseEvidence = vi.fn(async () => undefined);
    let resumeEvidence: (() => void) | undefined;
    let evidenceReached: (() => void) | undefined;
    const evidenceGate = new Promise<void>((resolve) => {
      resumeEvidence = resolve;
    });
    const evidenceStarted = new Promise<void>((resolve) => {
      evidenceReached = resolve;
    });
    const readAfter = vi.fn(async (_context: unknown, afterPosition: { revision: string }) =>
      afterPosition.revision === 'first'
        ? {
            status: 'ok' as const,
            head,
            records: [
              {
                previous: initial,
                position: next,
                before: { id: 'before', byteLength: 1, nodes: 1 },
                after: { id: 'after', byteLength: 1, nodes: 1 },
              },
            ],
          }
        : afterPosition.revision === 'second' && head === newest
          ? {
              status: 'ok' as const,
              head,
              records: [
                {
                  previous: next,
                  position: newest,
                  before: { id: 'before2', byteLength: 1, nodes: 1 },
                  after: { id: 'after2', byteLength: 1, nodes: 1 },
                },
              ],
            }
          : { status: 'ok' as const, head, records: [] },
    );
    const driver = {
      head: async () => initial,
      readAfter,
      readEvidence: async (_context: unknown, record: { position: { revision: string } }) => {
        evidenceReached?.();
        await evidenceGate;
        return {
          status: 'available',
          lease: {
            before: record.position.revision === 'third' ? after : before,
            after: record.position.revision === 'third' ? afterNewest : after,
            expiresAt: Date.now() + 5000,
            token: 'lease',
            release: releaseEvidence,
          },
        };
      },
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    let complete: (() => void) | undefined;
    let settle: (() => void) | undefined;
    const sent: string[] = [];
    const connection: Connection = {
      id: 'slow',
      room: 'table',
      signal: new AbortController().signal,
      close: vi.fn(),
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        if (JSON.parse(message).kind !== 'changes')
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        return {
          completion: new Promise<void>((resolve) => {
            complete = resolve;
          }),
          settled: new Promise<void>((resolve) => {
            settle = resolve;
          }),
        };
      },
    });
    const fanout = new InMemoryHubFanout();
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      fanout,
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'slow',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      runtime.activate(connection.id, initial, before);
      await evidenceStarted;
      fanout.publish(
        JSON.stringify({ authority: 1, room: 'table', definitionId: 'definition', position: next }),
      );
      resumeEvidence?.();
      await vi.waitFor(() => expect(complete).toBeDefined());
      expect(releaseEvidence).toHaveBeenCalledTimes(1);
      expect(readAfter).toHaveBeenCalledTimes(1);
      expect(sent.filter((message) => JSON.parse(message).kind === 'changes')).toHaveLength(1);
      head = newest;
      complete?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readAfter).toHaveBeenCalledTimes(1);
      settle?.();
      await vi.waitFor(() => expect(readAfter.mock.calls.length).toBeGreaterThanOrEqual(2));
      await vi.waitFor(() =>
        expect(sent.filter((message) => JSON.parse(message).kind === 'changes')).toHaveLength(2),
      );
      expect(
        sent
          .filter((message) => JSON.parse(message).kind === 'changes')
          .map((message) => JSON.parse(message).cursor.revision),
      ).toEqual([1, 2]);
    } finally {
      resumeEvidence?.();
      complete?.();
      settle?.();
      runtime.close();
    }
  });

  it.each(['disconnect', 'shutdown', 'timeout'] as const)(
    'releases a late available lease after %s and retains its heavy slot until release settles',
    async (ending) => {
      const initial = { generation: 'g', revision: 'first' };
      const next = { generation: 'g', revision: 'second' };
      let provideEvidence:
        | ((result: Awaited<ReturnType<AuthorityDriver['readEvidence']>>) => void)
        | undefined;
      const evidence = new Promise<Awaited<ReturnType<AuthorityDriver['readEvidence']>>>(
        (resolve) => {
          provideEvidence = resolve;
        },
      );
      let finishRelease: (() => void) | undefined;
      const release = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRelease = resolve;
          }),
      );
      const otherRelease = vi.fn(async () => undefined);
      const empty = { elements: [], layers: [], extensions: {} };
      const driver = {
        head: async () => initial,
        readAfter: async () => ({
          status: 'ok',
          head: next,
          records: [
            {
              previous: initial,
              position: next,
              before: { id: 'b', byteLength: 1, nodes: 1 },
              after: { id: 'a', byteLength: 1, nodes: 1 },
            },
          ],
        }),
        readEvidence: vi.fn((context: { connectionId: string }) =>
          context.connectionId === 'late'
            ? evidence
            : Promise.resolve({
                status: 'available',
                lease: {
                  before: empty,
                  after: empty,
                  token: 'other',
                  expiresAt: Date.now() + 5000,
                  release: otherRelease,
                },
              }),
        ),
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const sent: string[] = [];
      const controller = new AbortController();
      const connection: Connection = {
        id: 'late',
        room: 'table',
        signal: controller.signal,
        expiresAt: ending === 'timeout' ? Date.now() + 200 : undefined,
        close: vi.fn(),
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          sent.push(message);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => definition,
          resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
        },
        new InMemoryHubFanout(),
        'worker',
      );
      try {
        runtime.admit(connection, definition);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: connection.id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        runtime.activate(connection.id, initial, { elements: [], layers: [], extensions: {} });
        await vi.waitFor(() => expect(driver.readEvidence).toHaveBeenCalledTimes(1));
        sent.length = 0;
        if (ending === 'disconnect') controller.abort();
        else if (ending === 'shutdown') runtime.close();
        else await vi.waitFor(() => expect(connection.close).toHaveBeenCalledWith(1013));
        provideEvidence?.({
          status: 'available',
          lease: {
            before: { elements: [], layers: [], extensions: {} },
            after: { elements: [element], layers: [], extensions: {} },
            token: 'late',
            expiresAt: Date.now() + 5000,
            release,
          },
        });
        await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
        expect(runtime.pinnedDefinitionId('table')).toBe('definition');
        expect(sent).toEqual([]);
        if (ending !== 'shutdown') {
          const other: Connection = {
            id: 'other',
            room: 'table',
            signal: new AbortController().signal,
            close: vi.fn(),
            send: vi.fn(),
          };
          registerAuthorityConnection(other, {
            sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
          });
          expect(runtime.admit(other, definition)).toBe(true);
          await runtime.handleMessage(
            other.id,
            JSON.stringify({
              from: other.id,
              op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
            }),
          );
          runtime.activate(other.id, initial, empty);
          await vi.waitFor(() => expect(otherRelease).toHaveBeenCalledTimes(1));
          expect(release).toHaveBeenCalledTimes(1);
          runtime.remove(other.id);
        }
        finishRelease?.();
        await vi.waitFor(() => expect(runtime.pinnedDefinitionId('table')).toBeUndefined());
      } finally {
        finishRelease?.();
        runtime.close();
      }
    },
  );

  it('selects recovery for a valid visible batch too large for its actual cursor', async () => {
    const initial = { generation: 'g'.repeat(128), revision: 'first' };
    const next = { ...initial, revision: 'second' };
    const extension = {
      requirement: {
        key: 'large',
        pluginName: 'test',
        version: 1,
        validate: (data: unknown) => typeof data === 'string',
      },
      extensionKinds: ['large-change'],
      prepare: () => null,
      changes: (_before: unknown, value: unknown) => [
        { kind: 'extension' as const, extensionKind: 'large-change', payload: value },
      ],
    };
    const largeDefinition: AuthorityRoomDefinition = { ...definition, extensions: [extension] };
    const before = {
      elements: [],
      layers: [],
      extensions: { large: { pluginName: 'test', version: 1, data: '' } },
    };
    const after = {
      elements: [],
      layers: [],
      extensions: { large: { pluginName: 'test', version: 1, data: 'x'.repeat(1_048_350) } },
    };
    const release = vi.fn(async () => undefined);
    const driver = {
      head: async () => initial,
      readAfter: async () => ({
        status: 'ok',
        head: next,
        records: [
          {
            previous: initial,
            position: next,
            before: { id: 'b', byteLength: 1, nodes: 1 },
            after: { id: 'a', byteLength: 1, nodes: 1 },
          },
        ],
      }),
      readEvidence: async () => ({
        status: 'available',
        lease: { before, after, expiresAt: Date.now() + 5000, token: 'lease', release },
      }),
      checkpoint: async () => ({
        position: next,
        state: after,
        expiresAt: Date.now() + 5000,
        token: 'capture',
        release,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'large',
      room: 'table',
      signal: new AbortController().signal,
      send: vi.fn(),
      close,
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => largeDefinition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, largeDefinition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities(['large-change'], [extension.requirement]),
          },
        }),
      );
      runtime.activate(connection.id, initial, before);
      await vi.waitFor(() =>
        expect(sent.some((message) => JSON.parse(message).reason === 'gap')).toBe(true),
      );
      expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      runtime.close();
    }
  });

  it("does not let a removed peer's late send settlement clear another peer's barrier", async () => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    const empty = { elements: [], layers: [], extensions: {} };
    const visible = { elements: [element], layers: [], extensions: {} };
    const readAfter = vi.fn(async (context: { connectionId: string }, cut: { revision: string }) =>
      cut.revision === 'first'
        ? {
            status: 'ok' as const,
            head: next,
            records: [
              {
                previous: initial,
                position: next,
                before: { id: `b-${context.connectionId}`, byteLength: 1, nodes: 1 },
                after: { id: `a-${context.connectionId}`, byteLength: 1, nodes: 1 },
              },
            ],
          }
        : { status: 'ok' as const, head: next, records: [] },
    );
    const driver = {
      head: async () => initial,
      readAfter,
      readEvidence: async () => ({
        status: 'available',
        lease: {
          before: empty,
          after: visible,
          token: 'e',
          expiresAt: Date.now() + 5000,
          release: async () => undefined,
        },
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const fanout = new InMemoryHubFanout();
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'a', ownershipId: 'o' }),
      },
      fanout,
      'worker',
    );
    const gates = new Map<string, { complete: () => void; settle: () => void }>();
    try {
      for (const id of ['old', 'other']) {
        const connection: Connection = {
          id,
          room: 'table',
          signal: new AbortController().signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        registerAuthorityConnection(connection, {
          sendTracked: (message) => {
            if (JSON.parse(message).kind !== 'changes')
              return { completion: Promise.resolve(), settled: Promise.resolve() };
            let complete: (() => void) | undefined;
            let settle: (() => void) | undefined;
            const completion = new Promise<void>((resolve) => {
              complete = resolve;
            });
            const settled = new Promise<void>((resolve) => {
              settle = resolve;
            });
            gates.set(id, { complete: () => complete?.(), settle: () => settle?.() });
            return { completion, settled };
          },
        });
        runtime.admit(connection, definition);
        await runtime.handleMessage(
          id,
          JSON.stringify({
            from: id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        runtime.activate(id, initial, empty);
      }
      await vi.waitFor(() => expect(gates.size).toBe(2));
      runtime.remove('old');
      gates.get('old')?.complete();
      gates.get('old')?.settle();
      fanout.publish(
        JSON.stringify({ authority: 1, room: 'table', definitionId: 'definition', position: next }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readAfter.mock.calls.filter((call) => call[0].connectionId === 'other')).toHaveLength(
        1,
      );
      gates.get('other')?.complete();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readAfter.mock.calls.filter((call) => call[0].connectionId === 'other')).toHaveLength(
        1,
      );
      gates.get('other')?.settle();
      await vi.waitFor(() =>
        expect(
          readAfter.mock.calls.filter((call) => call[0].connectionId === 'other').length,
        ).toBeGreaterThanOrEqual(2),
      );
    } finally {
      for (const gate of gates.values()) {
        gate.complete();
        gate.settle();
      }
      runtime.close();
    }
  });

  it('replays committed evidence to the author with contiguous visible cursors and private silence', async () => {
    const store = new AuthorityFixtureStore();
    store.now = Date.now();
    store.provision('table');
    const driver = new AuthorityFixtureDriver(store);
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'author',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const filtered: AuthorityRoomDefinition = {
      ...definition,
      project: (_context, state) => ({
        ...state,
        elements: state.elements.filter((item) => item.audience !== 'hidden'),
      }),
    };
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => filtered,
        resolveIdentity: () => ({ actorId: 'author', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const frames = () => sent.map((message) => JSON.parse(message));
    const changes = () => frames().filter((frame) => frame.kind === 'changes');
    try {
      runtime.admit(connection, filtered);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'author',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      const initial = store.getRoom('table');
      if (!initial) throw new Error('missing fixture room');
      runtime.activate(connection.id, initial.position, initial.state);
      sent.length = 0;
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now), {
          kind: 'upsert',
          element: { ...element, audience: 'public' },
        }),
      );
      await vi.waitFor(() => expect(changes()).toHaveLength(1));
      expect(changes()[0]).toMatchObject({
        cursor: { generation: 'g', revision: 1 },
        mutations: [{ kind: 'upsert', element: { id: 'shape' } }],
      });
      expect(JSON.stringify(changes())).not.toContain('owner');
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now + 1), {
          kind: 'upsert',
          element: { ...element, audience: 'hidden' },
        }),
      );
      await vi.waitFor(() => expect(changes()).toHaveLength(2));
      expect(changes()[1]).toMatchObject({
        cursor: { revision: 2 },
        mutations: [{ kind: 'remove', id: 'shape' }],
      });
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now + 2), {
          kind: 'upsert',
          element: { ...element, audience: 'hidden', position: { x: 9, y: 0 } },
        }),
      );
      await vi.waitFor(() =>
        expect(frames().filter((frame) => frame.kind === 'receipt')).toHaveLength(3),
      );
      expect(changes()).toHaveLength(2);
      expect(close).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it.each(['gap', 'bad-link'] as const)(
    'handles a $case metadata page without leaking state',
    async (caseName) => {
      const initial = { generation: 'g', revision: 'initial' };
      const next = { generation: 'g', revision: 'opaque-next' };
      let pageCalls = 0;
      const readAfter = vi.fn(async () => {
        pageCalls++;
        return caseName === 'gap'
          ? pageCalls === 1
            ? { status: 'gap' as const, head: next }
            : { status: 'ok' as const, head: next, records: [] }
          : {
              status: 'ok' as const,
              head: next,
              records: [
                {
                  previous: { generation: 'g', revision: 'wrong' },
                  position: next,
                  before: { id: 'before', byteLength: 2, nodes: 1 },
                  after: { id: 'after', byteLength: 2, nodes: 1 },
                },
              ],
            };
      });
      const releaseLease = vi.fn(async () => undefined);
      const checkpoint = vi.fn(async () => ({
        position: next,
        state: { elements: [], layers: [], extensions: {} },
        token: 'token',
        expiresAt: Date.now() + 5000,
        release: releaseLease,
      }));
      const readEvidence = vi.fn();
      const driver = {
        head: async () => initial,
        readAfter,
        readEvidence,
        checkpoint,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      } as unknown as AuthorityDriver;
      const sent: string[] = [];
      const close = vi.fn();
      const connection: Connection = {
        id: 'reader',
        room: 'table',
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          sent.push(message);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => definition,
          resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
        },
        new InMemoryHubFanout(),
        'worker',
      );
      try {
        runtime.admit(connection, definition);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: 'reader',
            op: {
              kind: 'capabilities',
              capabilities: createAuthorityCapabilities([]),
            },
          }),
        );
        sent.length = 0;
        runtime.activate(connection.id, initial, { elements: [], layers: [], extensions: {} });
        if (caseName === 'gap') {
          await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
          await vi.waitFor(() => expect(releaseLease).toHaveBeenCalledTimes(1));
          expect(sent).toEqual([]);
          expect(close).not.toHaveBeenCalled();
        } else {
          await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
          expect(readEvidence).not.toHaveBeenCalled();
          expect(sent).toEqual([]);
        }
      } finally {
        runtime.close();
      }
    },
  );

  it('reconciles when current projection policy changes the pinned before image', async () => {
    const initial = { generation: 'g', revision: 'first' };
    const next = { generation: 'g', revision: 'second' };
    const before = { elements: [{ ...element, ownerId: 'owner' }], layers: [], extensions: {} };
    const after = {
      elements: [{ ...element, ownerId: 'owner', position: { x: 1, y: 0 } }],
      layers: [],
      extensions: {},
    };
    let visible = true;
    const dynamic: AuthorityRoomDefinition = {
      ...definition,
      project: (_context, state) => ({ ...state, elements: visible ? state.elements : [] }),
    };
    const releaseEvidence = vi.fn(async () => undefined);
    const driver = {
      head: async () => initial,
      readAfter: async () => ({
        status: 'ok',
        head: next,
        records: [
          {
            previous: initial,
            position: next,
            before: { id: 'before', byteLength: 1, nodes: 1 },
            after: { id: 'after', byteLength: 1, nodes: 1 },
          },
        ],
      }),
      readEvidence: async () => ({
        status: 'available',
        lease: {
          before,
          after,
          expiresAt: Date.now() + 5000,
          token: 'lease',
          release: releaseEvidence,
        },
      }),
      checkpoint: async () => ({
        position: next,
        state: after,
        expiresAt: Date.now() + 5000,
        token: 'capture',
        release: async () => undefined,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'reader',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => dynamic,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, dynamic);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'reader',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      sent.length = 0;
      runtime.activate(connection.id, initial, before);
      visible = false;
      await vi.waitFor(() =>
        expect(sent.some((message) => JSON.parse(message).kind === 'resync-required')).toBe(true),
      );
      expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(false);
      expect(releaseEvidence).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it('refuses proposals before a completed initial checkpoint', async () => {
    const commit = vi.fn();
    const driver = {
      head: async () => ({ generation: 'g', revision: 'initial' }),
      commit,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'early',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'early',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(), { kind: 'upsert', element }),
      );
      expect(commit).not.toHaveBeenCalled();
      expect(sent.some((message) => JSON.parse(message).kind === 'upgrade-required')).toBe(true);
      expect(close).toHaveBeenCalledWith(4406);
    } finally {
      runtime.close();
    }
  });

  it('closes on changed capabilities after negotiation', async () => {
    const driver = {
      head: async () => ({ generation: 'g', revision: 'initial' }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const connection: Connection = {
      id: 'changed',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: () => ({
        completion: Promise.resolve(),
        settled: Promise.resolve(),
      }),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'changed',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'changed',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      expect(close).not.toHaveBeenCalled();
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'changed',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities(['extra']),
          },
        }),
      );
      expect(close).toHaveBeenCalledWith(4406);
    } finally {
      runtime.close();
    }
  });

  it('sends a definitive driver rejection without receipt or accepted state', async () => {
    const store = new AuthorityFixtureStore();
    store.now = Date.now();
    store.provision('table');
    store.policy.canWrite = () => false;
    const driver = new AuthorityFixtureDriver(store);
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'rejected',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'rejected',
          op: {
            kind: 'capabilities',
            capabilities: createAuthorityCapabilities([]),
          },
        }),
      );
      const initial = store.getRoom('table');
      if (!initial) throw new Error('missing fixture room');
      runtime.activate(connection.id, initial.position, initial.state);
      sent.length = 0;
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now), { kind: 'upsert', element }),
      );
      expect(sent.map((message) => JSON.parse(message).kind)).toContain('rejected');
      expect(sent.map((message) => JSON.parse(message).kind)).not.toContain('receipt');
      expect(store.getRoom('table')?.state.elements).toEqual([]);
      expect(close).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });
  it('has no receipt, state or fanout side effects before durable commit settles', async () => {
    const store = new AuthorityFixtureStore();
    store.now = Date.now();
    store.provision('table');
    const actual = new AuthorityFixtureDriver(store);
    let release: (() => void) | undefined;
    let stall = true;
    const commit = vi.fn(async (...args: Parameters<AuthorityDriver['commit']>) => {
      if (stall) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        stall = false;
      }
      return actual.commit(...args);
    });
    const driver = {
      ...actual,
      commit: commit.bind(actual),
      head: actual.head.bind(actual),
      checkpoint: actual.checkpoint.bind(actual),
      readAfter: actual.readAfter.bind(actual),
      readEvidence: actual.readEvidence.bind(actual),
      claimPublications: actual.claimPublications.bind(actual),
      markPublished: actual.markPublished.bind(actual),
    } as AuthorityDriver;
    const fanout: HubFanout = { publish: vi.fn(), subscribe: () => () => undefined };
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'socket',
      room: 'table',
      userId: 'user',
      signal: new AbortController().signal,
      close,
      send: (message) => sent.push(message),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      fanout,
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      expect(authorityCapabilitiesMatch(createAuthorityCapabilities([]), definition)).toBe(true);
      expect(
        parseEnvelope(
          JSON.stringify({
            from: 'socket',
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        ),
      ).not.toBeNull();
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: 'socket',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      expect(close).not.toHaveBeenCalled();
      const initial = store.getRoom('table');
      if (!initial) throw new Error('missing fixture room');
      runtime.activate(connection.id, initial.position, {
        elements: [],
        layers: [],
        extensions: {},
      });
      sent.length = 0;
      const doing = runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now), { kind: 'upsert', element }),
      );
      await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
      expect(sent).toEqual([]);
      expect(store.getRoom('table')?.state.elements).toEqual([]);
      expect(fanout.publish).not.toHaveBeenCalled();
      release?.();
      await doing;
      expect(store.getRoom('table')?.state.elements).toHaveLength(1);
      expect(sent.some((message) => JSON.parse(message).kind === 'receipt')).toBe(true);
      sent.length = 0;
      store.loseCommitResponse = true;
      const uncertainId = createAuthorityOperationId(store.now + 1);
      await runtime.handleMessage(
        connection.id,
        proposal(uncertainId, { kind: 'upsert', element: { ...element, id: 'uncertain' } }),
      );
      expect(store.getRoom('table')?.state.elements).toHaveLength(2);
      expect(close).toHaveBeenCalledWith(1013);
      expect(
        sent.some((message) => {
          const frame = JSON.parse(message);
          return (
            ['receipt', 'rejected'].includes(frame.kind) &&
            (frame.receipt?.clientOperationId ?? frame.clientOperationId) === uncertainId
          );
        }),
      ).toBe(false);
    } finally {
      runtime.close();
    }
  });

  it.each([
    { audience: 'hidden', outcome: 'history-unavailable', control: false, closes: false },
    { audience: 'public', outcome: 'history-unavailable', control: true, closes: false },
    { audience: 'hidden', outcome: 'forbidden', control: false, closes: true },
    { audience: 'hidden', outcome: 'generation-changed', control: true, closes: false },
  ])(
    'distinguishes $outcome after an unpinned $audience page',
    async ({ audience, outcome, control, closes }) => {
      const store = new AuthorityFixtureStore();
      store.now = Date.now();
      store.provision('table');
      const actual = new AuthorityFixtureDriver(store);
      let resumePage: (() => void) | undefined;
      let pageRead: (() => void) | undefined;
      const pageReached = new Promise<void>((resolve) => {
        pageRead = resolve;
      });
      const pageGate = new Promise<void>((resolve) => {
        resumePage = resolve;
      });
      let paused = false;
      const readEvidence = vi.fn(actual.readEvidence.bind(actual));
      const readAfter = vi.fn(async (...args: Parameters<AuthorityDriver['readAfter']>) => {
        const page = await actual.readAfter(...args);
        if (!paused && page.status === 'ok' && page.records.length) {
          paused = true;
          pageRead?.();
          await pageGate;
        }
        return page;
      });
      const driver: AuthorityDriver = {
        head: actual.head.bind(actual),
        commit: actual.commit.bind(actual),
        checkpoint: actual.checkpoint.bind(actual),
        readAfter,
        readEvidence,
        claimPublications: async () => [],
        markPublished: async () => undefined,
      };
      const fanout = new InMemoryHubFanout();
      const sent: string[] = [];
      const close = vi.fn();
      const connection: Connection = {
        id: 'reader',
        room: 'table',
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          sent.push(message);
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      const filtered: AuthorityRoomDefinition = {
        ...definition,
        project: (_context, state) => ({
          ...state,
          elements: state.elements.filter((item) => item.audience !== 'hidden'),
        }),
      };
      const runtime = new AuthorityRuntime(
        {
          driver,
          resolveRoom: () => filtered,
          resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
        },
        fanout,
        'worker',
      );
      try {
        runtime.admit(connection, filtered);
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            from: 'reader',
            op: {
              kind: 'capabilities',
              capabilities: createAuthorityCapabilities([]),
            },
          }),
        );
        const initial = store.getRoom('table');
        if (!initial) throw new Error('missing fixture room');
        runtime.activate(connection.id, initial.position, {
          elements: [],
          layers: [],
          extensions: {},
        });
        sent.length = 0;
        const original = prepareAuthorityProposal(
          {
            room: 'table',
            actorId: 'writer',
            connectionId: 'writer',
            deadlineAt: Date.now() + 5000,
            signal: new AbortController().signal,
          },
          proposal(createAuthorityOperationId(store.now), {
            kind: 'upsert',
            element: { ...element, audience },
          }),
        );
        const committed = await actual.commit(
          { ...original.context, definitionId: 'definition', ownershipId: 'writer' },
          { proposal: original.proposal, intent: prepareAuthorityIntent(original.proposal) },
        );
        expect(committed.status).toBe('committed');
        if (committed.status !== 'committed') return;
        fanout.publish(
          JSON.stringify({
            authority: 1,
            room: 'table',
            definitionId: 'definition',
            position: committed.position,
          }),
        );
        await pageReached;
        const options = { deadlineAt: Date.now() + 5000, signal: new AbortController().signal };
        if (outcome === 'history-unavailable') {
          const claims = await actual.claimPublications(
            'manual',
            { entries: 64, bytes: 65536, leaseMs: 5000 },
            options,
          );
          expect(claims).toHaveLength(1);
          const publicationClaim = claims[0];
          if (!publicationClaim) throw new Error('missing fixture claim');
          await actual.markPublished(publicationClaim, options);
          store.retirePublished('table', 1);
        } else if (outcome === 'forbidden') {
          store.policy.canRead = () => false;
        } else {
          store.replace('table', 'new-generation');
        }
        resumePage?.();
        await vi.waitFor(() => expect(readEvidence).toHaveBeenCalledTimes(1));
        expect((await readEvidence.mock.results[0]?.value)?.status).toBe(outcome);
        await vi.waitFor(() => {
          if (control)
            expect(sent.some((message) => JSON.parse(message).kind === 'resync-required')).toBe(
              true,
            );
          else expect(sent).toEqual([]);
        });
        if (outcome === 'history-unavailable' && !control) {
          await vi.waitFor(() =>
            expect(
              readAfter.mock.calls.some((call) => call[1].revision === committed.position.revision),
            ).toBe(true),
          );
        }
        if (closes) expect(close).toHaveBeenCalledWith(4403);
        else expect(close).not.toHaveBeenCalled();
      } finally {
        resumePage?.();
        runtime.close();
      }
    },
  );
});
