import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { SyncHub } from './sync-hub';
import type { HubBackend } from './hub-backend';
import type { HubFanout } from './hub-fanout';

export interface CreateSyncServerOptions {
  port?: number;
  server?: Server;
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
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
    hub.addConnection({
      id: connId,
      room,
      send: (m) => {
        try {
          ws.send(m);
        } catch {
          /* socket closed mid-send */
        }
      },
    });
    ws.on('message', (data) => {
      void hub
        .handleMessage(connId, String(data))
        .catch((err) => console.error('[sync-server]', err));
    });
    ws.on('close', () => hub.removeConnection(connId));
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
