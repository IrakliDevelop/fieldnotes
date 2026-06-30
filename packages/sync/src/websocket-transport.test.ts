import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketTransport } from './websocket-transport';

const instances: FakeWebSocket[] = [];

class FakeWebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = this.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public readonly url: string) {
    instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.onclose?.();
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
