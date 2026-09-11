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
