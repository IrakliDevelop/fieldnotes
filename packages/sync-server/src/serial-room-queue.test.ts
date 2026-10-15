import { describe, expect, it, vi } from 'vitest';
import { SerialRoomQueue } from './serial-room-queue';

describe('removable room queue', () => {
  it('unlinks aborted queued work behind a hung head and recovers after rejection', async () => {
    let rejectHead: ((reason: Error) => void) | undefined;
    const head = new Promise<void>((_resolve, reject) => (rejectHead = reject));
    const idle = vi.fn();
    const queue = new SerialRoomQueue(idle);
    const first = queue.enqueue(() => head);
    const controller = new AbortController();
    const skipped = vi.fn();
    const second = queue.enqueue(skipped, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
    });
    controller.abort();
    await expect(second).resolves.toBeUndefined();
    expect(skipped).not.toHaveBeenCalled();
    const third = vi.fn();
    const final = queue.enqueue(third);
    expect(third).not.toHaveBeenCalled();
    rejectHead?.(new Error('backend unavailable'));
    await expect(first).rejects.toThrow('backend unavailable');
    await final;
    expect(third).toHaveBeenCalledOnce();
    expect(queue.idle).toBe(true);
    expect(idle).toHaveBeenCalled();
  });
});
