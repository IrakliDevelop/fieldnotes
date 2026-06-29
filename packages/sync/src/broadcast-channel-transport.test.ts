import { afterEach, describe, expect, it } from 'vitest';
import { BroadcastChannelTransport } from './broadcast-channel-transport';

const registry = new Map<string, Set<FakeBroadcastChannel>>();

class FakeBroadcastChannel {
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(public readonly name: string) {
    let peers = registry.get(name);
    if (!peers) {
      peers = new Set();
      registry.set(name, peers);
    }
    peers.add(this);
  }

  postMessage(data: unknown): void {
    const peers = registry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    registry.get(this.name)?.delete(this);
  }
}

const Fake = FakeBroadcastChannel as unknown as typeof BroadcastChannel;

afterEach(() => {
  registry.clear();
});

describe('BroadcastChannelTransport', () => {
  it('delivers a sent message to another transport on the same channel', () => {
    const a = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });
    const b = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });

    const received: string[] = [];
    b.onMessage((m) => received.push(m));

    a.send('hello');

    expect(received).toEqual(['hello']);
  });

  it('does not echo a sent message back to the sender', () => {
    const a = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });
    const b = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });

    const ownReceived: string[] = [];
    a.onMessage((m) => ownReceived.push(m));
    b.onMessage((m) => void m);

    a.send('hello');

    expect(ownReceived).toEqual([]);
  });

  it('stops delivery after unsubscribe', () => {
    const a = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });
    const b = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });

    const received: string[] = [];
    const unsubscribe = b.onMessage((m) => received.push(m));

    a.send('first');
    unsubscribe();
    a.send('second');

    expect(received).toEqual(['first']);
  });

  it('detaches on close so post-close sends do not reach it', () => {
    const a = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });
    const b = new BroadcastChannelTransport('x', { BroadcastChannel: Fake });

    const received: string[] = [];
    b.onMessage((m) => received.push(m));

    b.close();
    a.send('after-close');

    expect(received).toEqual([]);
  });

  it('is SSR-safe: no usable channel makes send/close no-throw and unsubscribe a callable no-op', () => {
    const globalRef = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
    const savedGlobal = globalRef.BroadcastChannel;
    delete globalRef.BroadcastChannel;

    try {
      const transport = new BroadcastChannelTransport('x', {
        BroadcastChannel: undefined,
      });

      const unsubscribe = transport.onMessage((m) => void m);

      expect(() => transport.send('noop')).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => transport.close()).not.toThrow();
    } finally {
      if (savedGlobal !== undefined) {
        globalRef.BroadcastChannel = savedGlobal;
      }
    }
  });
});
