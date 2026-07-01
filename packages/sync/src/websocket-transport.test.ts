import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from './websocket-transport';
import type { WebSocketTransportOptions } from './websocket-transport';

const instances: FakeWebSocket[] = [];

class FakeWebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = this.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];

  constructor(public readonly url: string) {
    instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1006, reason: '' });
  }

  triggerServerClose(code: number, reason = ''): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code, reason });
  }

  triggerOpen(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  triggerMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const Fake = FakeWebSocket as unknown as typeof WebSocket;

const lastInstance = (): FakeWebSocket => {
  const ws = instances[instances.length - 1];
  if (!ws) throw new Error('no fake instance created');
  return ws;
};

afterEach(() => {
  vi.useRealTimers();
  instances.length = 0;
});

describe('WebSocketTransport', () => {
  it('buffers sends while CONNECTING and flushes them in order on open', () => {
    const transport = new WebSocketTransport('ws://x', { WebSocket: Fake });
    const fake = lastInstance();

    transport.send('a');
    transport.send('b');
    expect(fake.sent).toEqual([]);

    fake.triggerOpen();
    expect(fake.sent).toEqual(['a', 'b']);
  });

  it('sends immediately while OPEN', () => {
    const transport = new WebSocketTransport('ws://x', { WebSocket: Fake });
    const fake = lastInstance();

    fake.triggerOpen();
    transport.send('c');

    expect(fake.sent).toEqual(['c']);
  });

  it('delivers string messages to handlers and skips non-string data', () => {
    const transport = new WebSocketTransport('ws://x', { WebSocket: Fake });
    const fake = lastInstance();

    const received: string[] = [];
    transport.onMessage((m) => received.push(m));

    fake.triggerMessage('hi');
    fake.triggerMessage({});

    expect(received).toEqual(['hi']);
  });

  it('stops delivery after unsubscribe', () => {
    const transport = new WebSocketTransport('ws://x', { WebSocket: Fake });
    const fake = lastInstance();

    const received: string[] = [];
    const unsubscribe = transport.onMessage((m) => received.push(m));

    fake.triggerMessage('first');
    unsubscribe();
    fake.triggerMessage('second');

    expect(received).toEqual(['first']);
  });

  it('drops sends after close — neither buffered nor sent, no throw', () => {
    const transport = new WebSocketTransport('ws://x', { WebSocket: Fake });
    const fake = lastInstance();

    transport.close();
    expect(fake.readyState).toBe(fake.CLOSED);

    expect(() => transport.send('z')).not.toThrow();
    expect(fake.sent).toEqual([]);
  });

  it('is SSR-safe: no WebSocket makes construct/send/close/unsubscribe all no-throw', () => {
    const globalRef = globalThis as { WebSocket?: typeof WebSocket };
    const savedGlobal = globalRef.WebSocket;
    delete globalRef.WebSocket;

    try {
      const transport = new WebSocketTransport('ws://x', { WebSocket: undefined });

      const unsubscribe = transport.onMessage((m) => void m);

      expect(() => transport.send('noop')).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => transport.close()).not.toThrow();
      expect(instances).toEqual([]);
    } finally {
      if (savedGlobal !== undefined) {
        globalRef.WebSocket = savedGlobal;
      }
    }
  });
});

describe('WebSocketTransport reconnect', () => {
  const makeTransport = (
    overrides: Partial<{
      reconnect: boolean;
      maxBufferSize: number;
    }> = {},
  ): WebSocketTransport =>
    new WebSocketTransport('ws://x', {
      WebSocket: Fake,
      random: () => 0.5,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 1000,
      reconnectFactor: 2,
      ...overrides,
    });

  const drop = (): void => lastInstance().close();

  it('reconnects after an unexpected drop (new socket constructed, then live)', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    lastInstance().triggerOpen();

    const before = instances.length;
    drop();
    vi.advanceTimersByTime(75);
    expect(instances.length).toBe(before + 1);

    lastInstance().triggerOpen();
    transport.send('after');
    expect(lastInstance().sent).toEqual(['after']);
  });

  it('grows then caps the backoff schedule and resets it after a successful open', () => {
    vi.useFakeTimers();
    makeTransport();
    lastInstance().triggerOpen();

    // attempt 0: base 100 -> 75ms
    drop();
    expect(instances.length).toBe(1);
    vi.advanceTimersByTime(74);
    expect(instances.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(instances.length).toBe(2);

    // attempt 1 (no open in between): base 200 -> 150ms
    drop();
    vi.advanceTimersByTime(149);
    expect(instances.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(instances.length).toBe(3);

    // a successful open resets attempt; next drop is back to 75ms
    lastInstance().triggerOpen();
    drop();
    vi.advanceTimersByTime(74);
    expect(instances.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(instances.length).toBe(4);
  });

  it('caps the delay at reconnectMaxDelayMs', () => {
    vi.useFakeTimers();
    makeTransport();
    lastInstance().triggerOpen();

    // Drop repeatedly without opening: attempts 0..4 advance the schedule.
    const delays = [75, 150, 300, 600, 750];
    for (const delay of delays) {
      const before = instances.length;
      drop();
      vi.advanceTimersByTime(delay - 1);
      expect(instances.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(instances.length).toBe(before + 1);
    }

    // attempt 5: base min(1000, 100*2^5=3200) = 1000 -> 750ms (capped, not 1500)
    const before = instances.length;
    drop();
    vi.advanceTimersByTime(749);
    expect(instances.length).toBe(before);
    vi.advanceTimersByTime(1);
    expect(instances.length).toBe(before + 1);
  });

  it('buffers sends during disconnect and flushes them in order on reconnect', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const first = lastInstance();
    first.triggerOpen();

    drop();
    transport.send('a');
    transport.send('b');
    expect(first.sent).toEqual([]);

    vi.advanceTimersByTime(75);
    const second = lastInstance();
    expect(second).not.toBe(first);
    second.triggerOpen();
    expect(second.sent).toEqual(['a', 'b']);
  });

  it('bounds the buffer during disconnect, dropping oldest', () => {
    vi.useFakeTimers();
    const transport = makeTransport({ maxBufferSize: 2 });
    lastInstance().triggerOpen();

    drop();
    transport.send('a');
    transport.send('b');
    transport.send('c');

    vi.advanceTimersByTime(75);
    const second = lastInstance();
    second.triggerOpen();
    expect(second.sent).toEqual(['b', 'c']);
  });

  it('fires onReconnect only on re-open, after the buffer is flushed', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const sentAtReconnect: number[] = [];
    transport.onReconnect(() => sentAtReconnect.push(lastInstance().sent.length));

    lastInstance().triggerOpen();
    expect(sentAtReconnect).toEqual([]);

    drop();
    transport.send('x');
    vi.advanceTimersByTime(75);
    lastInstance().triggerOpen();

    expect(sentAtReconnect).toEqual([1]);
  });

  it('does not reconnect after an intentional close()', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    lastInstance().triggerOpen();

    transport.close();
    vi.advanceTimersByTime(5000);
    expect(instances.length).toBe(1);
  });

  it('does not reconnect when reconnect:false', () => {
    vi.useFakeTimers();
    makeTransport({ reconnect: false });
    lastInstance().triggerOpen();

    drop();
    vi.advanceTimersByTime(5000);
    expect(instances.length).toBe(1);
  });

  it('drops (does not buffer) sends after close()', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const fake = lastInstance();
    fake.triggerOpen();

    transport.close();
    expect(() => transport.send('z')).not.toThrow();

    // No reconnect, and nothing queued to flush anywhere.
    vi.advanceTimersByTime(5000);
    expect(instances.length).toBe(1);
    expect(fake.sent).toEqual([]);
  });

  it('is SSR-safe under reconnect: no socket, no buffering, no throw', () => {
    const globalRef = globalThis as { WebSocket?: typeof WebSocket };
    const savedGlobal = globalRef.WebSocket;
    delete globalRef.WebSocket;

    try {
      const transport = new WebSocketTransport('ws://x', { WebSocket: undefined });
      expect(() => transport.send('noop')).not.toThrow();
      expect(instances).toEqual([]);
    } finally {
      if (savedGlobal !== undefined) {
        globalRef.WebSocket = savedGlobal;
      }
    }
  });
});

describe('WebSocketTransport close codes', () => {
  const makeTransport = (overrides: Partial<WebSocketTransportOptions> = {}): WebSocketTransport =>
    new WebSocketTransport('ws://x', {
      WebSocket: Fake,
      random: () => 0.5,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 1000,
      reconnectFactor: 2,
      ...overrides,
    });

  it('suppresses reconnect on an app-range (4xxx) close and fires onClose', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    lastInstance().triggerOpen();

    const spy = vi.fn();
    transport.onClose(spy);

    const before = instances.length;
    lastInstance().triggerServerClose(4401, 'unauthorized');
    expect(spy).toHaveBeenCalledWith(4401, 'unauthorized');

    vi.advanceTimersByTime(10_000);
    expect(instances.length).toBe(before);
  });

  it('still reconnects on a transient (1006) close and fires onClose', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    lastInstance().triggerOpen();

    const spy = vi.fn();
    transport.onClose(spy);

    const before = instances.length;
    lastInstance().triggerServerClose(1006);
    expect(spy).toHaveBeenCalledWith(1006, '');

    vi.advanceTimersByTime(200);
    expect(instances.length).toBe(before + 1);
  });

  it('shouldReconnect:()=>false suppresses reconnect even on a transient close', () => {
    vi.useFakeTimers();
    new WebSocketTransport('ws://x', {
      WebSocket: Fake,
      random: () => 0.5,
      reconnectInitialDelayMs: 100,
      shouldReconnect: () => false,
    });
    lastInstance().triggerOpen();

    const before = instances.length;
    lastInstance().triggerServerClose(1006);
    vi.advanceTimersByTime(10_000);
    expect(instances.length).toBe(before);
  });

  it('shouldReconnect:()=>true reconnects even on an app-range (4xxx) close', () => {
    vi.useFakeTimers();
    new WebSocketTransport('ws://x', {
      WebSocket: Fake,
      random: () => 0.5,
      reconnectInitialDelayMs: 100,
      shouldReconnect: () => true,
    });
    lastInstance().triggerOpen();

    const before = instances.length;
    lastInstance().triggerServerClose(4401);
    vi.advanceTimersByTime(200);
    expect(instances.length).toBe(before + 1);
  });

  it('does not fire onClose on an intentional close()', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    lastInstance().triggerOpen();

    const spy = vi.fn();
    transport.onClose(spy);

    transport.close();
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(instances.length).toBe(1);
  });

  it('drops sends after a suppressed close — not buffered, no reconnect flushes them', () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const fake = lastInstance();
    fake.triggerOpen();

    fake.triggerServerClose(4401);
    transport.send('z');

    vi.advanceTimersByTime(10_000);
    expect(instances.length).toBe(1);
    expect(fake.sent).not.toContain('z');
  });
});
