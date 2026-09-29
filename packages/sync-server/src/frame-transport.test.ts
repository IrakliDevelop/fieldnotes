import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { FrameBudget } from './bounded-frame-queue';
import { FrameTransport } from './frame-transport';
import { SyncHub } from './sync-hub';

describe('outbound send callback lifecycle', () => {
  it('retains an active reservation across close, then releases exactly once on a late error', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const close = vi.fn();
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      close,
    );
    transport.send('one');
    await vi.waitFor(() => expect(callback).toBeDefined());
    transport.dispose();
    expect(budget.reserve('B', 'R', 'two')).toBeNull();
    callback?.(new Error('late private error'));
    await new Promise((resolve) => setImmediate(resolve));
    const release = budget.reserve('B', 'R', 'two');
    expect(release).toBeTypeOf('function');
    callback?.(new Error('duplicate callback'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(budget.reserve('C', 'R', 'three')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    release?.();
    expect(budget.reserve('C', 'R', 'three')).toBeTypeOf('function');
    hub.close();
  });
});
