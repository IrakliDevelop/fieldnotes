import { describe, expect, it, vi } from 'vitest';
import { drainWebSocketServer, type ShutdownServer, type ShutdownSocket } from './shutdown';

function socket(): ShutdownSocket {
  return { close: vi.fn(), terminate: vi.fn() };
}

describe('drainWebSocketServer', () => {
  it('stops admission before asking active clients to close', async () => {
    const order: string[] = [];
    const client = socket();
    vi.mocked(client.close).mockImplementation(() => order.push('client'));
    let onDrained: () => void = () => undefined;
    const server: ShutdownServer = {
      clients: new Set([client]),
      close: (callback) => {
        order.push('server');
        onDrained = callback;
      },
    };

    const drained = drainWebSocketServer(server, 1000);
    expect(order).toEqual(['server', 'client']);

    server.clients.clear();
    onDrained();
    await drained;
  });

  it('uses a normal-going-away close and terminates clients left after the grace period', async () => {
    vi.useFakeTimers();
    const client = socket();
    let onDrained: () => void = () => undefined;
    const server: ShutdownServer = {
      clients: new Set([client]),
      close: (callback) => {
        onDrained = callback;
      },
    };

    const drained = drainWebSocketServer(server, 250);
    expect(client.close).toHaveBeenCalledWith(1001, 'server shutting down');
    expect(client.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(client.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.terminate).toHaveBeenCalledOnce();
    await drained;

    // A late server callback after the deadline is harmless.
    server.clients.clear();
    onDrained();
    vi.useRealTimers();
  });
});
