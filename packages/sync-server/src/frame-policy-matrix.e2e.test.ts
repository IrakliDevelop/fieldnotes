import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { createCurrentCapabilities } from '@fieldnotes/sync';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import { InMemoryHubFanout } from './hub-fanout';

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 1000) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('outbound application frame policy paths', () => {
  const servers: ReturnType<typeof createSyncServer>[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    for (const server of servers) await server.close();
    servers.length = 0;
  });

  function start(options: Omit<CreateSyncServerOptions, 'port'>) {
    const server = createSyncServer({
      port: 0,
      authenticate: ({ req }) => ({
        userId: new URL(req.url ?? '', 'http://localhost').searchParams.get('user') ?? 'unknown',
      }),
      ...options,
    });
    servers.push(server);
    return { server, port: (server.wss.address() as AddressInfo).port };
  }

  async function connect(port: number, user: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}?room=R&user=${user}`);
    sockets.push(socket);
    const frames: string[] = [];
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    return { socket, frames };
  }

  function frame(op: Record<string, unknown>): string {
    return JSON.stringify({ from: 'forged', op });
  }

  function closed(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => socket.once('close', resolve));
  }

  it.each(['capabilities', 'snapshot'])('denies %s output before delivery', async (kind) => {
    const { server, port } = start({
      framePolicy: { authorize: ({ direction }) => direction !== 'outbound' },
    });
    const target = await connect(port, 'target');
    await waitFor(() => server.hub.roomCount() === 1);
    const closeCode = closed(target.socket);
    target.socket.send(
      kind === 'capabilities'
        ? frame({ kind, capabilities: createCurrentCapabilities([]) })
        : frame({ kind: 'request-snapshot' }),
    );
    expect(await closeCode).toBe(4403);
    expect(target.frames).toEqual([]);
  });

  it.each(['core', 'layer', 'presence'])(
    'denies %s relay output to one recipient',
    async (kind) => {
      const { server, port } = start({
        framePolicy: {
          authorize: ({ direction, userId }) => direction !== 'outbound' || userId !== 'target',
        },
      });
      const sender = await connect(port, 'sender');
      const target = await connect(port, 'target');
      await waitFor(() => server.hub.roomCount() === 1);
      const closeCode = closed(target.socket);
      if (kind === 'core') sender.socket.send(frame({ kind: 'clear' }));
      else if (kind === 'layer')
        sender.socket.send(
          frame({
            kind: 'layer-upsert',
            layer: { id: 'L', name: 'L', visible: true, locked: false, order: 0, opacity: 1 },
            version: 1,
            editor: 'sender',
          }),
        );
      else server.hub.broadcastPresence('R', { label: 'denied' });
      expect(await closeCode).toBe(4403);
      expect(target.frames).toEqual([]);
      expect(sender.socket.readyState).toBe(WebSocket.OPEN);
    },
  );

  it.each(['correction', 'broadcast'])('denies plugin %s output', async (kind) => {
    const targetUser = kind === 'correction' ? 'sender' : 'target';
    const { server, port } = start({
      framePolicy: {
        authorize: ({ direction, userId, message }) =>
          direction !== 'outbound' || userId !== targetUser || !message.includes(kind),
      },
      plugins: [
        {
          name: 'output',
          async process() {
            return kind === 'correction'
              ? { accepted: null, corrections: [{ kind: 'remove', id: 'correction' }] }
              : {
                  accepted: null,
                  corrections: [],
                  broadcast: [{ kind: 'remove', id: 'broadcast' }],
                };
          },
        },
      ],
    });
    const sender = await connect(port, 'sender');
    const target = await connect(port, 'target');
    await waitFor(() => server.hub.roomCount() === 1);
    const denied = kind === 'correction' ? sender : target;
    const closeCode = closed(denied.socket);
    sender.socket.send(frame({ kind: 'clear' }));
    expect(await closeCode).toBe(4403);
    expect(denied.frames).toEqual([]);
  });

  it('denies a presence-leave frame after allowing initial presence', async () => {
    const { server, port } = start({
      framePolicy: {
        authorize: ({ direction, userId, message }) =>
          direction !== 'outbound' || userId !== 'target' || !message.includes('presence-leave'),
      },
    });
    const sender = await connect(port, 'sender');
    const target = await connect(port, 'target');
    await waitFor(() => server.hub.roomCount() === 1);
    sender.socket.send(frame({ kind: 'presence', data: { label: 'joined' } }));
    await waitFor(() => target.frames.length === 1);
    const closeCode = closed(target.socket);
    sender.socket.close();
    expect(await closeCode).toBe(4403);
    expect(target.frames).toHaveLength(1);
    expect(target.frames[0]).not.toContain('presence-leave');
  });

  it('denies received cross-instance fanout output', async () => {
    const bus = new InMemoryHubFanout();
    const { server, port } = start({
      fanout: bus,
      framePolicy: { authorize: ({ direction }) => direction !== 'outbound' },
    });
    const target = await connect(port, 'target');
    await waitFor(() => server.hub.roomCount() === 1);
    const closeCode = closed(target.socket);
    bus.publish(
      JSON.stringify({
        o: 'remote-instance',
        room: 'R',
        from: 'remote',
        op: { kind: 'presence', data: { secret: 'never-delivered' } },
      }),
    );
    expect(await closeCode).toBe(4403);
    expect(target.frames).toEqual([]);
  });
});
