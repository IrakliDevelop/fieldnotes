import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { createServer, type IncomingMessage } from 'http';
import { createImage } from '@fieldnotes/core';
import { createCurrentCapabilities } from '@fieldnotes/sync';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';

type Server = ReturnType<typeof createSyncServer>;

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

/**
 * Adversarial coverage for the relay's connection-level trust boundary: what a
 * hostile socket can do before and around authentication.
 */
describe('sync-server connection hardening (end-to-end)', () => {
  const servers: Server[] = [];
  const rawSockets: WsClient[] = [];

  function startServer(options: Omit<CreateSyncServerOptions, 'port'> = {}) {
    const server = createSyncServer({ port: 0, allowAnonymous: !options.authenticate, ...options });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, port };
  }

  function openRaw(
    port: string | number,
    query: string,
  ): Promise<{ code: number; reason: string }> {
    const socket = new WsClient(`ws://127.0.0.1:${port}?${query}`);
    rawSockets.push(socket);
    return new Promise((resolve) => {
      socket.on('close', (code, reason) => resolve({ code, reason: String(reason) }));
      socket.on('error', () => undefined);
    });
  }

  afterEach(async () => {
    for (const c of rawSockets) c.close();
    rawSockets.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  describe('authorize requires authenticate (TD-7)', () => {
    it('refuses to start with an authorize hook but no authenticate hook', () => {
      // Without authenticate, userId defaults to the per-socket connId, so an
      // ownership policy silently loses every element on reconnect.
      expect(() => createSyncServer({ port: 0, authorize: () => true })).toThrow(
        /authorize.*authenticate/,
      );
    });

    it('starts with authorize when authenticate is configured', async () => {
      const { server } = startServer({
        authenticate: () => ({ userId: 'u1' }),
        authorize: () => true,
      });
      expect(server.hub).toBeDefined();
    });

    it('still starts with only authenticate or only canRead (no authorize)', async () => {
      startServer({ authenticate: () => ({ userId: 'u1' }) });
      startServer({
        canRead: () => true,
        resolvePresenceAudience: () => undefined,
        canReadLayer: () => true,
      });
      expect(servers).toHaveLength(2);
    });
  });

  describe('identity startup guards', () => {
    it('refuses to start without authenticate or allowAnonymous', () => {
      expect(() => createSyncServer({ port: 0 })).toThrow(
        new Error(
          'createSyncServer: pass `authenticate`, or `allowAnonymous: true` to let anyone join any room',
        ),
      );
    });

    it('refuses allowAnonymous combined with authenticate', () => {
      expect(() =>
        createSyncServer({
          port: 0,
          authenticate: () => ({ userId: 'u1' }),
          allowAnonymous: true,
        }),
      ).toThrow(
        new Error('createSyncServer: `allowAnonymous` cannot be combined with `authenticate`'),
      );
    });

    it('starts with authenticate only', () => {
      const { server } = startServer({ authenticate: () => ({ userId: 'u1' }) });
      expect(server.hub).toBeDefined();
    });

    it('starts with allowAnonymous only', () => {
      const { server } = startServer({ allowAnonymous: true });
      expect(server.hub).toBeDefined();
    });

    it('refuses canRead without the presence and layer read hooks', () => {
      expect(() =>
        createSyncServer({ port: 0, allowAnonymous: true, canRead: () => true }),
      ).toThrow(/`canRead` requires `resolvePresenceAudience`/);
    });
  });

  describe('connection caps and byte budgets (S5)', () => {
    async function openAdmitted(port: number, room: string): Promise<WsClient> {
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=${room}`);
      rawSockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
      return socket;
    }

    it('caps concurrent connections per client address and frees the slot on close', async () => {
      const { port } = startServer({ maxConnectionsPerIp: 2 });
      const first = await openAdmitted(port, 'R');
      await openAdmitted(port, 'R2');

      const third = await openRaw(port, 'room=R');
      expect(third).toEqual({ code: 4429, reason: 'too many connections' });

      first.close();
      await new Promise<void>((resolve) => first.once('close', () => resolve()));
      const again = await openAdmitted(port, 'R');
      expect(again.readyState).toBe(WsClient.OPEN);
    });

    it('caps concurrent connections per room, counting sockets still pending auth', async () => {
      let release: (() => void) | undefined;
      const { server, port } = startServer({
        maxConnectionsPerRoom: 1,
        authenticate: () =>
          new Promise<{ userId: string }>((resolve) => {
            release = () => resolve({ userId: 'u' });
          }),
      });
      await openAdmitted(port, 'R');

      const second = await openRaw(port, 'room=R');
      expect(second).toEqual({ code: 4429, reason: 'too many connections' });
      // The cap is per room: another room is unaffected.
      await openAdmitted(port, 'R2');
      expect(server.hub.roomCount()).toBe(0); // still pending; capped before auth resolved
      release?.();
    });

    it('resolves the client address through clientAddress for proxied deployments', async () => {
      const { port } = startServer({
        maxConnectionsPerIp: 1,
        clientAddress: (req) => String(req.headers['x-forwarded-for'] ?? ''),
      });
      const open = (ip: string) => {
        const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`, {
          headers: { 'x-forwarded-for': ip },
        });
        rawSockets.push(socket);
        // The upgrade completes before the server closes a capped socket, so `open`
        // alone proves nothing: settle on close, or on staying open for a beat.
        return new Promise<number>((resolve) => {
          socket.once('open', () => setTimeout(() => resolve(0), 150));
          socket.once('close', (code) => resolve(code));
          socket.once('error', () => undefined);
        });
      };
      expect(await open('10.0.0.1')).toBe(0);
      expect(await open('10.0.0.2')).toBe(0);
      expect(await open('10.0.0.1')).toBe(4429);
    });

    it('closes a connection that exceeds its byte budget even within the frame budget', async () => {
      const { port } = startServer({
        bytesPerSecond: 100,
        byteBurst: 200,
        messagesPerSecond: 1000,
        messageBurst: 1000,
      });
      const socket = await openAdmitted(port, 'R');
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
      );
      socket.send('x'.repeat(150));
      socket.send('x'.repeat(150));

      expect(await closed).toEqual({ code: 4408, reason: 'rate limit exceeded' });
    });

    it.each([
      ['messagesPerSecond', { messagesPerSecond: Number.NaN }],
      ['messageBurst', { messageBurst: 0 }],
      ['bytesPerSecond', { bytesPerSecond: Number.POSITIVE_INFINITY }],
      ['byteBurst', { byteBurst: -1 }],
      ['maxConnectionsPerIp', { maxConnectionsPerIp: 1.5 }],
      ['maxConnectionsPerRoom', { maxConnectionsPerRoom: Number.NaN }],
      ['maxMessageBytes', { maxMessageBytes: 0 }],
      ['maxMessageBytes', { maxMessageBytes: Number.NaN }],
    ] as const)('refuses to start with an invalid %s limit', (_name, options) => {
      expect(() => createSyncServer({ allowAnonymous: true, port: 0, ...options })).toThrow(
        RangeError,
      );
    });

    it('accepts Infinity as the documented way to disable connection caps', () => {
      const { server } = startServer({
        maxConnectionsPerIp: Infinity,
        maxConnectionsPerRoom: Infinity,
      });

      expect(server.hub).toBeDefined();
    });

    it('accepts an unbounded maxMessageBytes', () => {
      const { server } = startServer({ maxMessageBytes: Infinity });

      expect(server.hub).toBeDefined();
    });
  });

  describe('image sources', () => {
    async function joinRoom(port: number, frames: string[]): Promise<WsClient> {
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
      rawSockets.push(socket);
      socket.on('message', (data) => frames.push(String(data)));
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      const capabilities = createCurrentCapabilities([]);
      socket.send(JSON.stringify({ from: 'c', op: { kind: 'capabilities', capabilities } }));
      await waitFor(() => frames.length > 0);
      frames.length = 0;
      return socket;
    }

    it('passes allowImageSrc through createSyncServer and refuses what it rejects', async () => {
      const allowImageSrc = vi.fn(({ src }: { src: string }) => src.startsWith('data:image/'));
      const { port } = startServer({
        authenticate: () => ({ userId: 'u1', role: 'dm' }),
        allowImageSrc,
      });
      const senderFrames: string[] = [];
      const peerFrames: string[] = [];
      const sender = await joinRoom(port, senderFrames);
      await joinRoom(port, peerFrames);
      const src = 'https://cdn.example/refused.png';
      const element = {
        ...createImage({ index: 'a0', position: { x: 0, y: 0 }, size: { w: 1, h: 1 }, src }),
        id: 'img',
      };

      sender.send(JSON.stringify({ from: 'c', op: { kind: 'upsert', element } }));
      await waitFor(() => senderFrames.length > 0);

      expect(allowImageSrc).toHaveBeenCalledWith({ src, userId: 'u1', role: 'dm', room: 'R' });
      expect(senderFrames.map((frame) => JSON.parse(frame) as unknown)).toEqual([
        { from: 'hub', op: { kind: 'remove', id: 'img', version: 1, editor: 'hub' } },
      ]);
      expect(peerFrames.join('')).not.toContain(src);
    });
  });

  describe('room names (S1)', () => {
    it.each([
      ['foo:layers', 'a Redis sub-key alias'],
      ['foo/bar', 'a path separator'],
      ['a b', 'whitespace'],
      ['x'.repeat(65), 'over 64 chars'],
      ['%00', 'a control byte'],
    ])('rejects room %j (%s) before authenticate runs', async (room) => {
      const authenticate = vi.fn(() => ({ userId: 'u1' }));
      const { server, port } = startServer({ authenticate });

      const closed = await openRaw(port, `room=${encodeURIComponent(room)}`);

      expect(closed.code).toBe(4400);
      expect(closed.reason).toBe('invalid room');
      expect(authenticate).not.toHaveBeenCalled();
      expect(server.hub.roomCount()).toBe(0);
    });

    it('admits rooms made of letters, digits, underscore and hyphen up to 64 chars', async () => {
      const authenticate = vi.fn(() => ({ userId: 'u1' }));
      const { server, port } = startServer({ authenticate });
      const room = `Room_1-${'z'.repeat(57)}`;
      expect(room).toHaveLength(64);

      const socket = new WsClient(`ws://127.0.0.1:${port}?room=${room}`);
      rawSockets.push(socket);
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      await waitFor(() => server.hub.roomCount() === 1);

      expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ room }));
    });
  });

  describe('allowed origins', () => {
    // Resolves 'open', or the HTTP status of a refused upgrade.
    function connect(port: number, origin?: string): Promise<'open' | number> {
      const socket = new WsClient(`ws://127.0.0.1:${port}?room=r`, origin ? { origin } : {});
      rawSockets.push(socket);
      return new Promise((resolve) => {
        socket.once('open', () => resolve('open'));
        socket.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        socket.on('error', () => undefined);
      });
    }

    it('refuses an unlisted origin with 403 before authenticate runs', async () => {
      const authenticate = vi.fn(() => ({ userId: 'u1' }));
      const { port } = startServer({ authenticate, allowedOrigins: ['https://app.example'] });

      expect(await connect(port, 'https://evil.example')).toBe(403);
      expect(authenticate).not.toHaveBeenCalled();
    });

    it('admits the listed origin and a request without an Origin header', async () => {
      const { port } = startServer({ allowedOrigins: ['https://app.example'] });

      expect(await connect(port, 'https://app.example')).toBe('open');
      expect(await connect(port)).toBe('open');
    });

    it('lets the function form decide from the origin and the request', async () => {
      const allowedOrigins = vi.fn(
        (origin: string, _req: IncomingMessage) => origin === 'https://app.example',
      );
      const { port } = startServer({ allowedOrigins });

      expect(await connect(port, 'https://app.example')).toBe('open');
      expect(await connect(port, 'https://evil.example')).toBe(403);
      expect(allowedOrigins).toHaveBeenCalledWith(
        'https://evil.example',
        expect.objectContaining({ url: '/?room=r' }),
      );
    });

    it('refuses with 403 when the function throws', async () => {
      const { port } = startServer({
        allowedOrigins: () => {
          throw new Error('boom');
        },
      });

      expect(await connect(port, 'https://app.example')).toBe(403);
    });

    it('admits any origin when the option is unset', async () => {
      const { port } = startServer();

      expect(await connect(port, 'https://evil.example')).toBe('open');
    });

    it('checks origins on a host-supplied HTTP server too', async () => {
      const http = createServer();
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
      const server = createSyncServer({
        server: http,
        allowAnonymous: true,
        allowedOrigins: ['https://app.example'],
      });
      servers.push(server);
      const { port } = http.address() as AddressInfo;

      try {
        expect(await connect(port, 'https://evil.example')).toBe(403);
        expect(await connect(port, 'https://app.example')).toBe('open');
      } finally {
        for (const c of rawSockets) c.close();
        await new Promise((resolve) => http.close(resolve));
      }
    });
  });
});
