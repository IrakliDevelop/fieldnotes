import { WebSocketServer, type RawData } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { SyncHub } from './sync-hub';
import type { HubBackend } from './hub-backend';
import type { HubFanout } from './hub-fanout';
import { readBearerToken, type Authenticate } from './authenticate';
import type {
  Authorize,
  AuthorizeLayer,
  CanRead,
  CanReadOwnerId,
  ResolveAudience,
} from './authorize';
import type { ServerSyncPlugin } from './sync-plugin';
import type { ElementRegistry } from '@fieldnotes/core';
import { startHeartbeat } from './heartbeat';
import { BEARER_SUBPROTOCOL_PREFIX, SYNC_WS_SUBPROTOCOL } from '@fieldnotes/sync';
import {
  DEFAULT_BYTES_PER_SECOND,
  DEFAULT_BYTE_BURST,
  DEFAULT_MAX_CONNECTIONS_PER_IP,
  DEFAULT_MAX_CONNECTIONS_PER_ROOM,
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
import { isValidRoomName } from './room-name';

export interface CreateSyncServerOptions {
  port?: number;
  server?: Server;
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authenticate?: Authenticate;
  authorize?: Authorize;
  authorizeLayer?: AuthorizeLayer;
  plugins?: readonly ServerSyncPlugin[];
  canRead?: CanRead;
  canReadOwnerId?: CanReadOwnerId;
  resolveAudience?: ResolveAudience;
  heartbeatIntervalMs?: number;
  maxMessageBytes?: number;
  maxJsonDepth?: number;
  maxPendingAuthMessages?: number;
  maxPendingAuthBytes?: number;
  messagesPerSecond?: number;
  messageBurst?: number;
  /** Sustained inbound bytes per second per connection (token bucket). */
  bytesPerSecond?: number;
  /** Inbound byte spike allowance per connection; a frame larger than this is never admitted. */
  byteBurst?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
  maxPresenceBytes?: number;
  /** Concurrent sockets per client address; `Infinity` disables the cap. */
  maxConnectionsPerIp?: number;
  /** Concurrent sockets per room, pending-auth sockets included; `Infinity` disables the cap. */
  maxConnectionsPerRoom?: number;
  /**
   * Resolves the client address the per-IP cap keys on. Defaults to the socket's
   * remote address; behind a trusted proxy read the forwarded header here.
   * Returning `undefined` or `''` exempts the connection from the per-IP cap.
   */
  clientAddress?: (req: IncomingMessage) => string | undefined;
  shutdownGraceMs?: number;
  /**
   * Registry used to translate extension envelopes for legacy peers. Without
   * it the hub relays unknown legacy element types verbatim and cannot encode
   * envelopes for pre-envelope clients.
   */
  elementRegistry?: ElementRegistry;
}

class ConcurrencyCounter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** Reserves a slot for `key`; returns a release function, or null when the cap is reached. */
  acquire(key: string): (() => void) | null {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.limit) return null;
    this.counts.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.counts.get(key) ?? 1) - 1;
      if (remaining <= 0) this.counts.delete(key);
      else this.counts.set(key, remaining);
    };
  }
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
  if (options.authorize && !options.authenticate) {
    // Ownership authorization needs a stable userId; the anonymous default is
    // the per-socket connId, which changes on every reconnect.
    throw new Error('createSyncServer: `authorize` requires an `authenticate` hook');
  }
  const hub = new SyncHub({
    backend: options.backend,
    fanout: options.fanout,
    instanceId: options.instanceId,
    authorize: options.authorize,
    authorizeLayer: options.authorizeLayer,
    plugins: options.plugins,
    canRead: options.canRead,
    canReadOwnerId: options.canReadOwnerId,
    resolveAudience: options.resolveAudience,
    maxJsonDepth: options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH,
    presenceThrottleMs: options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS,
    maxPresenceLanes: options.maxPresenceLanes,
    maxPresenceBytes: options.maxPresenceBytes,
    elementRegistry: options.elementRegistry,
  });
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  // A browser fails the handshake unless one offered subprotocol is selected, so select the
  // sync subprotocol when offered, otherwise the first non-bearer one (ws's default choice).
  // The bearer entry carries the token and is never echoed back.
  const handleProtocols = (protocols: Set<string>): string | false => {
    if (protocols.has(SYNC_WS_SUBPROTOCOL)) return SYNC_WS_SUBPROTOCOL;
    for (const protocol of protocols) {
      if (!protocol.startsWith(BEARER_SUBPROTOCOL_PREFIX)) return protocol;
    }
    return protocols.values().next().value ?? false;
  };
  const wss = options.server
    ? new WebSocketServer({ server: options.server, maxPayload: maxMessageBytes, handleProtocols })
    : new WebSocketServer({
        port: options.port ?? 0,
        maxPayload: maxMessageBytes,
        handleProtocols,
      });
  const heartbeat = startHeartbeat(wss, options.heartbeatIntervalMs ?? 30000);
  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;
  let counter = 0;
  const perIp = new ConcurrencyCounter(
    options.maxConnectionsPerIp ?? DEFAULT_MAX_CONNECTIONS_PER_IP,
  );
  const perRoom = new ConcurrencyCounter(
    options.maxConnectionsPerRoom ?? DEFAULT_MAX_CONNECTIONS_PER_ROOM,
  );
  const clientAddress = options.clientAddress ?? ((req) => req.socket.remoteAddress);
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
    if (!isValidRoomName(room)) {
      ws.close(4400, 'invalid room');
      return;
    }
    // Caps are taken before auth: the pending-auth window is exactly what a flood targets.
    const address = clientAddress(req);
    const releaseIp = address ? perIp.acquire(address) : () => undefined;
    if (!releaseIp) {
      ws.close(4429, 'too many connections');
      return;
    }
    const releaseRoom = perRoom.acquire(room);
    if (!releaseRoom) {
      releaseIp();
      ws.close(4429, 'too many connections');
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
    const byteLimiter = new MessageRateLimiter(
      options.bytesPerSecond ?? DEFAULT_BYTES_PER_SECOND,
      options.byteBurst ?? DEFAULT_BYTE_BURST,
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
      const now = Date.now();
      if (!limiter.take(now) || !byteLimiter.take(now, messageBytes)) {
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
      releaseIp();
      releaseRoom();
      if (admitted) hub.removeConnection(connId);
    });

    Promise.resolve(
      options.authenticate
        ? options.authenticate({ req, room, token: readBearerToken(req) })
        : { userId: connId },
    )
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
