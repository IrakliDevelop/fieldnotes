import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { SyncClient, WebSocketTransport, bearerSubprotocols } from '@fieldnotes/sync';
import { ElementStore, createShape } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import type { Authenticate } from './authenticate';
import type { AuthContext } from './auth-context';

type Server = ReturnType<typeof createSyncServer>;

interface ConnectedClient {
  store: ElementStore;
  client: SyncClient;
  transport: WebSocketTransport;
}

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('sync-server authentication (end-to-end)', () => {
  const servers: Server[] = [];
  const transports: WebSocketTransport[] = [];
  const rawSockets: WsClient[] = [];

  function startServer(
    authenticate: Authenticate,
    options: Omit<CreateSyncServerOptions, 'port' | 'authenticate'> = {},
  ) {
    const server = createSyncServer({ port: 0, authenticate, ...options });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, port };
  }

  function connect(port: number, room: string, query = ''): ConnectedClient {
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=${room}${query}`, {
      WebSocket: WsClient as unknown as typeof WebSocket,
    });
    transports.push(transport);
    const store = new ElementStore();
    const client = new SyncClient({ store, transport });
    client.start();
    return { store, client, transport };
  }

  afterEach(async () => {
    for (const t of transports) t.close();
    transports.length = 0;
    for (const c of rawSockets) c.close();
    rawSockets.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('accepts an authenticated connection and syncs normally', async () => {
    const { port } = startServer(() => ({ userId: 'u1', role: 'dm' }));
    const a = connect(port, 'R');
    const b = connect(port, 'R');

    a.store.add({
      ...createShape({ position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'e1',
    });

    await waitFor(() => b.store.getById('e1') !== undefined);
    expect(b.store.getById('e1')).toBeDefined();
  }, 10000);

  it('gives plugins an immutable copy of admitted claims', async () => {
    const claims = { campaign: { id: 'original', secret: 'private-sentinel' } };
    const seen: unknown[] = [];
    const frames: string[] = [];
    const { port } = startServer(() => ({ userId: 'u1', authContext: claims }), {
      plugins: [
        {
          name: 'claims',
          async process(op, context, next) {
            seen.push(context.authContext);
            return next(op, context);
          },
        },
      ],
    });
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    claims.campaign.id = 'changed';
    socket.send(
      JSON.stringify({
        from: 'forged',
        authContext: { campaign: { id: 'forged' } },
        op: { kind: 'clear' },
      }),
    );
    await waitFor(() => seen.length > 0);
    socket.send(JSON.stringify({ from: 'forged', op: { kind: 'request-snapshot' } }));
    await waitFor(() => frames.length > 0);
    expect(seen[0]).toEqual({ campaign: { id: 'original', secret: 'private-sentinel' } });
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.isFrozen((seen[0] as { campaign: object }).campaign)).toBe(true);
    expect(Object.isFrozen(claims)).toBe(false);
    expect(frames.join('')).not.toContain('private-sentinel');
    expect(frames.join('')).not.toContain('authContext');
  });

  it('closes an idle socket at its authentication deadline', async () => {
    const { port, server } = startServer(() => ({ userId: 'u1', expiresAt: Date.now() + 80 }), {
      heartbeatIntervalMs: 0,
    });
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    const code = await new Promise<number>((resolve) => socket.once('close', resolve));
    expect(code).toBe(4401);
    expect(server.hub.roomCount()).toBe(0);
  }, 10000);

  it('checks the deadline at inbound dispatch and every outbound send, even before the timer runs', async () => {
    const deadline = Date.now() + 60_000;
    const processed = vi.fn();
    const { port, server } = startServer(() => ({ userId: 'u1', expiresAt: deadline }), {
      heartbeatIntervalMs: 0,
      plugins: [
        {
          name: 'watch',
          async process(op, context, next) {
            processed();
            return next(op, context);
          },
        },
      ],
    });
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    const frames: string[] = [];
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    await waitFor(() => server.hub.roomCount() === 1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline);
    try {
      server.hub.broadcastPresence('R', { visible: false });
      socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
      const code = await new Promise<number>((resolve) => socket.once('close', resolve));
      expect(code).toBe(4401);
      expect(frames).toEqual([]);
      expect(processed).not.toHaveBeenCalled();
      expect(server.hub.roomCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects an inbound frame at the deadline before the idle timer callback', async () => {
    const deadline = Date.now() + 60_000;
    const { port, server } = startServer(() => ({ userId: 'u1', expiresAt: deadline }), {
      heartbeatIntervalMs: 0,
    });
    const dispatch = vi.spyOn(server.hub, 'handleMessage');
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    await waitFor(() => server.hub.roomCount() === 1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline);
    try {
      socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
      const code = await new Promise<number>((resolve) => socket.once('close', resolve));
      expect(code).toBe(4401);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('releases room and address slots after expiry', async () => {
    const { port, server } = startServer(() => ({ userId: 'u1', expiresAt: Date.now() + 70 }), {
      heartbeatIntervalMs: 0,
      maxConnectionsPerIp: 1,
      maxConnectionsPerRoom: 1,
    });
    const first = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(first);
    await new Promise<void>((resolve) => first.once('close', resolve));
    const second = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(second);
    await new Promise<void>((resolve) => second.once('open', resolve));
    await waitFor(() => server.hub.roomCount() === 1);
  }, 10000);

  it('chunks a distant expiry timer and clears it on ordinary close', async () => {
    const deadline = Date.now() + 2_147_483_647 + 60_000;
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { port } = startServer(() => ({ userId: 'u1', expiresAt: deadline }), {
        heartbeatIntervalMs: 0,
      });
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
      rawSockets.push(socket);
      await new Promise<void>((resolve) => socket.once('open', resolve));
      await waitFor(() => timer.mock.calls.some((call) => call[1] === 2_147_483_647));
      const expiryIndex = timer.mock.calls.findIndex((call) => call[1] === 2_147_483_647);
      const expiryHandle = timer.mock.results[expiryIndex]?.value;
      const callback = timer.mock.calls[expiryIndex]?.[0];
      expect(socket.readyState).toBe(WsClient.OPEN);
      clearTimeout(expiryHandle);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 60_000);
      try {
        callback?.();
        expect(timer.mock.calls.some((call) => call[1] === 60_000)).toBe(true);
      } finally {
        clock.mockRestore();
      }
      const nextExpiryIndex = timer.mock.calls.findIndex((call) => call[1] === 60_000);
      const nextExpiryHandle = timer.mock.results[nextExpiryIndex]?.value;
      socket.close();
      await new Promise<void>((resolve) => socket.once('close', resolve));
      expect(clearTimer).toHaveBeenCalledWith(nextExpiryHandle);
    } finally {
      timer.mockRestore();
      clearTimer.mockRestore();
    }
  });

  it('rejects expired asynchronous authentication before draining queued messages', async () => {
    let resolveAuth: (value: { userId: string; expiresAt: number }) => void = () => undefined;
    const pending = new Promise<{ userId: string; expiresAt: number }>((resolve) => {
      resolveAuth = resolve;
    });
    const process = vi.fn(async (op, context, next) => next(op, context));
    const { port, server } = startServer(() => pending, { plugins: [{ name: 'watch', process }] });
    const buffered = new Promise<void>((resolve) => {
      server.wss.once('connection', (ws) => ws.once('message', () => resolve()));
    });
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    await buffered;
    resolveAuth({ userId: 'u1', expiresAt: Date.now() - 1 });
    const code = await new Promise<number>((resolve) => socket.once('close', resolve));
    expect(code).toBe(4401);
    expect(server.hub.roomCount()).toBe(0);
    expect(process).not.toHaveBeenCalled();
  });

  it('checks each queued authentication message before hub dispatch', async () => {
    let resolveAuth: (value: { userId: string; expiresAt: number }) => void = () => undefined;
    const pending = new Promise<{ userId: string; expiresAt: number }>((resolve) => {
      resolveAuth = resolve;
    });
    const { port, server } = startServer(() => pending);
    const buffered = new Promise<void>((resolve) => {
      server.wss.once('connection', (ws) => {
        let count = 0;
        ws.on('message', () => {
          if (++count === 2) resolve();
        });
      });
    });
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(socket);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    socket.send(JSON.stringify({ from: 'x', op: { kind: 'clear' } }));
    await buffered;
    const deadline = Date.now() + 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 1);
    const dispatch = vi.spyOn(server.hub, 'handleMessage').mockImplementationOnce(async () => {
      clock.mockReturnValue(deadline);
    });
    try {
      resolveAuth({ userId: 'u1', expiresAt: deadline });
      const code = await new Promise<number>((resolve) => socket.once('close', resolve));
      expect(code).toBe(4401);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(server.hub.roomCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects malformed claims and deadlines before admission with a generic close', async () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterCalls++;
        return 'private-sentinel';
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const result of [
      { authContext: accessor },
      { authContext: cyclic },
      { expiresAt: 0 },
      { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const { port, server } = startServer(() => ({
        userId: 'u1',
        authContext: result.authContext as AuthContext | undefined,
        expiresAt: result.expiresAt,
      }));
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
      rawSockets.push(socket);
      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      });
      socket.once('open', () =>
        socket.send(JSON.stringify({ from: 'x', op: { kind: 'request-snapshot' } })),
      );
      expect(await closed).toEqual({ code: 4401, reason: 'unauthorized' });
      expect(server.hub.roomCount()).toBe(0);
    }
    expect(getterCalls).toBe(0);
  });

  it('clears an admitted deadline timer on server shutdown', async () => {
    const deadline = Date.now() + 60_000;
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { port, server } = startServer(() => ({ userId: 'u1', expiresAt: deadline }), {
        heartbeatIntervalMs: 0,
      });
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
      rawSockets.push(socket);
      await new Promise<void>((resolve) => socket.once('open', resolve));
      await waitFor(() => server.hub.roomCount() === 1);
      const expiryIndex = timer.mock.calls.findIndex((call) => call[0].name === 'scheduleExpiry');
      expect(expiryIndex).toBeGreaterThanOrEqual(0);
      const expiryHandle = timer.mock.results[expiryIndex]?.value;
      const socketClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      await server.close();
      await socketClosed;
      await waitFor(() => clearTimer.mock.calls.some((call) => call[0] === expiryHandle));
    } finally {
      timer.mockRestore();
      clearTimer.mockRestore();
    }
  });

  it('rejects with close code 4401 and never admits (no snapshot served)', async () => {
    const { port } = startServer(() => null);

    let closeCode = 0;
    let gotMessage = false;
    const c = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(c);
    c.on('close', (code) => {
      closeCode = code;
    });
    c.on('message', () => {
      gotMessage = true;
    });
    c.on('open', () => c.send(JSON.stringify({ from: 'x', op: { kind: 'request-snapshot' } })));

    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4401);
    // Discriminating: the connection is rejected BEFORE admission, so the queued
    // request-snapshot is dropped and no snapshot is ever sent. Without the
    // never-admit guarantee the hub would answer request-snapshot and gotMessage → true.
    expect(gotMessage).toBe(false);
  }, 10000);

  describe('bearer token outside the URL (S3)', () => {
    function openWith(
      port: number,
      init: { protocols?: string[]; headers?: Record<string, string>; query?: string },
    ) {
      const socket = new WsClient(
        `ws://127.0.0.1:${port}?room=R${init.query ?? ''}`,
        init.protocols ?? [],
        {
          headers: init.headers ?? {},
        },
      );
      rawSockets.push(socket);
      return new Promise<{ code: number; protocol: string }>((resolve) => {
        socket.once('open', () => resolve({ code: 0, protocol: socket.protocol }));
        socket.once('close', (code) => resolve({ code, protocol: socket.protocol }));
        socket.once('error', () => undefined);
      });
    }

    it('reads the token from a Sec-WebSocket-Protocol bearer entry and selects the sync subprotocol', async () => {
      const authenticate = vi.fn<Authenticate>(({ token }) =>
        token === 'good.tok' ? { userId: 'u1' } : null,
      );
      const { port } = startServer(authenticate);

      const result = await openWith(port, { protocols: bearerSubprotocols('good.tok') });

      expect(result).toEqual({ code: 0, protocol: 'fieldnotes-sync' });
      expect(authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ room: 'R', token: 'good.tok' }),
      );
      expect(authenticate.mock.calls[0]?.[0].req.url).not.toContain('good.tok');
    });

    it('reads the token from an Authorization: Bearer header', async () => {
      const authenticate = vi.fn<Authenticate>(({ token }) =>
        token === 'hdr' ? { userId: 'u1' } : null,
      );
      const { port } = startServer(authenticate);

      const result = await openWith(port, { headers: { authorization: 'Bearer hdr' } });

      expect(result.code).toBe(0);
      expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ token: 'hdr' }));
    });

    it('keeps the URL token working and lets the subprotocol take precedence over it', async () => {
      const seen: (string | undefined)[] = [];
      const { port } = startServer(({ token }) => {
        seen.push(token);
        return { userId: 'u1' };
      });

      await openWith(port, { query: '&token=urltok' });
      await openWith(port, { query: '&token=urltok', protocols: bearerSubprotocols('subtok') });

      expect(seen).toEqual(['urltok', 'subtok']);
    });

    it('still echoes a foreign subprotocol offered without a bearer entry', async () => {
      const { port } = startServer(() => ({ userId: 'u1' }));

      const result = await openWith(port, { protocols: ['my-app'] });

      expect(result).toEqual({ code: 0, protocol: 'my-app' });
    });

    it('never selects or echoes a bearer-only subprotocol offer', async () => {
      const { port } = startServer(() => ({ userId: 'u1' }));

      const result = await openWith(port, { protocols: ['fieldnotes-bearer.secret-token'] });

      expect(result).toEqual({ code: 1006, protocol: '' });
    });
  });

  it('accepts a good token and rejects a bad token', async () => {
    const { port } = startServer(({ req }) => {
      const t = new URL(req.url ?? '', 'http://x').searchParams.get('token');
      return t === 'good' ? { userId: 'u1' } : null;
    });

    const a = connect(port, 'R', '&token=good');
    const b = connect(port, 'R', '&token=good');
    a.store.add({
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
      id: 'ok1',
    });
    await waitFor(() => b.store.getById('ok1') !== undefined);
    expect(b.store.getById('ok1')).toBeDefined();

    let closeCode = 0;
    const bad = new WsClient(`ws://127.0.0.1:${port}?room=R&token=bad`);
    rawSockets.push(bad);
    bad.on('close', (code) => {
      closeCode = code;
    });
    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4401);
  }, 10000);

  it('replays a request-snapshot queued during async auth (the race)', async () => {
    const { port } = startServer(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { userId: 'u1' };
    });

    const a = connect(port, 'R');
    a.store.add({
      ...createShape({ position: { x: 7, y: 8 }, size: { w: 9, h: 9 } }),
      id: 'e1',
    });
    await waitFor(() => a.store.getById('e1') !== undefined);

    // B's SyncClient fires request-snapshot on socket-open, BEFORE B's 40ms auth
    // resolves. That message is queued during the pending window and replayed after
    // admission. Without the queue/replay it would be dropped and B never gets e1.
    const b = connect(port, 'R');
    await waitFor(() => b.store.getById('e1') !== undefined);
    expect(b.store.getById('e1')).toBeDefined();
  }, 10000);

  it('closes a connection whose pending-auth queue exceeds its byte budget', async () => {
    const { server, port } = startServer(() => new Promise(() => undefined), {
      maxPendingAuthBytes: 60,
      maxPendingAuthMessages: 100,
      messageBurst: 100,
    });
    const c = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(c);
    let closeCode = 0;
    c.on('close', (code) => {
      closeCode = code;
    });
    await new Promise<void>((resolve) => c.once('open', () => resolve()));
    c.send('x'.repeat(40));
    c.send('x'.repeat(40));

    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4408);
    expect(server.hub.roomCount()).toBe(0);
  });
});
