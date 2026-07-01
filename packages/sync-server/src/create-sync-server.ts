import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { SyncHub } from './sync-hub';
import type { HubBackend } from './hub-backend';
import type { HubFanout } from './hub-fanout';
import type { Authenticate } from './authenticate';
import type { Authorize } from './authorize';

export interface CreateSyncServerOptions {
  port?: number;
  server?: Server;
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authenticate?: Authenticate;
  authorize?: Authorize;
}

export function createSyncServer(options: CreateSyncServerOptions = {}): {
  hub: SyncHub;
  wss: WebSocketServer;
  close: () => Promise<void>;
} {
  const hub = new SyncHub({
    backend: options.backend,
    fanout: options.fanout,
    instanceId: options.instanceId,
    authorize: options.authorize,
  });
  const wss = options.server
    ? new WebSocketServer({ server: options.server })
    : new WebSocketServer({ port: options.port ?? 0 });
  let counter = 0;
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const room = url.searchParams.get('room');
    if (!room) {
      ws.close(1008, 'room required');
      return;
    }
    const connId = `c${++counter}-${Math.random().toString(36).slice(2, 8)}`;

    let state: 'pending' | 'ready' | 'rejected' = 'pending';
    let closed = false;
    const queue: string[] = [];
    const MAX_QUEUE = 100;

    const send = (m: string) => {
      try {
        ws.send(m);
      } catch {
        /* socket closed mid-send */
      }
    };

    ws.on('message', (data) => {
      const msg = String(data);
      if (state === 'rejected') return;
      if (state === 'pending') {
        if (queue.length < MAX_QUEUE) queue.push(msg);
        return;
      }
      void hub.handleMessage(connId, msg).catch((err) => console.error('[sync-server]', err));
    });
    ws.on('close', () => {
      closed = true;
      if (state === 'ready') hub.removeConnection(connId);
    });

    Promise.resolve(options.authenticate ? options.authenticate({ req, room }) : { userId: connId })
      .then((result) => {
        if (closed) return;
        if (!result) {
          state = 'rejected';
          ws.close(4401, 'unauthorized');
          return;
        }
        state = 'ready';
        hub.addConnection({ id: connId, room, userId: result.userId, role: result.role, send });
        for (const m of queue) {
          void hub.handleMessage(connId, m).catch((err) => console.error('[sync-server]', err));
        }
        queue.length = 0;
      })
      .catch(() => {
        if (!closed) {
          state = 'rejected';
          ws.close(4401, 'unauthorized');
        }
      });
  });
  return {
    hub,
    wss,
    close: () =>
      new Promise<void>((resolve) => {
        hub.close();
        wss.close(() => resolve());
      }),
  };
}
