export const DEFAULT_SHUTDOWN_GRACE_MS = 5000;

export interface ShutdownSocket {
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface ShutdownServer {
  clients: Set<ShutdownSocket>;
  close(callback: (error?: Error) => void): void;
}

/** Stop admission, ask connected peers to leave, then forcefully reap stragglers. */
export function drainWebSocketServer(wss: ShutdownServer, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      for (const ws of wss.clients) {
        try {
          ws.terminate();
        } catch {
          /* socket already failed while shutdown was in progress */
        }
      }
      finish();
    }, graceMs);

    // Calling close first prevents new connections. Its callback runs once all clients have left.
    wss.close(() => finish());
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        try {
          ws.terminate();
        } catch {
          /* socket already closed */
        }
      }
    }
  });
}
