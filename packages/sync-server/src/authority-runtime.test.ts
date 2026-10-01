import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  AuthorityCheckpointAssembler,
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

it.each([4999, 5000, 5001])(
  'admits replay only while its original deadline survives the last configuration callback at %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sent: string[] = [];
    const close = vi.fn();
    let released = false;
    let afterReleaseResolutions = 0;
    let inDispatchChanges = false;
    const release = vi.fn(async () => {
      released = true;
    });
    const next = { generation: 'g', revision: 'next' };
    const driver = {
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      readEvidence: async () => ({
        status: 'available',
        lease: {
          before: emptyAuthorityState,
          after: { ...emptyAuthorityState, elements: [element] },
          token: 'evidence',
          expiresAt: now + 5000,
          release,
        },
      }),
      head: async () => initialAuthorityPosition,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const connection: Connection = {
      id: `last-replay-${elapsed}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const hub = new SyncHub();
    const transport = new FrameTransport(
      {
        readyState: WebSocket.OPEN,
        send: (message: string, done: (error?: Error) => void) => {
          sent.push(message);
          done();
        },
      } as unknown as WebSocket,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => {
          if (released) {
            afterReleaseResolutions++;
            if (inDispatchChanges) now += elapsed;
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      const dispatchChanges = runtime['dispatchChanges'].bind(runtime);
      runtime['dispatchChanges'] = (...args) => {
        inDispatchChanges = true;
        try {
          return dispatchChanges(...args);
        } finally {
          inDispatchChanges = false;
        }
      };
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
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing replay peer');
      await runtime['processPage'](peer, initialAuthorityPosition, {
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
      });
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      if (elapsed < 5000)
        await vi.waitFor(() =>
          expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(true),
        );
      const changes = sent.filter((message) => JSON.parse(message).kind === 'changes');
      expect(changes).toHaveLength(elapsed < 5000 ? 1 : 0);
      expect(afterReleaseResolutions).toBeGreaterThanOrEqual(3);
      if (elapsed >= 5000) {
        expect(runtime['peers'].get(connection.id)?.sendToken).toBeUndefined();
        expect(close).toHaveBeenCalledWith(1013);
      }
    } finally {
      runtime.close();
      transport.dispose();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['receipt', 'configuration', 4999],
  ['receipt', 'configuration', 5000],
  ['receipt', 'configuration', 5001],
  ['receipt', 'serialization', 4999],
  ['receipt', 'serialization', 5000],
  ['receipt', 'serialization', 5001],
  ['rejected', 'configuration', 4999],
  ['rejected', 'configuration', 5000],
  ['rejected', 'configuration', 5001],
] as const)(
  'admits an operation-owned %s only before its %s boundary at %i ms',
  async (responseKind, boundary, elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let crossConfiguration = false;
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(
      driver,
      definition,
      () => {
        if (crossConfiguration) {
          now += elapsed;
          crossConfiguration = false;
        }
        return definition;
      },
    );
    try {
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing response peer');
      let crossedSerialization = false;
      const receipt = new Proxy(
        {
          generation: 'g',
          clientOperationId: 'operation',
          receiptId: 'receipt',
        },
        {
          getOwnPropertyDescriptor(target, key) {
            if (key === 'receiptId' && boundary === 'serialization' && !crossedSerialization) {
              now += elapsed;
              crossedSerialization = true;
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      crossConfiguration = boundary === 'configuration';
      await runtime['send'](
        peer,
        responseKind === 'receipt'
          ? { protocol: 'authority:1', kind: 'receipt', receipt }
          : {
              protocol: 'authority:1',
              kind: 'rejected',
              generation: 'g',
              clientOperationId: 'operation',
              reason: 'forbidden',
            },
        { deadlineAt: now + 5000, signal: peer.lifetime },
      ).catch(() => undefined);
      expect(sent.some((message) => JSON.parse(message).kind === responseKind)).toBe(
        elapsed < 5000,
      );
      if (elapsed >= 5000) {
        expect(close).toHaveBeenCalledWith(1013);
        expect(runtime['peers'].has(connection.id)).toBe(false);
      } else expect(close).not.toHaveBeenCalled();
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000, 5001])(
  'keeps recovery in its source phase until the final configuration callback at %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let crossConfiguration = false;
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(
      driver,
      definition,
      () => {
        if (crossConfiguration) {
          now += elapsed;
          crossConfiguration = false;
        }
        return definition;
      },
    );
    try {
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing recovery peer');
      const streamToken = peer.streamToken;
      crossConfiguration = true;
      runtime['dispatchRecovery'](
        peer,
        'replacement',
        { deadlineAt: now + 5000, signal: peer.lifetime },
        { phase: 'live', streamToken },
      );
      expect(sent.some((message) => JSON.parse(message).kind === 'resync-required')).toBe(
        elapsed < 5000,
      );
      if (elapsed < 5000) {
        expect(peer.phase).toBe('awaiting-request');
        expect(peer.requestEpisode).toBeDefined();
        expect(peer.resetTimes).toHaveLength(1);
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(peer.requestEpisode).toBeUndefined();
        expect(peer.resetTimes).toHaveLength(0);
        expect(peer.sendToken).toBeUndefined();
        expect(close).toHaveBeenCalledWith(1013);
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['silent', 4999],
  ['silent', 5000],
  ['silent', 5001],
  ['visible', 4999],
  ['visible', 5000],
  ['visible', 5001],
] as const)(
  'guards %s reconciliation after release and its final configuration callback at %i ms',
  async (visibility, elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let inFinalEligibility = false;
    let released = false;
    let crossed = false;
    const next = { generation: 'g', revision: 'next' };
    const release = vi.fn(async () => {
      released = true;
    });
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      checkpoint: async () => ({
        position: next,
        state:
          visibility === 'silent'
            ? emptyAuthorityState
            : { ...emptyAuthorityState, elements: [element] },
        token: 'capture',
        expiresAt: now + 5000,
        release,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(
      driver,
      definition,
      () => {
        if (released && inFinalEligibility && !crossed) {
          now += elapsed;
          crossed = true;
        }
        return definition;
      },
    );
    try {
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing reconcile peer');
      const effectEligible = runtime['effectEligible'].bind(runtime);
      runtime['effectEligible'] = (...args) => {
        inFinalEligibility = true;
        try {
          return effectEligible(...args);
        } finally {
          inFinalEligibility = false;
        }
      };
      await runtime['reconcile'](peer);
      expect(release).toHaveBeenCalledTimes(1);
      if (elapsed < 5000) {
        expect(close).not.toHaveBeenCalled();
        if (visibility === 'silent') {
          expect(peer.position).toEqual(next);
          expect(sent).toEqual([]);
        } else {
          expect(peer.phase).toBe('awaiting-request');
          expect(sent.some((message) => JSON.parse(message).kind === 'resync-required')).toBe(true);
          expect(peer.resetTimes).toHaveLength(1);
        }
      } else {
        expect(peer.position).toEqual(initialAuthorityPosition);
        expect(peer.requestEpisode).toBeUndefined();
        expect(peer.resetTimes).toHaveLength(0);
        expect(peer.sendToken).toBeUndefined();
        expect(sent).toEqual([]);
        expect(close).toHaveBeenCalledWith(1013);
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000, 5001])(
  'preserves capture generation recovery deadline through the final callback at %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let inRecovery = false;
    let crossed = false;
    const release = vi.fn(async () => undefined);
    const driver = {
      head: async () => initialAuthorityPosition,
      checkpoint: async () => ({
        position: { generation: 'replacement', revision: 'cut' },
        state: emptyAuthorityState,
        token: 'capture',
        expiresAt: now + 5000,
        release,
      }),
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `capture-final-${elapsed}`,
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
        resolveRoom: () => {
          if (inRecovery && !crossed) {
            now += elapsed;
            crossed = true;
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      const dispatchRecovery = runtime['dispatchRecovery'].bind(runtime);
      runtime['dispatchRecovery'] = (...args) => {
        inRecovery = true;
        try {
          return dispatchRecovery(...args);
        } finally {
          inRecovery = false;
        }
      };
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      sent.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'capture',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(crossed).toBe(true));
      const peer = runtime['peers'].get(connection.id);
      if (elapsed < 5000) {
        expect(sent.some((message) => JSON.parse(message).reason === 'gap')).toBe(true);
        expect(peer?.phase).toBe('awaiting-request');
        expect(peer?.resetTimes).toHaveLength(1);
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(sent).toEqual([]);
        expect(peer?.requestEpisode).toBeUndefined();
        expect(peer?.resetTimes ?? []).toHaveLength(0);
        expect(close).toHaveBeenCalledWith(1013);
      }
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0));
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000, 5001])(
  'rejects expired reconciliation before projection after the last configuration callback at %i ms',
  async (elapsed) => {
    const startedAt = 1_000_000;
    let now = startedAt;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let captureReturned = false;
    let postCaptureResolutions = 0;
    let inFinalEligibility = false;
    let crossed = false;
    let settleRelease: (() => void) | undefined;
    const releaseGate = new Promise<void>((resolve) => {
      settleRelease = resolve;
    });
    const release = vi.fn(() => releaseGate);
    const project = vi.fn((_context: unknown, state: typeof emptyAuthorityState) => state);
    const localDefinition = { ...definition, project } as AuthorityRoomDefinition;
    const next = { generation: 'g', revision: 'next' };
    const checkpoint = vi.fn(async () => {
      now = startedAt + 1000;
      captureReturned = true;
      return {
        position: next,
        state: { ...emptyAuthorityState, elements: [element] },
        token: 'capture',
        expiresAt: now + 5000,
        release,
      };
    });
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async () => ({ status: 'gap' as const, head: next }),
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `projection-final-${elapsed}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const hub = new SyncHub();
    const transport = new FrameTransport(
      {
        readyState: WebSocket.OPEN,
        send: (message: string, done: (error?: Error) => void) => {
          sent.push(message);
          done();
        },
      } as unknown as WebSocket,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => {
          if (captureReturned) {
            postCaptureResolutions++;
            if (!crossed && (postCaptureResolutions === 2 || inFinalEligibility)) {
              now = startedAt + elapsed;
              crossed = true;
            }
          }
          return localDefinition;
        },
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
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
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      sent.length = 0;
      runtime.activate(connection.id, initialAuthorityPosition, emptyAuthorityState);
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing reconcile peer');
      const baselineProjectionCalls = project.mock.calls.length;
      const effectEligible = runtime['effectEligible'].bind(runtime);
      runtime['effectEligible'] = (...args) => {
        inFinalEligibility = true;
        try {
          return effectEligible(...args);
        } finally {
          inFinalEligibility = false;
        }
      };
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(crossed).toBe(true);
      expect(now).toBe(startedAt + elapsed);
      expect(startedAt + 1000 + 5000).toBeGreaterThan(now);
      expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(1);
      expect(project.mock.calls.length - baselineProjectionCalls).toBe(elapsed < 5000 ? 1 : 0);
      expect(peer.position).toEqual(initialAuthorityPosition);
      expect(peer.requestEpisode).toBeUndefined();
      expect(peer.resetTimes).toHaveLength(0);
      expect(sent).toEqual([]);
      settleRelease?.();
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(0));
      expect(release).toHaveBeenCalledTimes(1);
      if (elapsed < 5000) {
        await vi.waitFor(() =>
          expect(sent.some((frame) => JSON.parse(frame).kind === 'resync-required')).toBe(true),
        );
        expect(peer.phase).toBe('awaiting-request');
        expect(peer.resetTimes).toHaveLength(1);
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(close).toHaveBeenCalledWith(1013);
        expect(runtime['peers'].has(connection.id)).toBe(false);
        expect(peer.position).toEqual(initialAuthorityPosition);
        expect(peer.requestEpisode).toBeUndefined();
        expect(peer.resetTimes).toHaveLength(0);
        expect(sent).toEqual([]);
      }
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0);
    } finally {
      settleRelease?.();
      runtime.close();
      transport.dispose();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['begin', 4999],
  ['begin', 5000],
  ['begin', 5001],
  ['end', 4999],
  ['end', 5000],
  ['end', 5001],
] as const)(
  'preserves pre-%s head generation recovery deadline through the final callback at %i ms',
  async (boundary, elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let headCalls = 0;
    let inRecovery = false;
    let crossed = false;
    const release = vi.fn(async () => undefined);
    const driver = {
      head: async () => {
        headCalls++;
        return headCalls === (boundary === 'begin' ? 2 : 3)
          ? { generation: 'replacement', revision: 'cut' }
          : initialAuthorityPosition;
      },
      checkpoint: async () => ({
        position: initialAuthorityPosition,
        state: emptyAuthorityState,
        token: 'capture',
        expiresAt: now + 5000,
        release,
      }),
      readAfter: async () => ({ status: 'ok', head: initialAuthorityPosition, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `head-final-${boundary}-${elapsed}`,
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
        resolveRoom: () => {
          if (inRecovery && !crossed) {
            now += elapsed;
            crossed = true;
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      const dispatchRecovery = runtime['dispatchRecovery'].bind(runtime);
      runtime['dispatchRecovery'] = (...args) => {
        inRecovery = true;
        try {
          return dispatchRecovery(...args);
        } finally {
          inRecovery = false;
        }
      };
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      sent.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'head',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(crossed).toBe(true));
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0));
      const kinds = sent.map((message) => JSON.parse(message).kind);
      const peer = runtime['peers'].get(connection.id);
      expect(release).toHaveBeenCalledTimes(1);
      expect(kinds.includes('checkpoint-end')).toBe(false);
      if (elapsed < 5000) {
        expect(kinds.includes('resync-required')).toBe(true);
        expect(peer?.phase).toBe('awaiting-request');
        expect(peer?.resetTimes).toHaveLength(1);
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(kinds.includes('resync-required')).toBe(false);
        expect(peer?.requestEpisode).toBeUndefined();
        expect(peer?.resetTimes ?? []).toHaveLength(0);
        expect(close).toHaveBeenCalledWith(1013);
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000, 5001])(
  'enforces the fixed negotiation admission deadline at %i ms with due timers withheld',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const head = vi.fn(async () => initialAuthorityPosition);
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `negotiation-${elapsed}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const hub = new SyncHub();
    const transport = new FrameTransport(
      {
        readyState: WebSocket.OPEN,
        send: (message: string, done: (error?: Error) => void) => {
          sent.push(message);
          done();
        },
      } as unknown as WebSocket,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
    });
    const runtime = new AuthorityRuntime(
      {
        driver: {
          head,
          claimPublications: async () => [],
          markPublished: async () => undefined,
        } as unknown as AuthorityDriver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      now += elapsed;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      expect(head).toHaveBeenCalledTimes(elapsed < 5000 ? 1 : 0);
      expect(sent.map((frame) => JSON.parse(frame).kind ?? JSON.parse(frame).op?.kind)).toEqual(
        elapsed < 5000 ? ['capabilities', 'resync-required'] : [],
      );
      expect(close).toHaveBeenCalledTimes(elapsed < 5000 ? 0 : 1);
      if (elapsed >= 5000) expect(close).toHaveBeenCalledWith(4406);
    } finally {
      runtime.close();
      transport.dispose();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000])(
  'does not admit evidence from a readAfter result returned at %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const next = { generation: 'g', revision: 'next' };
    const readEvidence = vi.fn(async () => ({
      status: 'available' as const,
      lease: {
        before: emptyAuthorityState,
        after: { ...emptyAuthorityState, elements: [element] },
        token: 'evidence',
        expiresAt: now + 5000,
        release: async () => undefined,
      },
    }));
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async (_context: unknown, cut: { revision: string }) => {
        if (cut.revision !== 'start') return { status: 'ok' as const, head: next, records: [] };
        now += elapsed;
        return {
          status: 'ok' as const,
          head: next,
          records: [
            {
              previous: initialAuthorityPosition,
              position: next,
              before: authorityReference,
              after: authorityReference,
            },
          ],
        };
      },
      readEvidence,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(readEvidence).toHaveBeenCalledTimes(elapsed < 5000 ? 1 : 0));
      if (elapsed < 5000) {
        await vi.waitFor(() =>
          expect(sent.some((frame) => JSON.parse(frame).kind === 'changes')).toBe(true),
        );
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(sent).toEqual([]);
        expect(close).toHaveBeenCalledWith(1013);
        expect(runtime['peers'].has(connection.id)).toBe(false);
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000])(
  'rejects a negotiation head returned at %i ms before promotion or delivery',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const head = vi.fn(async () => {
      now += elapsed;
      return initialAuthorityPosition;
    });
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `head-return-${elapsed}`,
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
        driver: {
          head,
          claimPublications: async () => [],
          markPublished: async () => undefined,
        } as unknown as AuthorityDriver,
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
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      expect(head).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(elapsed < 5000 ? 2 : 0);
      expect(close).toHaveBeenCalledTimes(elapsed < 5000 ? 0 : 1);
      if (elapsed >= 5000) expect(close).toHaveBeenCalledWith(4406);
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['return', 4999],
  ['return', 5000],
  ['release', 4999],
  ['release', 5000],
] as const)(
  'settles evidence lease before %s boundary at %i ms without late cursor effects',
  async (boundary, elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const next = { generation: 'g', revision: 'next' };
    const release = vi.fn(async () => {
      if (boundary === 'release') now += elapsed;
    });
    const readEvidence = vi.fn(async () => {
      if (boundary === 'return') now += elapsed;
      return {
        status: 'available' as const,
        lease: {
          before: emptyAuthorityState,
          after: { ...emptyAuthorityState, elements: [element] },
          token: 'evidence',
          expiresAt: now + 5000,
          release,
        },
      };
    });
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async (_context: unknown, cut: { revision: string }) =>
        cut.revision === 'start'
          ? {
              status: 'ok' as const,
              head: next,
              records: [
                {
                  previous: initialAuthorityPosition,
                  position: next,
                  before: authorityReference,
                  after: authorityReference,
                },
              ],
            }
          : { status: 'ok' as const, head: next, records: [] },
      readEvidence,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      if (elapsed < 5000) {
        await vi.waitFor(() =>
          expect(sent.some((frame) => JSON.parse(frame).kind === 'changes')).toBe(true),
        );
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(sent).toEqual([]);
        expect(close).toHaveBeenCalledWith(1013);
        expect(runtime['peers'].has(connection.id)).toBe(false);
      }
      expect(readEvidence).toHaveBeenCalledTimes(1);
      expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(0);
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([4999, 5000])(
  'checks reconciliation after actual capture release at %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const next = { generation: 'g', revision: 'next' };
    const release = vi.fn(async () => {
      now += elapsed;
    });
    const checkpoint = vi.fn(async () => ({
      position: next,
      state: { ...emptyAuthorityState, elements: [element] },
      token: 'capture',
      expiresAt: now + 5000,
      release,
    }));
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async () => ({ status: 'gap' as const, head: next }),
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(driver);
    try {
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      if (elapsed < 5000) {
        await vi.waitFor(() =>
          expect(sent.some((frame) => JSON.parse(frame).kind === 'resync-required')).toBe(true),
        );
        expect(runtime['peers'].get(connection.id)?.phase).toBe('awaiting-request');
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(sent).toEqual([]);
        expect(close).toHaveBeenCalledWith(1013);
      }
      expect(checkpoint).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(0));
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['committed', 'driver'],
  ['rejected', 'driver'],
  ['committed', 'response'],
  ['rejected', 'response'],
] as const)(
  'withholds a late %s caller response at %s while preserving durable commit publication',
  async (outcome, crossing) => {
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const store = new AuthorityFixtureStore();
    store.now = now;
    store.provision('table');
    if (outcome === 'rejected') store.policy.canWrite = () => false;
    const actual = new AuthorityFixtureDriver(store);
    const claimPublications = vi.fn(actual.claimPublications.bind(actual));
    const commit = vi.fn(async (...args: Parameters<AuthorityDriver['commit']>) => {
      const result = await actual.commit(...args);
      if (crossing === 'driver') now += 5000;
      return result;
    });
    let inResponseSend = false;
    let crossedResponse = false;
    const driver = {
      head: actual.head.bind(actual),
      checkpoint: actual.checkpoint.bind(actual),
      readAfter: actual.readAfter.bind(actual),
      readEvidence: actual.readEvidence.bind(actual),
      commit,
      claimPublications,
      markPublished: actual.markPublished.bind(actual),
    } as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `late-${outcome}`,
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
        resolveRoom: () => {
          if (inResponseSend && !crossedResponse) {
            now += 5000;
            crossedResponse = true;
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      const send = runtime['send'].bind(runtime);
      runtime['send'] = (...args) => {
        if (args[1].kind !== 'receipt' && args[1].kind !== 'rejected') return send(...args);
        inResponseSend = true;
        try {
          return send(...args);
        } finally {
          inResponseSend = false;
        }
      };
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      const initial = store.getRoom('table');
      if (!initial) throw new Error('missing fixture room');
      runtime.activate(connection.id, initial.position, initial.state);
      sent.length = 0;
      await vi.waitFor(() => expect(claimPublications).toHaveBeenCalled());
      const wakePublisher = vi.spyOn(runtime['publisher'], 'wake');
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(store.now), { kind: 'upsert', element }),
      );
      expect(commit).toHaveBeenCalledTimes(1);
      if (crossing === 'response') expect(crossedResponse).toBe(true);
      expect(close).toHaveBeenCalledWith(1013);
      expect(sent.some((frame) => ['receipt', 'rejected'].includes(JSON.parse(frame).kind))).toBe(
        false,
      );
      expect(store.getRoom('table')?.state.elements).toHaveLength(outcome === 'committed' ? 1 : 0);
      expect(wakePublisher).toHaveBeenCalledTimes(outcome === 'committed' ? 1 : 0);
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each(['projection', 'history-unavailable', 'forbidden', 'generation-changed'] as const)(
  'rejects expired %s evidence before downstream effects',
  async (outcome) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const next = { generation: 'g', revision: 'next' };
    const release = vi.fn(async () => undefined);
    const checkpoint = vi.fn();
    const localDefinition: AuthorityRoomDefinition = {
      ...definition,
      project: (_context, state) => {
        if (outcome === 'projection' && state.elements.length) now += 5000;
        return state;
      },
    };
    const driver = {
      head: async () => initialAuthorityPosition,
      readAfter: async (_context: unknown, cut: { revision: string }) =>
        cut.revision === 'start'
          ? {
              status: 'ok' as const,
              head: next,
              records: [
                {
                  previous: initialAuthorityPosition,
                  position: next,
                  before: authorityReference,
                  after: authorityReference,
                },
              ],
            }
          : { status: 'ok' as const, head: next, records: [] },
      readEvidence: async () => {
        if (outcome === 'projection')
          return {
            status: 'available' as const,
            lease: {
              before: emptyAuthorityState,
              after: { ...emptyAuthorityState, elements: [element] },
              token: 'evidence',
              expiresAt: now + 5000,
              release,
            },
          };
        now += 5000;
        return outcome === 'generation-changed'
          ? { status: outcome, head: next }
          : { status: outcome };
      },
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(
      driver,
      localDefinition,
    );
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(sent).toEqual([]);
      expect(checkpoint).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(outcome === 'projection' ? 1 : 0);
      expect(runtime['peers'].has(connection.id)).toBe(false);
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it('starts a fresh reconciliation deadline after passive heavy-capacity waiting', async () => {
  let now = 1_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const next = { generation: 'g', revision: 'next' };
  let resumeEvidence: (() => void) | undefined;
  const evidenceGate = new Promise<void>((resolve) => {
    resumeEvidence = resolve;
  });
  const readEvidence = vi.fn(async () => {
    await evidenceGate;
    return { status: 'history-unavailable' as const };
  });
  const checkpoint = vi.fn(
    async (_context: { connectionId: string }, options: { deadlineAt: number }) => ({
      position: next,
      state: emptyAuthorityState,
      token: 'capture',
      expiresAt: now + 5000,
      release: async () => undefined,
      observedDeadline: options.deadlineAt,
    }),
  );
  const readAfter = vi.fn(async (context: { connectionId: string }, cut: { revision: string }) =>
    cut.revision !== 'start'
      ? { status: 'ok' as const, head: next, records: [] }
      : context.connectionId === 'waiter'
        ? { status: 'gap' as const, head: next }
        : {
            status: 'ok' as const,
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
  const driver = {
    head: async () => initialAuthorityPosition,
    readAfter,
    readEvidence,
    checkpoint,
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
  const peers = ['blocker-one', 'blocker-two', 'waiter'].map((id) => {
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id,
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
    return { connection, sent, close };
  });
  try {
    for (const { connection } of peers) {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
    }
    for (const peer of peers.slice(0, 2))
      runtime.activate(peer.connection.id, initialAuthorityPosition, emptyAuthorityState);
    await vi.waitFor(() => expect(readEvidence).toHaveBeenCalledTimes(2));
    expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(2);
    const waiter = peers[2];
    if (!waiter) throw new Error('missing waiter');
    waiter.sent.length = 0;
    runtime.activate(waiter.connection.id, initialAuthorityPosition, emptyAuthorityState);
    await vi.waitFor(() =>
      expect(readAfter.mock.calls.some((call) => call[0].connectionId === 'waiter')).toBe(true),
    );
    await vi.waitFor(() =>
      expect(runtime['peers'].get(waiter.connection.id)?.reconciling).toBe(true),
    );
    expect(checkpoint).not.toHaveBeenCalled();
    now += 5000;
    resumeEvidence?.();
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
    expect(checkpoint.mock.calls[0]?.[1].deadlineAt).toBe(now + 5000);
    await vi.waitFor(() =>
      expect(runtime['peers'].get(waiter.connection.id)?.position).toEqual(next),
    );
    expect(waiter.sent).toEqual([]);
    expect(waiter.close).not.toHaveBeenCalled();
  } finally {
    resumeEvidence?.();
    runtime.close();
    clock.mockRestore();
  }
});

it.each([4999, 5000])(
  'rechecks a poll continuation after its room callback reaches %i ms',
  async (elapsed) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const next = { generation: 'h', revision: 'next' };
    let afterHead = false;
    let callbacks = 0;
    const checkpoint = vi.fn(async () => ({
      position: next,
      state: emptyAuthorityState,
      token: 'capture',
      expiresAt: now + 5000,
      release: async () => undefined,
    }));
    const readAfter = vi.fn(async () => ({
      status: 'ok' as const,
      head: initialAuthorityPosition,
      records: [],
    }));
    const driver = {
      head: async () => {
        if (afterHead) return next;
        return initialAuthorityPosition;
      },
      readAfter,
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const { runtime, connection, close, sent } = await startResultBoundaryRuntime(
      driver,
      definition,
      () => {
        if (afterHead && ++callbacks === 5) now += elapsed;
        return definition;
      },
    );
    try {
      await vi.waitFor(() => expect(readAfter).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(runtime['scheduler']['ready'].has(connection.id)).toBe(false));
      afterHead = true;
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing peer');
      await runtime['pollHead'](peer);
      if (elapsed < 5000) {
        expect(close).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(checkpoint).not.toHaveBeenCalled();
        expect(sent).toEqual([]);
        expect(close).toHaveBeenCalledWith(1013);
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it('does not wake peer replay after an admitted receipt settles beyond its caller deadline', async () => {
  let now = 1_700_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const store = new AuthorityFixtureStore();
  store.now = now;
  store.provision('table');
  const actual = new AuthorityFixtureDriver(store);
  const readAfter = vi.fn(actual.readAfter.bind(actual));
  const sent: string[] = [];
  let resumeReceipt: (() => void) | undefined;
  const receiptGate = new Promise<void>((resolve) => {
    resumeReceipt = resolve;
  });
  const close = vi.fn();
  const connection: Connection = {
    id: 'receipt-boundary',
    room: 'table',
    signal: new AbortController().signal,
    close,
    send: vi.fn(),
  };
  registerAuthorityConnection(connection, {
    sendTracked: (frame) => {
      sent.push(frame);
      const completion = JSON.parse(frame).kind === 'receipt' ? receiptGate : Promise.resolve();
      return { completion, settled: completion };
    },
  });
  const runtime = new AuthorityRuntime(
    {
      driver: {
        head: actual.head.bind(actual),
        checkpoint: actual.checkpoint.bind(actual),
        readAfter,
        readEvidence: actual.readEvidence.bind(actual),
        commit: actual.commit.bind(actual),
        claimPublications: actual.claimPublications.bind(actual),
        markPublished: actual.markPublished.bind(actual),
      },
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
        from: connection.id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    const initial = store.getRoom('table');
    if (!initial) throw new Error('missing fixture room');
    runtime.activate(connection.id, initial.position, initial.state);
    await vi.waitFor(() => expect(readAfter).toHaveBeenCalled());
    sent.length = 0;
    const wake = vi.spyOn(runtime as unknown as { wake: (peer: unknown) => void }, 'wake');
    const doing = runtime.handleMessage(
      connection.id,
      proposal(createAuthorityOperationId(store.now), { kind: 'upsert', element }),
    );
    await vi.waitFor(() =>
      expect(sent.some((frame) => JSON.parse(frame).kind === 'receipt')).toBe(true),
    );
    now += 5000;
    resumeReceipt?.();
    await doing;
    expect(wake).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(1013);
    expect(store.getRoom('table')?.state.elements).toHaveLength(1);
  } finally {
    resumeReceipt?.();
    runtime.close();
    clock.mockRestore();
  }
});

it.each([
  ['initial', 9999, true],
  ['initial', 10000, false],
  ['initial', 10001, false],
  ['recovery', 9999, true],
  ['recovery', 10000, false],
  ['recovery', 10001, false],
] as const)(
  'enforces the %s request window at %i ms before its timer runs',
  async (path, elapsed, timely) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const initial = { generation: 'g', revision: 'initial' };
    const changed = { generation: 'g', revision: 'changed' };
    let gap = false;
    const capture = vi.fn(async () => ({
      position: changed,
      state: { ...emptyAuthorityState, elements: [element] },
      token: 'lease',
      expiresAt: now + 5000,
      release: async () => undefined,
    }));
    const driver = {
      head: async () => initial,
      checkpoint: capture,
      readAfter: async () => {
        if (gap) {
          gap = false;
          return { status: 'gap' as const, head: changed };
        }
        return {
          status: 'ok' as const,
          head: capture.mock.calls.length ? changed : initial,
          records: [],
        };
      },
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const native: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `window-${path}-${elapsed}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        native.push(message);
        done();
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      if (path === 'recovery') {
        runtime.activate(connection.id, initial, emptyAuthorityState);
        gap = true;
        const peer = runtime['peers'].get(connection.id);
        if (!peer) throw new Error('missing peer');
        runtime['wake'](peer);
      }
      await vi.waitFor(() =>
        expect(native.filter((frame) => JSON.parse(frame).kind === 'resync-required')).toHaveLength(
          path === 'initial' ? 1 : 2,
        ),
      );
      const peer = runtime['peers'].get(connection.id);
      expect(peer?.phase).toBe('awaiting-request');
      await vi.waitFor(() => expect(peer?.requestTimer).toBeDefined());
      const capturesBeforeRequest = capture.mock.calls.length;
      const resyncAt = now;
      now = resyncAt + elapsed;
      const inbound = new AbortController();
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: `request-${path}`,
          generation: 'g',
        }),
        { signal: inbound.signal, deadlineAt: now + 5000, beforeProcess: async () => true },
      );
      if (timely) {
        await vi.waitFor(() => expect(peer?.phase).toBe('live'));
        const checkpointFrames = native.filter((frame) =>
          JSON.parse(frame).kind?.startsWith('checkpoint-'),
        );
        expect(checkpointFrames.map((frame) => JSON.parse(frame).kind)).toEqual([
          'checkpoint-begin',
          'checkpoint-chunk',
          'checkpoint-end',
        ]);
        const assembler = new AuthorityCheckpointAssembler({
          requestId: `request-${path}`,
          generation: 'g',
          requiredExtensions: [],
        });
        let completed = false;
        for (const frame of checkpointFrames) {
          const result = await assembler.accept(frame);
          if (result.status === 'complete') {
            expect(result.checkpoint.elements).toEqual([element]);
            completed = true;
          }
        }
        assembler.dispose();
        expect(completed).toBe(true);
        expect(capture).toHaveBeenCalledTimes(capturesBeforeRequest + 1);
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(close).toHaveBeenCalledWith(1013);
        expect(capture).toHaveBeenCalledTimes(capturesBeforeRequest);
        expect(native.filter((frame) => JSON.parse(frame).kind?.startsWith('checkpoint-'))).toEqual(
          [],
        );
        expect(runtime['peers'].has(connection.id)).toBe(false);
      }
      await vi.waitFor(() =>
        expect(runtime['scheduler'].accountedUsage()).toMatchObject({
          heavySlots: 0,
          streamSlots: 0,
        }),
      );
    } finally {
      transport.dispose();
      runtime.close();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each(['held-resync', 'held-reconcile'] as const)(
  'revokes the old request episode across %s and preserves actual settlement',
  async (mode) => {
    const initial = { generation: 'g', revision: 'initial' };
    const changed = { generation: 'g', revision: 'changed' };
    let gap = false;
    let releaseReconcile: (() => void) | undefined;
    let releaseRequest: (() => void) | undefined;
    let finishResync: (() => void) | undefined;
    const releases = [vi.fn(), vi.fn()];
    const checkpoint = vi.fn(async () => {
      const index = checkpoint.mock.calls.length - 1;
      return {
        position: changed,
        state: { ...emptyAuthorityState, elements: [element] },
        token: `lease-${index}`,
        expiresAt: Date.now() + 5000,
        release: async () => {
          releases[index]?.();
          await new Promise<void>((resolve) => {
            if (index === 0 && mode === 'held-reconcile') releaseReconcile = resolve;
            else if (index === 1) releaseRequest = resolve;
            else resolve();
          });
        },
      };
    });
    const driver = {
      head: async () => initial,
      checkpoint,
      readAfter: async () => {
        if (gap) {
          gap = false;
          return { status: 'gap' as const, head: changed };
        }
        return {
          status: 'ok' as const,
          head: checkpoint.mock.calls.length >= 2 ? changed : initial,
          records: [],
        };
      },
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const native: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `episode-${mode}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        native.push(message);
        if (mode === 'held-resync' && JSON.parse(message).reason === 'gap') finishResync = done;
        else done();
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
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
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing peer');
      const initialTimer = peer.requestTimer;
      const initialIndex = timers.mock.results.findIndex((result) => result.value === initialTimer);
      const obsoleteCallback = timers.mock.calls[initialIndex]?.[0];
      expect(obsoleteCallback).toBeTypeOf('function');
      runtime.activate(connection.id, initial, emptyAuthorityState);
      gap = true;
      runtime['wake'](peer);
      if (mode === 'held-resync') {
        await vi.waitFor(() => expect(finishResync).toBeDefined());
        expect(peer.requestTimer).toBeUndefined();
      } else {
        await vi.waitFor(() => expect(releaseReconcile).toBeDefined());
        expect(native.filter((frame) => JSON.parse(frame).reason === 'gap')).toHaveLength(0);
        expect(peer.phase).toBe('live');
      }
      if (mode === 'held-resync') expect(peer.phase).toBe('awaiting-request');
      const inbound = new AbortController();
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'early',
          generation: 'g',
        }),
        {
          signal: inbound.signal,
          deadlineAt: Date.now() + 5000,
          beforeProcess: async () => true,
        },
      );
      if (mode === 'held-reconcile') {
        expect(peer.phase).toBe('preparing');
        expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
        releaseReconcile?.();
      }
      await vi.waitFor(() => expect(releaseRequest).toBeDefined());
      expect(peer.phase).toBe('preparing');
      expect(peer.requestTimer).toBeUndefined();
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
      if (mode === 'held-resync') finishResync?.();
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(1));
      expect(peer.requestTimer).toBeUndefined();
      expect(native.filter((frame) => JSON.parse(frame).reason === 'gap')).toHaveLength(
        mode === 'held-resync' ? 1 : 0,
      );
      releaseRequest?.();
      await vi.waitFor(() => expect(peer.phase).toBe('live'));
      obsoleteCallback?.();
      expect(close).not.toHaveBeenCalled();
      expect(peer.requestTimer).toBeUndefined();
      expect(releases[0]).toHaveBeenCalledTimes(1);
      expect(releases[1]).toHaveBeenCalledTimes(1);
      await vi.waitFor(() =>
        expect(runtime['scheduler'].accountedUsage()).toMatchObject({
          heavySlots: 0,
          streamSlots: 0,
        }),
      );
    } finally {
      finishResync?.();
      releaseReconcile?.();
      releaseRequest?.();
      timers.mockRestore();
      transport.dispose();
      runtime.close();
      hub.close();
    }
  },
);

it.each(['owned', 'replacement', 'expiry'] as const)(
  'binds the request timer to its %s episode and connection expiry',
  async (mode) => {
    let now = 2_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const close = vi.fn();
    const connection: Connection = {
      id: `timer-${mode}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
      ...(mode === 'expiry' ? { expiresAt: now + 3000 } : {}),
    };
    const driver = {
      head: async () => initialAuthorityPosition,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
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
      registerAuthorityConnection(connection, {
        sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
      });
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing peer');
      expect(peer.requestDeadlineAt).toBe(now + (mode === 'expiry' ? 3000 : 10_000));
      const index = timers.mock.results.findIndex((result) => result.value === peer.requestTimer);
      const callback = timers.mock.calls[index]?.[0];
      expect(callback).toBeTypeOf('function');
      if (mode === 'replacement') {
        runtime.remove(connection.id);
        const replacementClose = vi.fn();
        const replacement: Connection = {
          ...connection,
          signal: new AbortController().signal,
          close: replacementClose,
        };
        registerAuthorityConnection(replacement, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        expect(runtime.admit(replacement, definition)).toBe(true);
        now += 10_000;
        callback?.();
        expect(close).not.toHaveBeenCalled();
        expect(replacementClose).not.toHaveBeenCalled();
        expect(runtime['peers'].get(connection.id)?.connection).toBe(replacement);
      } else {
        now += mode === 'expiry' ? 3000 : 10_000;
        callback?.();
        expect(close).toHaveBeenCalledWith(mode === 'expiry' ? 4401 : 1013);
        expect(runtime['peers'].has(connection.id)).toBe(false);
        expect(peer.requestTimer).toBeUndefined();
        expect(peer.requestDeadlineAt).toBeUndefined();
        expect(peer.requestEpisode).toBeUndefined();
      }
    } finally {
      runtime.close();
      timers.mockRestore();
      clock.mockRestore();
    }
  },
);

it.each(['capture', 'release'] as const)(
  'rejects a %s crossing the preparation deadline before its timer runs',
  async (boundary) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cut = { generation: 'g', revision: 'cut' };
    const release = vi.fn(async () => {
      if (boundary === 'release') now += 5000;
    });
    const driver = {
      head: async () => cut,
      checkpoint: async () => {
        if (boundary === 'capture') now += 5000;
        return {
          position: boundary === 'capture' ? { generation: 'replacement', revision: 'cut' } : cut,
          state: emptyAuthorityState,
          token: 'lease',
          expiresAt: now + 10_000,
          release,
        };
      },
      readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const native: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'late-release',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        native.push(message);
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      native.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(release).toHaveBeenCalledTimes(1);
      expect(native).toEqual([]);
      expect(runtime['peers'].has(connection.id)).toBe(false);
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each(['authorization', 'physical-head', 'native-completion'] as const)(
  'enforces the fixed stream deadline across end %s with actual frame transport',
  async (boundary) => {
    let now = 2_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cut = { generation: 'g', revision: 'cut' };
    const native: string[] = [];
    let headCalls = 0;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        const kind = JSON.parse(message).kind;
        native.push(kind);
        if (kind === 'checkpoint-chunk') now += 3000;
        if (kind === 'checkpoint-end' && boundary === 'native-completion') now += 1500;
        done();
      },
    } as unknown as WebSocket;
    const driver = {
      head: async () => {
        headCalls++;
        if (boundary === 'physical-head' && headCalls === 8) now += 1500;
        return cut;
      },
      checkpoint: async () => ({
        position: cut,
        state: {
          elements: [{ ...element, text: 'x'.repeat(1_100_000) }],
          layers: [],
          extensions: {},
        },
        token: 'lease',
        expiresAt: now + 20_000,
        release: async () => undefined,
      }),
      readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const connection: Connection = {
      id: `end-${boundary}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      {
        authorize: ({ direction, message }) => {
          if (
            direction === 'outbound' &&
            JSON.parse(message).kind === 'checkpoint-end' &&
            boundary === 'authorization'
          )
            now += 1500;
          return true;
        },
      },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      native.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() =>
        expect(native.filter((kind) => kind === 'checkpoint-chunk')).toHaveLength(3),
      );
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(now).toBe(2_010_500);
      expect(native.includes('checkpoint-end')).toBe(boundary === 'native-completion');
      expect(runtime['peers'].has(connection.id)).toBe(false);
    } finally {
      transport.dispose();
      runtime.close();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each([
  ['connection', 3999, true, undefined],
  ['connection', 4000, false, 4401],
  ['connection', 4001, false, 4401],
  ['job', 4999, true, undefined],
  ['job', 5000, false, 1013],
  ['job', 5001, false, 1013],
] as const)(
  'keeps physical checkpoint-end out of C2 after the final room callback crosses %s at %i ms',
  async (boundary, elapsed, delivered, code) => {
    const start = 2_000_000;
    let now = start;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cut = { generation: 'g', revision: 'cut' };
    const native: string[] = [];
    const close = vi.fn();
    const release = vi.fn(async () => undefined);
    const driver = {
      head: async () => cut,
      checkpoint: async () => ({
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: start + 6000,
        release,
      }),
      readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const connection: Connection = {
      id: `final-${boundary}-${elapsed}`,
      room: 'table',
      signal: new AbortController().signal,
      expiresAt: start + (boundary === 'connection' ? 4000 : 10_000),
      close,
      send: vi.fn(),
    };
    let inFinalCurrent = false;
    let advanced = false;
    const hub = new SyncHub();
    const budget = new FrameBudget();
    const transport = new FrameTransport(
      {
        readyState: WebSocket.OPEN,
        send: (message: string, done: (error?: Error) => void) => {
          native.push(message);
          done();
        },
      } as unknown as WebSocket,
      hub,
      { connectionId: connection.id, room: connection.room, expiresAt: connection.expiresAt },
      {},
      budget,
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) =>
        transport.sendTracked(message, {
          ...options,
          current: () => {
            inFinalCurrent = JSON.parse(message).kind === 'checkpoint-end';
            try {
              return options?.current?.() ?? true;
            } finally {
              inFinalCurrent = false;
            }
          },
        }),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => {
          if (inFinalCurrent && !advanced) {
            advanced = true;
            now = start + elapsed;
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const assembler = new AuthorityCheckpointAssembler({
      requestId: 'request',
      generation: 'g',
      requiredExtensions: [],
    });
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      native.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(advanced).toBe(true));
      await vi.waitFor(() =>
        expect(runtime['scheduler'].accountedUsage()).toMatchObject({
          heavySlots: 0,
          streamSlots: 0,
        }),
      );
      const kinds = native.map((message) => JSON.parse(message).kind as string);
      expect(kinds).toContain('checkpoint-begin');
      expect(kinds).toContain('checkpoint-chunk');
      expect(kinds.includes('checkpoint-end')).toBe(delivered);
      let assembly: Awaited<ReturnType<typeof assembler.accept>> | undefined;
      for (const message of native) assembly = await assembler.accept(message);
      expect(assembly?.status).toBe(delivered ? 'complete' : 'pending');
      expect(runtime['peers'].get(connection.id)?.phase === 'live').toBe(delivered);
      if (code === undefined) expect(close).not.toHaveBeenCalled();
      else expect(close).toHaveBeenCalledWith(code);
      expect(release).toHaveBeenCalledTimes(1);
      expect(budget['connections'].size).toBe(0);
      expect(budget['rooms'].size).toBe(0);
      expect(budget['global']).toEqual({ count: 0, bytes: 0 });
    } finally {
      assembler.dispose();
      transport.dispose();
      runtime.close();
      hub.close();
      clock.mockRestore();
    }
  },
);

it.each(['expiry', 'removal', 'replacement'] as const)(
  'rejects an old peer when resolveRoom crosses %s during currentness',
  (mode) => {
    const start = 3_000_000;
    let now = start;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const close = vi.fn();
    const old: Connection = {
      id: 'same',
      room: 'table',
      signal: new AbortController().signal,
      expiresAt: start + 4000,
      close,
      send: vi.fn(),
    };
    const successor: Connection = {
      id: 'same',
      room: 'table',
      signal: new AbortController().signal,
      expiresAt: start + 10_000,
      close: vi.fn(),
      send: vi.fn(),
    };
    registerAuthorityConnection(old, {
      sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
    });
    registerAuthorityConnection(successor, {
      sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
    });
    let crossed = false;
    const runtime = new AuthorityRuntime(
      {
        driver: {} as AuthorityDriver,
        resolveRoom: () => {
          if (!crossed) {
            crossed = true;
            if (mode === 'expiry') now = start + 4000;
            else {
              runtime.remove(old.id);
              if (mode === 'replacement') expect(runtime.admit(successor, definition)).toBe(true);
            }
          }
          return definition;
        },
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      expect(runtime.admit(old, definition)).toBe(true);
      const oldPeer = runtime['peers'].get(old.id);
      if (!oldPeer) throw new Error('missing old peer');
      expect(runtime['current'](oldPeer)).toBe(false);
      if (mode === 'expiry') expect(close).toHaveBeenCalledWith(4401);
      if (mode === 'replacement') {
        expect(runtime['peers'].get(old.id)?.connection).toBe(successor);
        expect(successor.close).not.toHaveBeenCalled();
      }
    } finally {
      runtime.close();
      clock.mockRestore();
    }
  },
);

it.each(['disconnect', 'deadline', 'shutdown'] as const)(
  'releases queued checkpoint ownership on %s while both heavy slots stay held',
  async (mode) => {
    const cut = { generation: 'g', revision: 'cut' };
    const checkpoint = vi.fn();
    const driver = {
      head: async () => cut,
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => definition,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    const firstHeavy = runtime['scheduler'].reserve('heavy');
    const secondHeavy = runtime['scheduler'].reserve('heavy');
    expect(firstHeavy).toBeTypeOf('function');
    expect(secondHeavy).toBeTypeOf('function');
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      for (let index = 0; index < 6; index++) {
        if (mode === 'shutdown' && index > 0) break;
        const controller = new AbortController();
        const id = `queued-${index}`;
        const connection: Connection = {
          id,
          room: 'table',
          signal: controller.signal,
          close: vi.fn(),
          send: vi.fn(),
        };
        registerAuthorityConnection(connection, {
          sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
        });
        expect(runtime.admit(connection, definition)).toBe(true);
        await runtime.handleMessage(
          id,
          JSON.stringify({
            from: id,
            op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
          }),
        );
        const previousTimers = timers.mock.calls.length;
        await runtime.handleMessage(
          id,
          JSON.stringify({
            protocol: 'authority:1',
            kind: 'checkpoint-request',
            requestId: `req-${index}`,
            generation: 'g',
          }),
        );
        expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
        if (mode === 'disconnect') controller.abort();
        else if (mode === 'deadline') {
          const deadline = timers.mock.calls
            .slice(previousTimers)
            .find((call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000);
          expect(deadline).toBeDefined();
          deadline?.[0]();
        } else runtime.close();
        expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0);
        expect(runtime.pinnedDefinitionId('table')).toBeUndefined();
      }
      expect(checkpoint).not.toHaveBeenCalled();
      expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(2);
    } finally {
      timers.mockRestore();
      firstHeavy?.();
      secondHeavy?.();
      runtime.close();
    }
  },
);

it.each([
  ['absent', undefined, true],
  ['lowercase', 'a'.repeat(64), true],
  ['uppercase', 'A'.repeat(64), true],
  ['empty', '', false],
  ['short', 'a'.repeat(63), false],
  ['long', 'a'.repeat(65), false],
  ['nonhex', `${'a'.repeat(63)}z`, false],
  ['number', 42, false],
  ['null', null, false],
] as const)(
  'validates capture CAS %s before any checkpoint frame',
  async (_label, casToken, valid) => {
    const cut = { generation: 'g', revision: 'cut' };
    const release = vi.fn(async () => undefined);
    const driver = {
      head: async () => cut,
      checkpoint: async () => ({
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release,
        ...(casToken === undefined ? {} : { casToken }),
      }),
      readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: 'cas',
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        'cas',
        JSON.stringify({
          from: 'cas',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      sent.length = 0;
      await runtime.handleMessage(
        'cas',
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      if (valid) {
        await vi.waitFor(() =>
          expect(sent.some((message) => JSON.parse(message).kind === 'checkpoint-end')).toBe(true),
        );
        expect(close).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
        expect(sent).toEqual([]);
      }
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      runtime.close();
    }
  },
);

it.each([
  ['checkpoint-begin', 'definition'],
  ['checkpoint-begin', 'capacity'],
  ['checkpoint-chunk', 'generation'],
  ['checkpoint-end', 'definition'],
  ['checkpoint-end', 'generation'],
] as const)(
  'blocks a stale physical %s after outbound authorization on %s replacement',
  async (targetKind, replacement) => {
    const cut = { generation: 'g', revision: 'cut' };
    let head = cut;
    let room: AuthorityRoomDefinition | null = definition;
    let heldMetadata: (() => void)[] = [];
    let allow: ((value: boolean) => void) | undefined;
    const native: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        native.push(message);
        done();
      },
    } as unknown as WebSocket;
    const driver = {
      head: async () => head,
      checkpoint: async () => ({
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      readAfter: async () => ({ status: 'ok', head, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const close = vi.fn();
    const controller = new AbortController();
    const connection: Connection = {
      id: 'physical',
      room: 'table',
      signal: controller.signal,
      close,
      send: vi.fn(),
    };
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      {
        authorize: ({ direction, message }) => {
          if (direction === 'outbound' && JSON.parse(message).kind === targetKind)
            return new Promise<boolean>((resolve) => {
              allow = resolve;
            });
          return true;
        },
      },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => room,
        resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        'physical',
        JSON.stringify({
          from: 'physical',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      native.length = 0;
      await runtime.handleMessage(
        'physical',
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(allow).toBeDefined());
      if (replacement === 'definition') room = null;
      else if (replacement === 'generation') head = { generation: 'other', revision: 'new' };
      else {
        heldMetadata = Array.from({ length: 8 }, () => {
          const release = runtime['scheduler'].reserve('metadata');
          if (!release) throw new Error('missing metadata reservation');
          return release;
        });
      }
      allow?.(true);
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(native.some((message) => JSON.parse(message).kind === targetKind)).toBe(false);
      expect(runtime['peers'].has('physical')).toBe(false);
    } finally {
      allow?.(true);
      heldMetadata.forEach((release) => release());
      transport.dispose();
      runtime.close();
      hub.close();
    }
  },
);

it.each(['preparing', 'streaming'] as const)(
  'commits proposals during a subsequent %s checkpoint and replays the cut afterward',
  async (phase) => {
    const store = new AuthorityFixtureStore();
    store.now = Date.now();
    store.provision('table');
    const actual = new AuthorityFixtureDriver(store);
    const initial = store.getRoom('table');
    if (!initial) throw new Error('missing fixture room');
    let releaseCapture: (() => void) | undefined;
    let releaseChunk: (() => void) | undefined;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    const checkpoint = vi.fn(async (...args: Parameters<AuthorityDriver['checkpoint']>) => {
      const captured = await actual.checkpoint(...args);
      if (phase === 'preparing') await captureGate;
      return captured;
    });
    const commit = vi.fn(actual.commit.bind(actual));
    const readAfter = vi.fn(actual.readAfter.bind(actual));
    const driver: AuthorityDriver = {
      head: actual.head.bind(actual),
      checkpoint,
      commit,
      readAfter,
      readEvidence: actual.readEvidence.bind(actual),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    };
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `later-${phase}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        if (phase === 'streaming' && JSON.parse(message).kind === 'checkpoint-chunk')
          return { completion: chunkGate, settled: chunkGate };
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      runtime.activate(connection.id, initial.position, initial.state);
      sent.length = 0;
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'later',
          generation: 'g',
        }),
      );
      if (phase === 'preparing')
        await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
      else
        await vi.waitFor(() =>
          expect(sent.some((message) => JSON.parse(message).kind === 'checkpoint-chunk')).toBe(
            true,
          ),
        );
      const operationId = createAuthorityOperationId(store.now);
      await runtime.handleMessage(
        connection.id,
        proposal(operationId, { kind: 'upsert', element }),
      );
      expect(commit).toHaveBeenCalledTimes(1);
      expect(sent.some((message) => JSON.parse(message).kind === 'receipt')).toBe(true);
      expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(false);
      expect(close).not.toHaveBeenCalled();
      releaseCapture?.();
      releaseChunk?.();
      await vi.waitFor(() =>
        expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(true),
      );
      const frames = sent.map((message) => JSON.parse(message));
      expect(frames.filter((frame) => frame.kind === 'changes')).toHaveLength(1);
      expect(frames.findIndex((frame) => frame.kind === 'changes')).toBeGreaterThan(
        frames.findIndex((frame) => frame.kind === 'checkpoint-end'),
      );
      expect(
        readAfter.mock.calls.some((call) => call[1].revision === initial.position.revision),
      ).toBe(true);
      expect(close).not.toHaveBeenCalled();
    } finally {
      releaseCapture?.();
      releaseChunk?.();
      runtime.close();
    }
  },
);

it.each(['preparing', 'streaming'] as const)(
  'rejects an initial proposal during %s before successful activation',
  async (phase) => {
    const cut = { generation: 'g', revision: 'cut' };
    let releaseCapture: (() => void) | undefined;
    let releaseChunk: (() => void) | undefined;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    const checkpoint = vi.fn(async () => {
      if (phase === 'preparing') await captureGate;
      return {
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      };
    });
    const commit = vi.fn();
    const driver = {
      head: async () => cut,
      checkpoint,
      commit,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const sent: string[] = [];
    const close = vi.fn();
    const connection: Connection = {
      id: `initial-${phase}`,
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        if (phase === 'streaming' && JSON.parse(message).kind === 'checkpoint-chunk')
          return { completion: chunkGate, settled: chunkGate };
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'initial',
          generation: 'g',
        }),
      );
      if (phase === 'preparing')
        await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
      else
        await vi.waitFor(() =>
          expect(sent.some((message) => JSON.parse(message).kind === 'checkpoint-chunk')).toBe(
            true,
          ),
        );
      await runtime.handleMessage(
        connection.id,
        proposal(createAuthorityOperationId(), { kind: 'upsert', element }),
      );
      expect(commit).not.toHaveBeenCalled();
      expect(sent.some((message) => JSON.parse(message).kind === 'upgrade-required')).toBe(true);
      expect(close).toHaveBeenCalledWith(4406);
    } finally {
      releaseCapture?.();
      releaseChunk?.();
      runtime.close();
    }
  },
);

it.each(['abort', 'deadline'] as const)(
  'retains physical-head metadata, stream, frame, and peer pins through ignored %s settlement',
  async (mode) => {
    const cut = { generation: 'g', revision: 'cut' };
    let settleHead: ((position: typeof cut) => void) | undefined;
    let calls = 0;
    const head = vi.fn(() => {
      calls++;
      if (calls === 3)
        return new Promise<typeof cut>((resolve) => {
          settleHead = resolve;
        });
      return Promise.resolve(cut);
    });
    const driver = {
      head,
      checkpoint: async () => ({
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const controller = new AbortController();
    const connection: Connection = {
      id: 'held-head',
      room: 'table',
      signal: controller.signal,
      close: vi.fn(),
      send: vi.fn(),
    };
    const nativeSend = vi.fn((_message: string, done: (error?: Error) => void) => done());
    const ws = { readyState: WebSocket.OPEN, send: nativeSend } as unknown as WebSocket;
    const budget = new FrameBudget(1, 2 * 1024 * 1024, 1, 2 * 1024 * 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      {},
      budget,
      vi.fn(),
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
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
    let timers: ReturnType<typeof vi.spyOn> | undefined;
    try {
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      timers = vi.spyOn(globalThis, 'setTimeout');
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(settleHead).toBeDefined());
      expect(runtime['scheduler']['usage'].metadata).toBe(1);
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
      expect(budget.reserve('another', 'table', 'small')).toBeNull();
      if (mode === 'abort') {
        controller.abort();
        transport.dispose();
      } else {
        const job = [...transport['jobs']][0];
        if (!job) throw new Error('missing physical job');
        const index = timers.mock.results.findIndex(
          (result: { value: unknown }) => result.value === job.timer,
        );
        const fire = timers.mock.calls[index]?.[0];
        if (!fire) throw new Error('missing physical deadline');
        const clock = vi.spyOn(Date, 'now').mockReturnValue(job.deadlineAt);
        try {
          fire();
        } finally {
          clock.mockRestore();
        }
      }
      expect(runtime['scheduler']['usage'].metadata).toBe(1);
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
      expect(runtime.pinnedDefinitionId('table')).toBe('definition');
      const healthy: Connection = {
        id: 'healthy',
        room: 'healthy',
        signal: new AbortController().signal,
        close: vi.fn(),
        send: vi.fn(),
      };
      registerAuthorityConnection(healthy, {
        sendTracked: () => ({ completion: Promise.resolve(), settled: Promise.resolve() }),
      });
      expect(runtime.admit(healthy, definition)).toBe(true);
      await runtime.handleMessage(
        healthy.id,
        JSON.stringify({
          from: healthy.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      expect(head).toHaveBeenCalledTimes(4);
      expect(runtime['scheduler']['usage'].metadata).toBe(1);
      settleHead?.(cut);
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0));
      expect(runtime['scheduler']['usage'].metadata).toBe(0);
      expect(runtime.pinnedDefinitionId('table')).toBeUndefined();
      const release = budget.reserve('another', 'table', 'small');
      expect(release).toBeTypeOf('function');
      release?.();
      expect(
        nativeSend.mock.calls.some((call) => JSON.parse(call[0]).kind === 'checkpoint-begin'),
      ).toBe(false);
    } finally {
      settleHead?.(cut);
      timers?.mockRestore();
      transport.dispose();
      runtime.close();
      hub.close();
    }
  },
);

it.each([
  ['begin', 'deadline', false],
  ['begin', 'expiry', false],
  ['begin', 'disconnect', true],
  ['end', 'deadline', true],
  ['end', 'shutdown', false],
] as const)(
  'owns the pre-%s second head through %s and late settlement',
  async (phase, interruption, rejectLate) => {
    const cut = { generation: 'g', revision: 'cut' };
    let callCount = 0;
    let settleHead: ((reject: boolean) => void) | undefined;
    let callerTimer: (() => void) | undefined;
    let callerDeadline = 0;
    let timers: ReturnType<typeof vi.spyOn> | undefined;
    const stalledCall = phase === 'begin' ? 2 : 5;
    const head = vi.fn((_context: unknown, options: { deadlineAt: number }) => {
      callCount++;
      if (callCount !== stalledCall) return Promise.resolve(cut);
      callerDeadline = options.deadlineAt;
      const callback = timers?.mock.calls.at(-1)?.[0];
      if (typeof callback === 'function') callerTimer = callback;
      return new Promise<typeof cut>((resolve, reject) => {
        settleHead = (shouldReject) =>
          shouldReject
            ? reject(new Error('late head'))
            : resolve({ generation: 'replacement', revision: 'late' });
      });
    });
    const driver = {
      head,
      checkpoint: async () => ({
        position: cut,
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const controller = new AbortController();
    const close = vi.fn();
    const connection: Connection = {
      id: `pre-${phase}`,
      room: 'table',
      signal: controller.signal,
      close,
      send: vi.fn(),
      ...(interruption === 'expiry' ? { expiresAt: Date.now() + 2000 } : {}),
    };
    const kinds: string[] = [];
    let beginAdmission = 0;
    const nativeSend = vi.fn((message: string, done: (error?: Error) => void) => {
      const kind = JSON.parse(message).kind as string;
      kinds.push(kind);
      if (kind === 'checkpoint-begin') beginAdmission = Date.now();
      done();
    });
    const ws = { readyState: WebSocket.OPEN, send: nativeSend } as unknown as WebSocket;
    const budget = new FrameBudget(4, 4 * 1024 * 1024, 4, 4 * 1024 * 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      {},
      budget,
      vi.fn(),
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => transport.sendTracked(message, options),
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      timers = vi.spyOn(globalThis, 'setTimeout');
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'request',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(settleHead).toBeDefined());
      expect(head).toHaveBeenCalledTimes(stalledCall); // second pre-enqueue head, not the physical third
      expect(callerTimer).toBeTypeOf('function');
      expect(runtime['scheduler']['usage'].metadata).toBe(1);
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
      if (phase === 'begin' && interruption !== 'expiry')
        expect(callerDeadline - Date.now()).toBeGreaterThan(4500);
      if (interruption === 'expiry') expect(callerDeadline - Date.now()).toBeLessThanOrEqual(2000);
      if (phase === 'end') {
        expect(beginAdmission).toBeGreaterThan(0);
        expect(callerDeadline).toBeLessThanOrEqual(beginAdmission + 10_000);
      }
      if (interruption === 'deadline' || interruption === 'expiry') {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(callerDeadline);
        try {
          callerTimer?.();
        } finally {
          clock.mockRestore();
        }
        expect(close).toHaveBeenCalledWith(interruption === 'expiry' ? 4401 : 1013);
      } else if (interruption === 'disconnect') controller.abort();
      else runtime.close();
      expect(runtime['scheduler']['usage'].metadata).toBe(1);
      expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
      expect(runtime.pinnedDefinitionId('table')).toBe('definition');
      const previousKinds = [...kinds];
      settleHead?.(rejectLate);
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0));
      expect(runtime['scheduler']['usage'].metadata).toBe(0);
      expect(runtime.pinnedDefinitionId('table')).toBeUndefined();
      expect(kinds).toEqual(previousKinds);
      expect(kinds).not.toContain('checkpoint-end');
      expect(kinds.filter((kind) => kind === 'resync-required')).toHaveLength(1);
    } finally {
      settleHead?.(true);
      timers?.mockRestore();
      transport.dispose();
      runtime.close();
      hub.close();
    }
  },
);

it('streams a near-limit captured cut and then replays a concurrent visible commit without holding inbound work', async () => {
  const cut = { generation: 'g', revision: 'cut' };
  const next = { generation: 'g', revision: 'next' };
  const large = {
    id: 'large',
    type: 'note' as const,
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    size: { w: 1, h: 1 },
    text: 'x'.repeat(18_500_000),
    backgroundColor: 'white',
    textColor: 'black',
  };
  const captured = { elements: [large], layers: [], extensions: {} };
  const after = { elements: [large, element], layers: [], extensions: {} };
  const sent: string[] = [];
  let releaseChunk: (() => void) | undefined;
  let resumeCapture: (() => void) | undefined;
  let committed = false;
  const captureGate = new Promise<void>((resolve) => {
    resumeCapture = resolve;
  });
  const checkpoint = vi.fn(async () => {
    await captureGate;
    return {
      position: cut,
      state: captured,
      token: 'lease',
      expiresAt: Date.now() + 5000,
      release: async () => undefined,
    };
  });
  const readAfter = vi.fn(async (_context: unknown, position: typeof cut) =>
    position.revision === 'cut' && committed
      ? {
          status: 'ok' as const,
          head: next,
          records: [
            {
              previous: cut,
              position: next,
              before: authorityReference,
              after: authorityReference,
            },
          ],
        }
      : { status: 'ok' as const, head: next, records: [] },
  );
  const driver = {
    head: async () => cut,
    checkpoint,
    readAfter,
    readEvidence: async () => ({
      status: 'available',
      lease: {
        before: captured,
        after,
        token: 'evidence',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      },
    }),
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const connection: Connection = {
    id: 'paced',
    room: 'table',
    signal: new AbortController().signal,
    close: vi.fn(),
    send: vi.fn(),
  };
  registerAuthorityConnection(connection, {
    sendTracked: (message) => {
      sent.push(message);
      if (JSON.parse(message).kind === 'checkpoint-chunk' && !releaseChunk) {
        const completion = new Promise<void>((resolve) => {
          releaseChunk = resolve;
        });
        return { completion, settled: completion };
      }
      return { completion: Promise.resolve(), settled: Promise.resolve() };
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
    expect(runtime.admit(connection, definition)).toBe(true);
    await runtime.handleMessage(
      'paced',
      JSON.stringify({
        from: 'paced',
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    sent.length = 0;
    const requestedAt = performance.now();
    await runtime.handleMessage(
      'paced',
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'req',
        generation: 'g',
      }),
    );
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));
    committed = true;
    await fanout.publish(
      JSON.stringify({
        authority: 1,
        room: 'table',
        definitionId: definition.id,
        position: next,
      }),
    );
    resumeCapture?.();
    await vi.waitFor(() => expect(releaseChunk).toBeTypeOf('function'), { timeout: 10_000 });
    const firstChunkAt = performance.now();
    expect(runtime['scheduler'].accountedUsage()).toMatchObject({
      heavySlots: 0,
      heavyBytes: 0,
      streamSlots: 1,
      streamBytes: 24 * 1024 * 1024,
    });
    expect(readAfter).not.toHaveBeenCalled();
    expect(sent.filter((message) => JSON.parse(message).kind === 'checkpoint-begin')).toHaveLength(
      1,
    );
    releaseChunk?.();
    await vi.waitFor(() =>
      expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(true),
    );
    const replayAt = performance.now();
    const kinds = sent.map((message) => JSON.parse(message).kind);
    expect(kinds[0]).toBe('checkpoint-begin');
    expect(kinds.filter((kind) => kind === 'checkpoint-chunk').length).toBeGreaterThan(30);
    expect(kinds.slice(-2)).toEqual(['checkpoint-end', 'changes']);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(readAfter.mock.calls[0]?.[1]).toEqual(cut);
    console.info(
      `near-limit runtime: capture-to-first-chunk ${Math.round(firstChunkAt - requestedAt)} ms, capture-to-replay ${Math.round(replayAt - requestedAt)} ms, stream reservation ${24 * 1024 * 1024} bytes`,
    );
  } finally {
    resumeCapture?.();
    releaseChunk?.();
    runtime.close();
  }
}, 30_000);

it('retains four stream slots after checkpoint-end completion until actual settlement', async () => {
  const cut = { generation: 'g', revision: 'cut' };
  const pending: (() => void)[] = [];
  const closes: ReturnType<typeof vi.fn>[] = [];
  const driver = {
    head: async () => cut,
    checkpoint: async () => ({
      position: cut,
      state: emptyAuthorityState,
      token: 'lease',
      expiresAt: Date.now() + 5000,
      release: async () => undefined,
    }),
    readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
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
    for (let index = 0; index < 5; index++) {
      const id = `stream-${index}`;
      const close = vi.fn();
      closes.push(close);
      const connection: Connection = {
        id,
        room: id,
        signal: new AbortController().signal,
        close,
        send: vi.fn(),
      };
      registerAuthorityConnection(connection, {
        sendTracked: (message) => {
          if (JSON.parse(message).kind === 'checkpoint-end') {
            let finish: (() => void) | undefined;
            const settled = new Promise<void>((resolve) => {
              finish = resolve;
            });
            pending.push(() => finish?.());
            return { completion: Promise.resolve(), settled };
          }
          return { completion: Promise.resolve(), settled: Promise.resolve() };
        },
      });
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        id,
        JSON.stringify({
          from: id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      await runtime.handleMessage(
        id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: id,
          generation: 'g',
        }),
      );
      if (index < 4) await vi.waitFor(() => expect(pending).toHaveLength(index + 1));
    }
    expect(closes[4]).toHaveBeenCalledWith(1013);
    expect(runtime['scheduler'].accountedUsage()).toMatchObject({
      heavySlots: 0,
      streamSlots: 4,
      streamBytes: 96 * 1024 * 1024,
    });
    const first = runtime['peers'].get('stream-0');
    if (!first) throw new Error('missing stream peer');
    first.lastClientRequestAt = Date.now() - 10_001;
    await runtime.handleMessage(
      'stream-0',
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'second',
        generation: 'g',
      }),
    );
    expect(closes[0]).toHaveBeenCalledWith(1013);
    expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(4);
    expect(runtime['scheduler'].reserve('stream')).toBeNull();
    pending.forEach((finish) => finish());
    await vi.waitFor(() => {
      const release = runtime['scheduler'].reserve('stream');
      expect(release).toBeTypeOf('function');
      release?.();
    });
  } finally {
    pending.forEach((finish) => finish());
    runtime.close();
  }
});

it('holds heavy ownership through encoded replay and sends only after evidence release', async () => {
  const next = { generation: 'g', revision: 'next' };
  const record = {
    previous: initialAuthorityPosition,
    position: next,
    before: authorityReference,
    after: authorityReference,
  };
  let resolveRelease: (() => void) | undefined;
  const releaseGate = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const release = vi.fn(() => releaseGate);
  const marker = 'encoded-under-heavy-marker';
  const after = { elements: [{ ...element, fillColor: marker }], layers: [], extensions: {} };
  const driver = {
    head: async () => initialAuthorityPosition,
    readAfter: async (_context: unknown, position: typeof next) =>
      position.revision === 'start'
        ? { status: 'ok' as const, head: next, records: [record] }
        : { status: 'ok' as const, head: next, records: [] },
    readEvidence: async () => ({
      status: 'available' as const,
      lease: {
        before: emptyAuthorityState,
        after,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release,
      },
    }),
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const connection: Connection = {
    id: 'encoded-replay',
    room: 'table',
    signal: new AbortController().signal,
    close: vi.fn(),
    send: vi.fn(),
  };
  let heavyAtSend = -1;
  const sent: string[] = [];
  const runtime = new AuthorityRuntime(
    {
      driver,
      resolveRoom: () => definition,
      resolveIdentity: () => ({ actorId: 'actor', ownershipId: 'owner' }),
    },
    new InMemoryHubFanout(),
    'worker',
  );
  registerAuthorityConnection(connection, {
    sendTracked: (message) => {
      if (JSON.parse(message).kind === 'changes')
        heavyAtSend = runtime['scheduler'].accountedUsage().heavySlots;
      sent.push(message);
      return { completion: Promise.resolve(), settled: Promise.resolve() };
    },
  });
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    expect(runtime.admit(connection, definition)).toBe(true);
    await runtime.handleMessage(
      connection.id,
      JSON.stringify({
        from: connection.id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    runtime.activate(connection.id, initialAuthorityPosition, emptyAuthorityState);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(1);
    expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(false);
    const markerQuotesAtRelease = stringify.mock.calls.filter(([value]) => value === marker).length;
    expect(markerQuotesAtRelease).toBeGreaterThan(0);
    resolveRelease?.();
    await vi.waitFor(() =>
      expect(sent.some((message) => JSON.parse(message).kind === 'changes')).toBe(true),
    );
    expect(heavyAtSend).toBe(0);
    expect(stringify.mock.calls.filter(([value]) => value === marker)).toHaveLength(
      markerQuotesAtRelease,
    );
  } finally {
    resolveRelease?.();
    stringify.mockRestore();
    runtime.close();
  }
});

it.each(['checkpoint', 'live', 'disconnect', 'shutdown', 'token'] as const)(
  'keeps staged replay bound to its stream after evidence release: %s',
  async (mode) => {
    const next = { generation: 'g', revision: 'next' };
    const post = { generation: 'g', revision: 'post' };
    const before = emptyAuthorityState;
    const changed = { elements: [element], layers: [], extensions: {} };
    const afterPost = {
      elements: [{ ...element, fillColor: 'post-cut' }],
      layers: [],
      extensions: {},
    };
    const first = {
      previous: initialAuthorityPosition,
      position: next,
      before: authorityReference,
      after: authorityReference,
    };
    const second = { ...first, previous: next, position: post };
    let settleRelease: (() => void) | undefined;
    const releaseGate = new Promise<void>((resolve) => {
      settleRelease = resolve;
    });
    const release = vi.fn(() => releaseGate);
    const checkpoint = vi.fn(async () => ({
      position: next,
      state: changed,
      token: 'capture',
      expiresAt: Date.now() + 5000,
      release: async () => undefined,
    }));
    const driver = {
      head: async () => next,
      readAfter: async (_context: unknown, position: typeof next) => {
        if (position.revision === 'start')
          return { status: 'ok' as const, head: next, records: [first] };
        if (mode === 'checkpoint' && position.revision === 'next' && checkpoint.mock.calls.length)
          return { status: 'ok' as const, head: post, records: [second] };
        return { status: 'ok' as const, head: position, records: [] };
      },
      readEvidence: async (_context: unknown, record: typeof first) => ({
        status: 'available' as const,
        lease: {
          before: record.position.revision === 'next' ? before : changed,
          after: record.position.revision === 'next' ? changed : afterPost,
          token: 'evidence',
          expiresAt: Date.now() + 5000,
          release: record.position.revision === 'next' ? release : async () => undefined,
        },
      }),
      checkpoint,
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const offered: string[] = [];
    const native: string[] = [];
    const close = vi.fn();
    const controller = new AbortController();
    const connection: Connection = {
      id: `staged-${mode}`,
      room: 'table',
      signal: controller.signal,
      close,
      send: vi.fn(),
    };
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        native.push(message);
        done();
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: connection.id, room: connection.room },
      { authorize: () => true },
      new FrameBudget(),
      close,
    );
    registerAuthorityConnection(connection, {
      sendTracked: (message, options) => {
        offered.push(message);
        return transport.sendTracked(message, options);
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
      expect(runtime.admit(connection, definition)).toBe(true);
      await runtime.handleMessage(
        connection.id,
        JSON.stringify({
          from: connection.id,
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      await vi.waitFor(() =>
        expect(runtime['peers'].get(connection.id)?.phase).toBe('awaiting-request'),
      );
      offered.length = 0;
      native.length = 0;
      runtime.activate(connection.id, initialAuthorityPosition, before);
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      const peer = runtime['peers'].get(connection.id);
      if (!peer) throw new Error('missing replay peer');
      const oldCursor = peer.cursor;
      const oldHash = peer.visibleHash;
      const oldToken = peer.sendToken;
      const oldStreamToken = peer.streamToken;
      expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(1);
      expect(offered).toEqual([]);
      expect(native).toEqual([]);
      if (mode === 'checkpoint') {
        await runtime.handleMessage(
          connection.id,
          JSON.stringify({
            protocol: 'authority:1',
            kind: 'checkpoint-request',
            requestId: 'later',
            generation: 'g',
          }),
        );
        expect(peer.phase).toBe('preparing');
        expect(peer.streamToken).toBe(oldStreamToken + 1);
        expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(1);
        expect(checkpoint).not.toHaveBeenCalled();
      } else if (mode === 'token') {
        peer.streamToken++;
        expect(peer.phase).toBe('live');
      } else if (mode === 'disconnect') {
        controller.abort();
      } else if (mode === 'shutdown') {
        runtime.close();
      }
      expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(offered).toEqual([]);
      expect(native).toEqual([]);
      settleRelease?.();
      await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(0));
      expect(release).toHaveBeenCalledTimes(1);
      if (mode === 'checkpoint') {
        await vi.waitFor(() => expect(peer.phase).toBe('live'));
        await vi.waitFor(() => expect(native).toHaveLength(4));
        const offeredFrames = offered.map((message) => JSON.parse(message));
        const nativeFrames = native.map((message) => JSON.parse(message));
        expect(offeredFrames.map((frame) => frame.kind)).toEqual([
          'checkpoint-begin',
          'checkpoint-chunk',
          'checkpoint-end',
          'changes',
        ]);
        expect(nativeFrames.map((frame) => frame.kind)).toEqual(
          offeredFrames.map((frame) => frame.kind),
        );
        const assembler = new AuthorityCheckpointAssembler({
          requestId: 'later',
          generation: 'g',
          requiredExtensions: [],
        });
        for (const message of native.slice(0, 3)) {
          const result = await assembler.accept(message);
          if (message === native[2]) {
            expect(result.status).toBe('complete');
            if (result.status === 'complete') {
              expect(result.checkpoint.elements).toEqual([element]);
              expect(result.checkpoint.cursor.revision).toBe(0);
            }
          }
        }
        assembler.dispose();
        expect(offeredFrames[3]?.cursor.revision).toBe(1);
        expect(offeredFrames[3]?.mutations).toContainEqual({
          kind: 'upsert',
          element: afterPost.elements[0],
        });
        expect(peer.position).toEqual(post);
        expect(peer.cursor?.revision).toBe(1);
        expect(peer.cursor?.streamId).not.toBe(oldCursor?.streamId);
        expect(peer.cursor?.streamId).toBe(offeredFrames[3]?.cursor.streamId);
        expect(peer.visibleHash).not.toBe(oldHash);
        expect(peer.sendToken).toBeUndefined();
        expect(runtime['scheduler'].accountedUsage().streamSlots).toBe(0);
      } else if (mode === 'live') {
        await vi.waitFor(() => expect(native).toHaveLength(1));
        expect(offered.map((message) => JSON.parse(message).kind)).toEqual(['changes']);
        expect(JSON.parse(native[0] ?? '').cursor.revision).toBe(1);
        await vi.waitFor(() => expect(peer.position).toEqual(next));
        expect(peer.cursor?.revision).toBe(1);
        expect(peer.sendToken).toBeUndefined();
      } else {
        expect(offered).toEqual([]);
        expect(native).toEqual([]);
        expect(peer.cursor).toEqual(oldCursor);
        expect(peer.position).toEqual(initialAuthorityPosition);
        expect(peer.visibleHash).toBe(oldHash);
        expect(peer.sendToken).toBe(oldToken);
        if (mode === 'shutdown') expect(close).toHaveBeenCalledWith(1013);
        else expect(close).not.toHaveBeenCalled();
      }
    } finally {
      settleRelease?.();
      transport.dispose();
      runtime.close();
      hub.close();
    }
  },
);

it.each(['generation', 'definition'] as const)(
  'abandons an incomplete stream when %s changes before checkpoint-end',
  async (change) => {
    let generation = 'g';
    let currentDefinition: AuthorityRoomDefinition | null = definition;
    let releaseChunk: (() => void) | undefined;
    const sent: string[] = [];
    const close = vi.fn();
    const driver = {
      head: async () => ({ generation, revision: 'cut' }),
      checkpoint: async () => ({
        position: { generation: 'g', revision: 'cut' },
        state: emptyAuthorityState,
        token: 'lease',
        expiresAt: Date.now() + 5000,
        release: async () => undefined,
      }),
      claimPublications: async () => [],
      markPublished: async () => undefined,
    } as unknown as AuthorityDriver;
    const connection: Connection = {
      id: 'replacement',
      room: 'table',
      signal: new AbortController().signal,
      close,
      send: vi.fn(),
    };
    registerAuthorityConnection(connection, {
      sendTracked: (message) => {
        sent.push(message);
        if (JSON.parse(message).kind === 'checkpoint-chunk') {
          const completion = new Promise<void>((resolve) => {
            releaseChunk = resolve;
          });
          return { completion, settled: completion };
        }
        return { completion: Promise.resolve(), settled: Promise.resolve() };
      },
    });
    const runtime = new AuthorityRuntime(
      {
        driver,
        resolveRoom: () => currentDefinition,
        resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
      },
      new InMemoryHubFanout(),
      'worker',
    );
    try {
      runtime.admit(connection, definition);
      await runtime.handleMessage(
        'replacement',
        JSON.stringify({
          from: 'replacement',
          op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
        }),
      );
      sent.length = 0;
      await runtime.handleMessage(
        'replacement',
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: 'req',
          generation: 'g',
        }),
      );
      await vi.waitFor(() => expect(releaseChunk).toBeDefined());
      if (change === 'generation') generation = 'new-generation';
      else currentDefinition = null;
      releaseChunk?.();
      if (change === 'generation')
        await vi.waitFor(() =>
          expect(sent.some((frame) => JSON.parse(frame).kind === 'resync-required')).toBe(true),
        );
      else await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
      expect(sent.some((frame) => JSON.parse(frame).kind === 'checkpoint-end')).toBe(false);
      if (change === 'generation') expect(close).not.toHaveBeenCalled();
    } finally {
      releaseChunk?.();
      runtime.close();
    }
  },
);

it('keeps a failed chunk stream charged after caller rejection until tracked settlement', async () => {
  let rejectChunk: ((error: Error) => void) | undefined;
  let settleChunk: (() => void) | undefined;
  const close = vi.fn();
  const cut = { generation: 'g', revision: 'cut' };
  const driver = {
    head: async () => cut,
    checkpoint: async () => ({
      position: cut,
      state: emptyAuthorityState,
      token: 'lease',
      expiresAt: Date.now() + 5000,
      release: async () => undefined,
    }),
    claimPublications: async () => [],
    markPublished: async () => undefined,
  } as unknown as AuthorityDriver;
  const connection: Connection = {
    id: 'failed-chunk',
    room: 'table',
    signal: new AbortController().signal,
    close,
    send: vi.fn(),
  };
  registerAuthorityConnection(connection, {
    sendTracked: (message) => {
      if (JSON.parse(message).kind === 'checkpoint-chunk') {
        const completion = new Promise<void>((_resolve, reject) => {
          rejectChunk = reject;
        });
        const settled = new Promise<void>((resolve) => {
          settleChunk = resolve;
        });
        return { completion, settled };
      }
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
    runtime.admit(connection, definition);
    await runtime.handleMessage(
      connection.id,
      JSON.stringify({
        from: connection.id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    await runtime.handleMessage(
      connection.id,
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'req',
        generation: 'g',
      }),
    );
    await vi.waitFor(() => expect(rejectChunk).toBeDefined());
    rejectChunk?.(new Error('native send failed'));
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1013));
    const slots = Array.from({ length: 3 }, () => runtime['scheduler'].reserve('stream'));
    expect(slots.every((release) => typeof release === 'function')).toBe(true);
    expect(runtime['scheduler'].reserve('stream')).toBeNull();
    settleChunk?.();
    await vi.waitFor(() => {
      const release = runtime['scheduler'].reserve('stream');
      expect(release).toBeTypeOf('function');
      release?.();
    });
    slots.forEach((release) => release?.());
  } finally {
    settleChunk?.();
    runtime.close();
  }
});

it('charges ignored-abort checkpoint release work while an unrelated negotiation progresses', async () => {
  const cut = { generation: 'g', revision: 'cut' };
  const releases: (() => void)[] = [];
  const head = vi.fn(async (_context: { connectionId: string }) => cut);
  const checkpoint = vi.fn(async (context: { connectionId: string }) => ({
    position: cut,
    state: emptyAuthorityState,
    token: 'lease',
    expiresAt: Date.now() + 5000,
    release: context.connectionId.startsWith('held-')
      ? () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          })
      : async () => undefined,
  }));
  const driver = {
    head,
    checkpoint,
    readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
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
  const join = async (id: string) => {
    const connection: Connection = {
      id,
      room: id,
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
    expect(runtime.admit(connection, definition)).toBe(true);
    await runtime.handleMessage(
      id,
      JSON.stringify({
        from: id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
  };
  try {
    for (const id of ['held-a', 'held-b']) {
      await join(id);
      await runtime.handleMessage(
        id,
        JSON.stringify({
          protocol: 'authority:1',
          kind: 'checkpoint-request',
          requestId: id,
          generation: 'g',
        }),
      );
    }
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(runtime['scheduler'].accountedUsage()).toMatchObject({
      heavySlots: 2,
      heavyBytes: 512 * 1024 * 1024,
      heavyNodes: 16_000_000,
      streamSlots: 2,
      streamBytes: 48 * 1024 * 1024,
    });
    await join('waiting');
    await runtime.handleMessage(
      'waiting',
      JSON.stringify({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId: 'waiting',
        generation: 'g',
      }),
    );
    await join('unrelated');
    expect(head.mock.calls.some((call) => call[0].connectionId === 'unrelated')).toBe(true);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    releases[0]?.();
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(3));
    runtime.close();
    expect(runtime['scheduler'].accountedUsage().heavySlots).toBeGreaterThanOrEqual(1);
    expect(runtime.pinnedDefinitionId('held-b')).toBe('definition');
    releases[1]?.();
    await vi.waitFor(() => expect(runtime['scheduler'].accountedUsage().heavySlots).toBe(0));
    expect(runtime.pinnedDefinitionId('held-b')).toBeUndefined();
  } finally {
    releases.forEach((release) => release());
    runtime.close();
  }
});

it('bounds automatic checkpoint resets to two in sixty seconds', async () => {
  const cut = { generation: 'g', revision: 'cut' };
  const sent: string[] = [];
  const close = vi.fn();
  const connection: Connection = {
    id: 'resets',
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
  const driver = {
    head: async () => cut,
    readAfter: async () => ({ status: 'ok', head: cut, records: [] }),
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
    runtime.admit(connection, definition);
    await runtime.handleMessage(
      connection.id,
      JSON.stringify({
        from: connection.id,
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    runtime.activate(connection.id, cut, emptyAuthorityState);
    sent.length = 0;
    const peer = runtime['peers'].get(connection.id);
    if (!peer) throw new Error('missing peer');
    const recover = () => {
      runtime.activate(connection.id, cut, emptyAuthorityState);
      runtime['dispatchRecovery'](
        peer,
        'g',
        { deadlineAt: Date.now() + 5000, signal: peer.lifetime },
        { phase: 'live', streamToken: peer.streamToken },
      );
    };
    recover();
    recover();
    expect(sent.filter((message) => JSON.parse(message).kind === 'resync-required')).toHaveLength(
      2,
    );
    recover();
    expect(close).toHaveBeenCalledWith(1013);
    expect(sent.filter((message) => JSON.parse(message).kind === 'resync-required')).toHaveLength(
      2,
    );
  } finally {
    runtime.close();
  }
});

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

async function startResultBoundaryRuntime(
  driver: AuthorityDriver,
  localDefinition: AuthorityRoomDefinition = definition,
  resolveRoom: () => AuthorityRoomDefinition = () => localDefinition,
) {
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
      resolveRoom,
      resolveIdentity: () => ({ actorId: 'reader', ownershipId: 'reader' }),
    },
    new InMemoryHubFanout(),
    'boundary-worker',
  );
  expect(runtime.admit(connection, localDefinition)).toBe(true);
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
