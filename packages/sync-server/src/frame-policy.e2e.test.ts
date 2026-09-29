import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { createSyncServer } from './create-sync-server';
import type { FrameAuthorizationContext } from './frame-policy';
import type { ServerOpContext } from './sync-plugin';
import { MemoryHubBackend } from './memory-hub-backend';

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('frame policy over real WebSockets', () => {
  const servers: ReturnType<typeof createSyncServer>[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    for (const server of servers) await server.close();
    servers.length = 0;
  });

  async function connect(
    port: number,
    room = 'R',
  ): Promise<{ socket: WebSocket; frames: string[] }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}?room=${room}`);
    sockets.push(socket);
    const frames: string[] = [];
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    return { socket, frames };
  }

  it('denies asynchronous inbound authorization before mutation and relay', async () => {
    let decide: ((allowed: boolean) => void) | undefined;
    const authorize = vi.fn(() => new Promise<boolean>((resolve) => (decide = resolve)));
    const server = createSyncServer({ port: 0, framePolicy: { authorize } });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    const sender = await connect(port);
    const receiver = await connect(port);
    sender.socket.send(JSON.stringify({ from: 'spoofed', op: { kind: 'clear' } }));
    await waitFor(() => decide !== undefined);
    decide?.(false);
    const code = await new Promise<number>((resolve) => sender.socket.once('close', resolve));
    expect(code).toBe(4403);
    expect(receiver.frames).toEqual([]);
    expect(await server.hub.roomCount()).toBe(1);
  });

  it('denies asynchronous outbound authorization before physical delivery', async () => {
    let decide: ((allowed: boolean) => void) | undefined;
    const authorize = vi.fn((context: { direction: string }) =>
      context.direction === 'outbound'
        ? new Promise<boolean>((resolve) => (decide = resolve))
        : true,
    );
    const server = createSyncServer({ port: 0, framePolicy: { authorize } });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    const recipient = await connect(port);
    await waitFor(() => server.hub.roomCount() === 1);
    expect(server.hub.broadcastPresence('R', { secret: 'forbidden' })).toBe(1);
    await waitFor(() => decide !== undefined);
    decide?.(false);
    const code = await new Promise<number>((resolve) => recipient.socket.once('close', resolve));
    expect(code).toBe(4403);
    expect(recipient.frames).toEqual([]);
  });

  it('uses frozen admitted claims and exact wire strings for every direction', async () => {
    const claims = { campaign: { id: 'original' } };
    const auth = { userId: 'admitted', role: 'dm', authContext: claims };
    const contexts: FrameAuthorizationContext[] = [];
    const plugins: ServerOpContext[] = [];
    const server = createSyncServer({
      port: 0,
      authenticate: () => auth,
      framePolicy: {
        authorize: (context) => {
          contexts.push(context);
          return true;
        },
      },
      plugins: [
        {
          name: 'capture',
          async process(op, context, next) {
            plugins.push(context);
            return next(op, context);
          },
        },
      ],
    });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    auth.userId = 'mutated';
    claims.campaign.id = 'mutated';
    const input = JSON.stringify({
      from: 'spoofed',
      authContext: { forged: true },
      op: { kind: 'clear' },
    });
    socket.send(input);
    await waitFor(() => plugins.length === 1);
    socket.send(JSON.stringify({ from: 'spoofed', op: { kind: 'request-snapshot' } }));
    await waitFor(() => frames.length > 0);
    const inbound = contexts.find(
      (context) => context.direction === 'inbound' && context.message === input,
    );
    const outbound = contexts.find((context) => context.direction === 'outbound');
    expect(inbound).toBeDefined();
    expect(outbound).toBeDefined();
    for (const context of [inbound, outbound]) {
      expect(Object.isFrozen(context)).toBe(true);
      expect(context).toMatchObject({
        connectionId: expect.any(String),
        room: 'R',
        userId: 'admitted',
        role: 'dm',
        authContext: { campaign: { id: 'original' } },
      });
      expect(Object.isFrozen(context?.authContext)).toBe(true);
    }
    expect(plugins[0]?.signal).toBe(inbound?.signal);
    expect(plugins[0]?.deadlineAt).toBe(inbound?.deadlineAt);
    expect(frames.join('')).not.toContain('authContext');
    expect(frames.join('')).not.toContain('deadlineAt');
    expect(frames.join('')).not.toContain('original');
  });

  it.each([
    { label: 'false', result: false, code: 4403, reason: 'forbidden' },
    { label: 'nonboolean', result: 'yes', code: 1013, reason: 'resync required' },
  ])('closes on $label policy results without delivering', async ({ result, code, reason }) => {
    const server = createSyncServer({
      port: 0,
      framePolicy: { authorize: () => result as boolean },
    });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.once('close', (actual, text) => resolve({ code: actual, reason: String(text) })),
    );
    server.hub.broadcastPresence('R', { secret: 'never-delivered' });
    expect(await closed).toEqual({ code, reason });
    expect(frames).toEqual([]);
  });

  it.each(['throw', 'reject'])(
    'closes generically on policy %s without leaking error details',
    async (mode) => {
      const server = createSyncServer({
        port: 0,
        framePolicy: {
          authorize: () => {
            if (mode === 'throw') throw new Error('private-sentinel');
            return Promise.reject(new Error('private-sentinel'));
          },
        },
      });
      servers.push(server);
      const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
      await waitFor(() => server.hub.roomCount() === 1);
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
      );
      socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
      expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
      expect(frames).toEqual([]);
    },
  );

  it('applies expiry after delayed outbound allow and before physical send', async () => {
    let release: (() => void) | undefined;
    let context: FrameAuthorizationContext | undefined;
    const expiresAt = Date.now() + 60_000;
    const server = createSyncServer({
      port: 0,
      authenticate: () => ({ userId: 'x', expiresAt }),
      framePolicy: {
        authorize: (value) => {
          context = value;
          return new Promise<boolean>((resolve) => (release = () => resolve(true)));
        },
      },
    });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    server.hub.broadcastPresence('R', { secret: 'not-delivered' });
    await waitFor(() => context !== undefined);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    try {
      release?.();
      expect(await closed).toBe(4401);
      expect(frames).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps accepted outbound frames FIFO while other recipients and rooms progress', async () => {
    let release: (() => void) | undefined;
    let blockedId: string | undefined;
    const server = createSyncServer({
      port: 0,
      framePolicy: {
        authorize: (context) => {
          if (context.direction !== 'outbound') return true;
          if (!blockedId) blockedId = context.connectionId;
          if (context.connectionId === blockedId && context.message.includes('first')) {
            return new Promise<boolean>((resolve) => (release = () => resolve(true)));
          }
          return true;
        },
      },
    });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    const slow = await connect(port);
    const fast = await connect(port);
    const otherRoom = await connect(port, 'S');
    await waitFor(() => server.hub.roomCount() === 2);
    server.hub.broadcastPresence('R', { label: 'first' });
    server.hub.broadcastPresence('R', { label: 'second' });
    server.hub.broadcastPresence('S', { label: 'other-room' });
    await waitFor(() => fast.frames.length === 2 && otherRoom.frames.length === 1);
    expect(slow.frames).toEqual([]);
    release?.();
    await waitFor(() => slow.frames.length === 2);
    expect(slow.frames.map((frame) => JSON.parse(frame).op.data.label)).toEqual([
      'first',
      'second',
    ]);
  });

  it('times out a hung inbound policy and ignores its late settlement', async () => {
    let resolvePolicy: ((value: boolean) => void) | undefined;
    let context: FrameAuthorizationContext | undefined;
    const process = vi.fn(async (op, opContext, next) => next(op, opContext));
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const server = createSyncServer({
        port: 0,
        framePolicy: {
          authorize: (value) => {
            context = value;
            return new Promise<boolean>((resolve) => (resolvePolicy = resolve));
          },
        },
        plugins: [{ name: 'watch', process }],
      });
      servers.push(server);
      const { socket } = await connect((server.wss.address() as AddressInfo).port);
      await waitFor(() => server.hub.roomCount() === 1);
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
      );
      socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
      await waitFor(() => context !== undefined);
      const deadlineAt = context?.deadlineAt ?? 0;
      const timeoutCall = timer.mock.calls.find(
        (call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000,
      );
      expect(timeoutCall).toBeDefined();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt);
      try {
        timeoutCall?.[0]();
      } finally {
        clock.mockRestore();
      }
      expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
      expect(context?.signal.aborted).toBe(true);
      resolvePolicy?.(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(process).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  it('absorbs a policy rejection after timeout without starting late work', async () => {
    let rejectPolicy: ((error: Error) => void) | undefined;
    let context: FrameAuthorizationContext | undefined;
    const process = vi.fn(async (op, opContext, next) => next(op, opContext));
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const server = createSyncServer({
        port: 0,
        framePolicy: {
          authorize: (value) => {
            context = value;
            return new Promise<boolean>((_resolve, reject) => (rejectPolicy = reject));
          },
        },
        plugins: [{ name: 'watch', process }],
      });
      servers.push(server);
      const { socket } = await connect((server.wss.address() as AddressInfo).port);
      await waitFor(() => server.hub.roomCount() === 1);
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
      );
      socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
      await waitFor(() => context !== undefined);
      const timeoutCall = timer.mock.calls.find(
        (call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000,
      );
      expect(timeoutCall).toBeDefined();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(context?.deadlineAt ?? 0);
      try {
        timeoutCall?.[0]();
      } finally {
        clock.mockRestore();
      }
      expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
      rejectPolicy?.(new Error('private-sentinel'));
      await new Promise((resolve) => setImmediate(resolve));
      expect(context?.signal.aborted).toBe(true);
      expect(process).not.toHaveBeenCalled();
      expect(server.hub.roomCount()).toBe(0);
    } finally {
      timer.mockRestore();
    }
  });

  it('keeps the same room lane occupied by active backend work after disconnect', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered: string[] = [];
    let first = true;
    const backend = new MemoryHubBackend();
    const server = createSyncServer({
      port: 0,
      backend,
      framePolicy: {},
      plugins: [
        {
          name: 'block',
          async process(op, context, next) {
            entered.push(context.connectionId);
            if (first) {
              first = false;
              await gate;
            }
            return next(op, context);
          },
        },
      ],
    });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    const old = await connect(port);
    await waitFor(() => server.hub.roomCount() === 1);
    old.socket.send(JSON.stringify({ from: 'old', op: { kind: 'clear' } }));
    await waitFor(() => entered.length === 1);
    old.socket.terminate();
    await waitFor(() => server.hub.roomCount() === 0);
    const fresh = await connect(port);
    await waitFor(() => server.hub.roomCount() === 1);
    fresh.socket.send(JSON.stringify({ from: 'fresh', op: { kind: 'clear' } }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(entered).toHaveLength(1);
    release?.();
    await waitFor(() => entered.length === 2);
    expect(entered[1]).not.toBe(entered[0]);
  });

  it('unlinks repeated expired reconnects behind a hung guard while retaining its room reservation', async () => {
    let settleFirst: ((allowed: boolean) => void) | undefined;
    let first = true;
    const entered: string[] = [];
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const server = createSyncServer({
        port: 0,
        framePolicy: {
          authorize: (context) => {
            entered.push(context.connectionId);
            if (first) {
              first = false;
              return new Promise<boolean>((resolve) => (settleFirst = resolve));
            }
            return true;
          },
        },
        messageBurst: 1000,
        byteBurst: 10_000_000,
      });
      servers.push(server);
      let received = 0;
      server.wss.on('connection', (peer) => peer.on('message', () => received++));
      const port = (server.wss.address() as AddressInfo).port;
      const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
      const original = await connect(port);
      await waitFor(() => server.hub.roomCount() === 1);
      original.socket.send(frame);
      await waitFor(() => entered.length === 1);
      original.socket.terminate();
      await waitFor(() => server.hub.roomCount() === 0);

      for (let index = 0; index < 3; index++) {
        const reconnect = await connect(port);
        await waitFor(() => server.hub.roomCount() === 1);
        const priorTimers = timer.mock.calls.length;
        const closeCode = new Promise<number>((resolve) => reconnect.socket.once('close', resolve));
        reconnect.socket.send(frame);
        await waitFor(() => received === index + 2);
        const timeoutCall = timer.mock.calls
          .slice(priorTimers)
          .find((call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000);
        expect(timeoutCall).toBeDefined();
        timeoutCall?.[0]();
        expect(await closeCode).toBe(1013);
        expect(entered).toHaveLength(1);
        expect(server.hub.roomCount()).toBe(0);
      }

      const counts = [64, 64, 64, 63];
      let filled = 0;
      for (const count of counts) {
        const filler = await connect(port);
        for (let index = 0; index < count; index++) filler.socket.send(frame);
        filled += count;
        await waitFor(() => received === 4 + filled);
      }
      expect(entered).toHaveLength(1);
      const overflow = await connect(port);
      const overflowCode = new Promise<number>((resolve) => overflow.socket.once('close', resolve));
      overflow.socket.send(frame);
      expect(await overflowCode).toBe(1013); // 255 queued + the disconnected active frame
      settleFirst?.(true);
      await waitFor(() => entered.length > 1);
    } finally {
      timer.mockRestore();
    }
  });

  it('enforces the fixed 64-frame connection limit including active and queued inbound work', async () => {
    const server = createSyncServer({
      port: 0,
      framePolicy: { authorize: () => new Promise<boolean>(() => undefined) },
      messageBurst: 1000,
      bytesPerSecond: 10_000_000,
      byteBurst: 10_000_000,
    });
    servers.push(server);
    const { socket } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
    );
    const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
    for (let index = 0; index < 65; index++) socket.send(frame);
    expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
    expect(server.hub.roomCount()).toBe(0);
  });

  it('enforces the fixed 256-frame room limit across connections', async () => {
    const server = createSyncServer({
      port: 0,
      framePolicy: { authorize: () => new Promise<boolean>(() => undefined) },
      messageBurst: 1000,
      byteBurst: 10_000_000,
    });
    servers.push(server);
    let received = 0;
    server.wss.on('connection', (peer) => peer.on('message', () => received++));
    const port = (server.wss.address() as AddressInfo).port;
    const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
    for (let peer = 0; peer < 4; peer++) {
      const { socket } = await connect(port);
      await waitFor(() => server.hub.roomCount() === 1);
      for (let index = 0; index < 64; index++) socket.send(frame);
      await waitFor(() => received === (peer + 1) * 64);
    }
    const extra = await connect(port);
    const closed = new Promise<number>((resolve) => extra.socket.once('close', resolve));
    extra.socket.send(frame);
    expect(await closed).toBe(1013);
  });

  it("releases a rejected peer's queued capacity before leave fanout to healthy peers", async () => {
    let block = false;
    const server = createSyncServer({
      port: 0,
      framePolicy: {
        authorize: (context) =>
          block && context.direction === 'inbound' ? new Promise<boolean>(() => undefined) : true,
      },
      presenceThrottleMs: 0,
      messageBurst: 1000,
      byteBurst: 10_000_000,
    });
    servers.push(server);
    let received = 0;
    server.wss.on('connection', (peer) => peer.on('message', () => received++));
    const port = (server.wss.address() as AddressInfo).port;
    const peers: Awaited<ReturnType<typeof connect>>[] = [];
    for (let index = 0; index < 6; index++) peers.push(await connect(port));
    await waitFor(() => server.hub.roomCount() === 1);
    const offender = peers[0];
    expect(offender).toBeDefined();
    if (!offender) return;
    offender.socket.send(
      JSON.stringify({ from: 'x', op: { kind: 'presence', data: { label: 'joined' } } }),
    );
    await waitFor(() => peers.slice(1).every((peer) => peer.frames.length === 1));
    block = true;
    const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
    const counts = [64, 63, 63, 63, 3, 0];
    for (const [peerIndex, peer] of peers.entries()) {
      for (let index = 0; index < (counts[peerIndex] ?? 0); index++) peer.socket.send(frame);
    }
    await waitFor(() => received === 257);
    const closed = new Promise<number>((resolve) => offender.socket.once('close', resolve));
    offender.socket.send(frame);
    expect(await closed).toBe(1013);
    await waitFor(() => peers.slice(1).every((peer) => peer.frames.length === 2));
    expect(peers.slice(1).every((peer) => peer.socket.readyState === WebSocket.OPEN)).toBe(true);
  });

  it('enforces exact 4 MiB per-connection bytes for multiframe input', async () => {
    const server = createSyncServer({
      port: 0,
      maxMessageBytes: 2 * 1024 * 1024,
      framePolicy: { authorize: () => new Promise<boolean>(() => undefined) },
      messageBurst: 1000,
      byteBurst: 10_000_000,
    });
    servers.push(server);
    let received = 0;
    server.wss.on('connection', (peer) => peer.on('message', () => received++));
    const { socket } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const base = JSON.stringify({ from: 'x', op: { kind: 'clear' }, padding: '' });
    const frame = JSON.stringify({
      from: 'x',
      op: { kind: 'clear' },
      padding: 'x'.repeat(1024 * 1024 - Buffer.byteLength(base)),
    });
    expect(Buffer.byteLength(frame)).toBe(1024 * 1024);
    for (let index = 0; index < 4; index++) socket.send(frame);
    await waitFor(() => received === 4);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    expect(await closed).toBe(1013);
  });

  it('rejects an oversized final encoded outbound snapshot before ws.send', async () => {
    const server = createSyncServer({
      port: 0,
      framePolicy: {},
      plugins: [
        {
          name: 'large-snapshot',
          async snapshot() {
            return {
              pluginName: 'large-snapshot',
              version: 1,
              data: { value: 'x'.repeat(4 * 1024 * 1024) },
            };
          },
        },
      ],
    });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
    );
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'request-snapshot' } }));
    expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
    expect(frames).toEqual([]);
  });

  it('enforces exact 16 MiB room bytes across four connections', async () => {
    const server = createSyncServer({
      port: 0,
      maxMessageBytes: 2 * 1024 * 1024,
      framePolicy: { authorize: () => new Promise<boolean>(() => undefined) },
      messageBurst: 1000,
      byteBurst: 10_000_000,
    });
    servers.push(server);
    let received = 0;
    server.wss.on('connection', (peer) => peer.on('message', () => received++));
    const port = (server.wss.address() as AddressInfo).port;
    const base = JSON.stringify({ from: 'x', op: { kind: 'clear' }, padding: '' });
    const frame = JSON.stringify({
      from: 'x',
      op: { kind: 'clear' },
      padding: 'x'.repeat(1024 * 1024 - Buffer.byteLength(base)),
    });
    for (let peer = 0; peer < 4; peer++) {
      const { socket } = await connect(port);
      for (let index = 0; index < 4; index++) socket.send(frame);
      await waitFor(() => received === (peer + 1) * 4);
    }
    const extra = await connect(port);
    const closed = new Promise<number>((resolve) => extra.socket.once('close', resolve));
    extra.socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    expect(await closed).toBe(1013);
  });

  it('shares the 64-frame connection budget across inbound and outbound work', async () => {
    const server = createSyncServer({
      port: 0,
      framePolicy: { authorize: () => new Promise<boolean>(() => undefined) },
      messageBurst: 1000,
    });
    servers.push(server);
    let received = 0;
    server.wss.on('connection', (peer) => peer.on('message', () => received++));
    const { socket } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    expect(server.hub.broadcastPresence('R', { label: 'outbound' })).toBe(1);
    const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
    for (let index = 0; index < 63; index++) socket.send(frame);
    await waitFor(() => received === 63);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(frame);
    expect(await closed).toBe(1013);
  });

  it('holds outbound capacity until the actual ws.send callback settles', async () => {
    const server = createSyncServer({ port: 0, framePolicy: {} });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const peer = [...server.wss.clients][0];
    expect(peer).toBeDefined();
    if (!peer) return;
    const actualSend = peer.send.bind(peer);
    let finishFirst: (() => void) | undefined;
    let first = true;
    peer.send = ((message: string, callback?: (error?: Error) => void) => {
      if (first) {
        first = false;
        finishFirst = () => callback?.();
        return;
      }
      actualSend(message, callback);
    }) as typeof peer.send;
    for (let index = 0; index < 64; index++) {
      expect(server.hub.broadcastPresence('R', { index })).toBe(1);
    }
    await waitFor(() => finishFirst !== undefined);
    expect(frames).toEqual([]);
    finishFirst?.();
    await waitFor(() => frames.length === 63);
    expect(server.hub.broadcastPresence('R', { after: true })).toBe(1);
    await waitFor(() => frames.length === 64);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with a generic reason on ws.send callback error', async () => {
    const server = createSyncServer({ port: 0, framePolicy: {} });
    servers.push(server);
    const { socket, frames } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const peer = [...server.wss.clients][0];
    expect(peer).toBeDefined();
    if (!peer) return;
    peer.send = ((_message: string, callback?: (error?: Error) => void) => {
      callback?.(new Error('private-sentinel'));
    }) as typeof peer.send;
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
    );
    expect(server.hub.broadcastPresence('R', { secret: 'private-sentinel' })).toBe(1);
    expect(await closed).toEqual({ code: 1013, reason: 'resync required' });
    expect(frames).toEqual([]);
  });

  it('aborts guarded work at server.close entry and respects shutdown grace', async () => {
    let context: FrameAuthorizationContext | undefined;
    const server = createSyncServer({
      port: 0,
      shutdownGraceMs: 20,
      framePolicy: {
        authorize: (value) => {
          context = value;
          return new Promise<boolean>(() => undefined);
        },
      },
    });
    servers.push(server);
    const { socket } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    await waitFor(() => context !== undefined);
    const started = Date.now();
    const closing = server.close();
    expect(context?.signal.aborted).toBe(true);
    expect(server.hub.roomCount()).toBe(0);
    await closing;
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('disposes guarded jobs immediately on rate rejection even if close is delayed', async () => {
    let context: FrameAuthorizationContext | undefined;
    const server = createSyncServer({
      port: 0,
      messageBurst: 1,
      framePolicy: {
        authorize: (value) => {
          context = value;
          return new Promise<boolean>(() => undefined);
        },
      },
    });
    servers.push(server);
    const { socket } = await connect((server.wss.address() as AddressInfo).port);
    await waitFor(() => server.hub.roomCount() === 1);
    const peer = [...server.wss.clients][0];
    expect(peer).toBeDefined();
    if (!peer) return;
    const actualClose = peer.close.bind(peer);
    let requested: [number | undefined, string | undefined] | undefined;
    peer.close = ((code?: number, reason?: string) => {
      requested = [code, reason];
    }) as typeof peer.close;
    const frame = JSON.stringify({ from: 'x', op: { kind: 'clear' } });
    socket.send(frame);
    await waitFor(() => context !== undefined);
    socket.send(frame);
    await waitFor(() => requested !== undefined);
    expect(requested).toEqual([4408, 'rate limit exceeded']);
    expect(context?.signal.aborted).toBe(true);
    expect(server.hub.roomCount()).toBe(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    peer.close = actualClose;
    actualClose(4408, 'rate limit exceeded');
  });

  it('rejects invalid policy objects before a socket server is opened', () => {
    for (const framePolicy of [null, [], new Date(), { authorize: 'yes' }]) {
      expect(() => createSyncServer({ port: 0, framePolicy: framePolicy as never })).toThrow();
    }
  });
});
