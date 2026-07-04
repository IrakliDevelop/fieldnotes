export interface HeartbeatSocket {
  ping(): void;
  terminate(): void;
  on(event: 'pong', listener: () => void): void;
}
export interface HeartbeatServer {
  clients: Set<HeartbeatSocket>;
}
export interface Heartbeat {
  track(ws: HeartbeatSocket): void;
  stop(): void;
}

export function startHeartbeat(wss: HeartbeatServer, intervalMs: number): Heartbeat {
  if (intervalMs <= 0) {
    return {
      track: () => {
        /* disabled */
      },
      stop: () => {
        /* disabled */
      },
    };
  }
  const alive = new WeakMap<HeartbeatSocket, boolean>();
  const track = (ws: HeartbeatSocket): void => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  };
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      try {
        if (alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        alive.set(ws, false);
        ws.ping();
      } catch {
        /* socket dying mid-tick — skip it */
      }
    }
  }, intervalMs);
  return { track, stop: () => clearInterval(interval) };
}
