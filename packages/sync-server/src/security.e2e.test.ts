import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
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
    const server = createSyncServer({ port: 0, ...options });
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
      startServer({ canRead: () => true });
      expect(servers).toHaveLength(2);
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
});
