import { describe, it, expect, vi } from 'vitest';
import { RedisHubFanout } from './index';
import type { RedisPublisher, RedisSubscriber } from './index';

class FakeBus {
  private channels = new Map<string, Set<(m: string) => void>>();
  publish(channel: string, message: string): void {
    this.channels.get(channel)?.forEach((l) => l(message));
  }
  subscribe(channel: string, listener: (m: string) => void): void {
    let s = this.channels.get(channel);
    if (!s) {
      s = new Set();
      this.channels.set(channel, s);
    }
    s.add(listener);
  }
}

function seams(bus: FakeBus): { pub: RedisPublisher; sub: RedisSubscriber } {
  const pub: RedisPublisher = { publish: (c: string, m: string) => bus.publish(c, m) };
  const sub: RedisSubscriber = {
    subscribe: (c: string, l: (m: string) => void) => bus.subscribe(c, l),
  };
  return { pub, sub };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('RedisHubFanout', () => {
  it('delivers a published payload to a subscriber on another instance (same bus)', async () => {
    const bus = new FakeBus();
    const { pub, sub } = seams(bus);
    const fanoutA = new RedisHubFanout(pub, sub);
    const fanoutB = new RedisHubFanout(pub, sub);
    const spyA = vi.fn();
    fanoutA.subscribe(spyA);
    await tick(); // let the subscribe-inside-Promise register the listener

    fanoutB.publish('hi');
    await tick();

    expect(spyA).toHaveBeenCalledWith('hi');
  });

  it('does not deliver across different channels', async () => {
    const bus = new FakeBus();
    const { pub, sub } = seams(bus);
    const onDefault = new RedisHubFanout(pub, sub);
    const onOther = new RedisHubFanout(pub, sub, { channel: 'other' });
    const spy = vi.fn();
    onOther.subscribe(spy);
    await tick();

    onDefault.publish('hi');
    await tick();

    expect(spy).not.toHaveBeenCalled();
  });

  it('publishes on the default channel fieldnotes:fanout', async () => {
    const targets: string[] = [];
    const pub: RedisPublisher = {
      publish: (c: string) => {
        targets.push(c);
      },
    };
    const sub: RedisSubscriber = { subscribe: () => undefined };
    new RedisHubFanout(pub, sub).publish('a');
    await tick();

    expect(targets).toEqual(['fieldnotes:fanout']);
  });

  it('invokes onError when the publisher rejects', async () => {
    const spy = vi.fn();
    const pub2: RedisPublisher = { publish: () => Promise.reject(new Error('x')) };
    const sub: RedisSubscriber = { subscribe: () => undefined };
    new RedisHubFanout(pub2, sub, { onError: spy }).publish('a');
    await tick();

    expect(spy).toHaveBeenCalledOnce();
  });

  it('invokes onError when the subscriber rejects', async () => {
    const spy = vi.fn();
    const pub: RedisPublisher = { publish: () => undefined };
    const sub: RedisSubscriber = { subscribe: () => Promise.reject(new Error('sub')) };
    new RedisHubFanout(pub, sub, { onError: spy }).subscribe(() => undefined);
    await tick();

    expect(spy).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops delivery to that handler', async () => {
    const bus = new FakeBus();
    const { pub, sub } = seams(bus);
    const fanout = new RedisHubFanout(pub, sub);
    const spy = vi.fn();
    const off = fanout.subscribe(spy);
    await tick();
    off();

    fanout.publish('hi');
    await tick();

    expect(spy).not.toHaveBeenCalled();
  });
});
