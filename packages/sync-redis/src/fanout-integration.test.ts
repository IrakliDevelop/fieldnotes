import { describe, it, expect } from 'vitest';
import { SyncHub } from '@fieldnotes/sync-server';
import type { Connection } from '@fieldnotes/sync-server';
import { createShape } from '@fieldnotes/core';
import { RedisHubBackend, RedisHubFanout } from './index';
import type { RedisHashClient, RedisPublisher, RedisSubscriber } from './index';

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

class FakeRedis implements RedisHashClient {
  store = new Map<string, Map<string, string>>();
  private hash(key: string): Map<string, string> {
    let m = this.store.get(key);
    if (!m) {
      m = new Map();
      this.store.set(key, m);
    }
    return m;
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    const m = this.store.get(key);
    return m ? Object.fromEntries(m) : {};
  }
  async hSet(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value);
    return 1;
  }
  async hDel(key: string, field: string): Promise<number> {
    this.store.get(key)?.delete(field);
    return 1;
  }
  async del(key: string): Promise<number> {
    this.store.delete(key);
    return 1;
  }
}

function makeConn(id: string, room: string): Connection & { sent: string[] } {
  const sent: string[] = [];
  return { id, room, send: (m: string) => sent.push(m), sent };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('RedisHubFanout + RedisHubBackend cross-instance integration', () => {
  it('delivers a live op across instances AND persists it in the shared backend', async () => {
    const bus = new FakeBus();
    const redis = new FakeRedis();
    const pub: RedisPublisher = { publish: (c: string, m: string) => bus.publish(c, m) };
    const sub: RedisSubscriber = {
      subscribe: (c: string, l: (m: string) => void) => bus.subscribe(c, l),
    };
    const mk = (id: string): SyncHub =>
      new SyncHub({
        instanceId: id,
        fanout: new RedisHubFanout(pub, sub),
        backend: new RedisHubBackend(redis),
      });

    const hubA = mk('A');
    const hubB = mk('B');
    // RedisHubFanout registers the shared-bus listener inside a resolved Promise, so wait a tick
    // for both hubs' subscriptions to go live before publishing.
    await tick();

    const connA = makeConn('ca', 'R');
    const connB = makeConn('cb', 'R');
    hubA.addConnection(connA);
    hubB.addConnection(connB);

    const el = { ...createShape({ position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }), id: 'e1' };
    const msg = JSON.stringify({ from: 'ca', op: { kind: 'upsert', element: el } });

    await hubA.handleMessage('ca', msg);
    await tick(); // flush the fanout publish→subscribe microtask

    // Live cross-instance forward: hubB's local conn received the raw upsert.
    expect(connB.sent).toContain(msg);

    // Shared-backend snapshot consistency: a fresh backend over the same Redis sees e1.
    const snap = await new RedisHubBackend(redis).snapshot('R');
    expect(snap.map((e) => e.id)).toContain('e1');
  });
});
