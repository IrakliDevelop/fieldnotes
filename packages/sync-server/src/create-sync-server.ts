import { WebSocketServer, type RawData } from 'ws';
import type { Server } from 'http';
import { SyncHub } from './sync-hub';
import type { HubBackend } from './hub-backend';
import type { HubFanout } from './hub-fanout';
import type { Authenticate } from './authenticate';
import type { Authorize, AuthorizeLayer, CanRead } from './authorize';
import { startHeartbeat } from './heartbeat';
import {
  DEFAULT_MAX_JSON_DEPTH,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_PENDING_AUTH_BYTES,
  DEFAULT_MAX_PENDING_AUTH_MESSAGES,
  DEFAULT_MESSAGE_BURST,
  DEFAULT_MESSAGES_PER_SECOND,
  DEFAULT_PRESENCE_THROTTLE_MS,
  MessageRateLimiter,
} from './resource-limits';
import { DEFAULT_SHUTDOWN_GRACE_MS, drainWebSocketServer } from './shutdown';

export interface CreateSyncServerOptions {
  port?: number;
  server?: Server;
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authenticate?: Authenticate;
  authorize?: Authorize;
  authorizeLayer?: AuthorizeLayer;
  canRead?: CanRead;
  heartbeatIntervalMs?: number;
  maxMessageBytes?: number;
  maxJsonDepth?: number;
  maxPendingAuthMessages?: number;
  maxPendingAuthBytes?: number;
  messagesPerSecond?: number;
  messageBurst?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
  shutdownGraceMs?: number;
}

function rawDataByteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

export function createSyncServer(options: CreateSyncServerOptions = {}): {
  hub: SyncHub;
  wss: WebSocketServer;
  close: () => Promise<void>;
} {
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  if (!Number.isFinite(shutdownGraceMs) || shutdownGraceMs < 0) {
    throw new RangeError('shutdownGraceMs must be a non-negative finite number');
  }
  const hub = new SyncHub({
    backend: options.backend,
    fanout: options.fanout,
    instanceId: options.instanceId,
    authorize: options.authorize,
    authorizeLayer: options.authorizeLayer,
    canRead: options.canRead,
    maxJsonDepth: options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH,
    presenceThrottleMs: options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS,
    maxPresenceLanes: options.maxPresenceLanes,
  });
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const wss = options.server
    ? new WebSocketServer({ server: options.server, maxPayload: maxMessageBytes })
    : new WebSocketServer({ port: options.port ?? 0, maxPayload: maxMessageBytes });
  const heartbeat = startHeartbeat(wss, options.heartbeatIntervalMs ?? 30000);
  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;
  let counter = 0;
  wss.on('connection', (ws, req) => {
    if (shuttingDown) {
      ws.close(1001, 'server shutting down');
      return;
    }
    heartbeat.track(ws);
    // Protocol/parser failures (including maxPayload) close the peer. Consuming the socket-level
    // error keeps hostile input from becoming an uncaught process error.
    ws.on('error', () => undefined);
    const url = new URL(req.url ?? '', 'http://localhost');
    const room = url.searchParams.get('room');
    if (!room) {
      ws.close(4400, 'room required');
      return;
    }
    const connId = `c${++counter}-${Math.random().toString(36).slice(2, 8)}`;

    let state: 'pending' | 'ready' | 'rejected' = 'pending';
    let closed = false;
    let admitted = false;
    const queue: string[] = [];
    let queuedBytes = 0;
    const maxPendingAuthMessages =
      options.maxPendingAuthMessages ?? DEFAULT_MAX_PENDING_AUTH_MESSAGES;
    const maxPendingAuthBytes = options.maxPendingAuthBytes ?? DEFAULT_MAX_PENDING_AUTH_BYTES;
    const limiter = new MessageRateLimiter(
      options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND,
      options.messageBurst ?? DEFAULT_MESSAGE_BURST,
    );

    const send = (m: string) => {
      try {
        ws.send(m);
      } catch {
        /* socket closed mid-send */
      }
    };

    ws.on('message', (data) => {
      if (state === 'rejected') return;
      const messageBytes = rawDataByteLength(data);
      if (messageBytes > maxMessageBytes) {
        state = 'rejected';
        ws.close(1009, 'message too large');
        return;
      }
      if (!limiter.take()) {
        state = 'rejected';
        ws.close(4408, 'rate limit exceeded');
        return;
      }
      const msg = String(data);
      if (state === 'pending') {
        if (
          queue.length >= maxPendingAuthMessages ||
          queuedBytes + messageBytes > maxPendingAuthBytes
        ) {
          state = 'rejected';
          ws.close(4408, 'authentication queue limit exceeded');
          return;
        }
        queue.push(msg);
        queuedBytes += messageBytes;
        return;
      }
      void hub.handleMessage(connId, msg).catch((err) => console.error('[sync-server]', err));
    });
    ws.on('close', () => {
      closed = true;
      if (admitted) hub.removeConnection(connId);
    });

    Promise.resolve(options.authenticate ? options.authenticate({ req, room }) : { userId: connId })
      .then((result) => {
        if (closed || state === 'rejected' || shuttingDown) return;
        if (!result) {
          state = 'rejected';
          ws.close(4401, 'unauthorized');
          return;
        }
        state = 'ready';
        admitted = true;
        hub.addConnection({ id: connId, room, userId: result.userId, role: result.role, send });
        for (const m of queue) {
          void hub.handleMessage(connId, m).catch((err) => console.error('[sync-server]', err));
        }
        queue.length = 0;
        queuedBytes = 0;
      })
      .catch(() => {
        if (!closed && !shuttingDown) {
          state = 'rejected';
          ws.close(4401, 'unauthorized');
        }
      });
  });
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    shuttingDown = true;
    closePromise = drainWebSocketServer(wss, shutdownGraceMs).then(() => {
      heartbeat.stop();
      hub.close();
    });
    return closePromise;
  };

  return {
    hub,
    wss,
    close,
  };
}
