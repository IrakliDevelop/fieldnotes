import { describe, it, expect } from 'vitest';
import { SyncHub } from '@fieldnotes/sync-server';
import type { Connection } from '@fieldnotes/sync-server';
import { createShape } from '@fieldnotes/core';
import { createCurrentCapabilities } from '@fieldnotes/sync';
import { RedisHubBackend, RedisHubFanout } from './index';
import type { RedisHashClient, RedisPublisher, RedisSubscriber } from './index';
import { emulateElementScript } from './test-support/element-scripts-fake';

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
  async hGet(key: string, field: string): Promise<string | null> {
    return this.store.get(key)?.get(field) ?? null;
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
  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const result = emulateElementScript(this.store, script, options);
    if (result === undefined) {
      throw new Error(`FakeRedis has no eval support (keys: ${options.keys.join(', ')})`);
    }
    return result;
  }
}

function makeConn(id: string, room: string): Connection & { sent: string[] } {
  const sent: string[] = [];
  return { id, room, send: (m: string) => sent.push(m), sent };
}

async function admit(hub: SyncHub, conn: Connection & { sent: string[] }): Promise<void> {
  await hub.handleMessage(
    conn.id,
    JSON.stringify({
      from: conn.id,
      op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
    }),
  );
  conn.sent.length = 0;
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
    await admit(hubA, connA);
    await admit(hubB, connB);

    const el = {
      ...createShape({ index: 'a0', position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'e1',
    };
    const msg = JSON.stringify({ from: 'ca', op: { kind: 'upsert', element: el } });

    await hubA.handleMessage('ca', msg);
    await tick(); // flush the fanout publish→subscribe microtask

    // Live cross-instance forward: hubB's local conn received the raw upsert.
    expect(connB.sent).toContain(msg);

    // Shared-backend snapshot consistency: a fresh backend over the same Redis sees e1.
    const snap = await new RedisHubBackend(redis).snapshot('R');
    expect(snap.elements.map((e) => e.id)).toContain('e1');
  });

  it('delivers server-owned presence across instances without persisting it', async () => {
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
    await tick();
    const remote = makeConn('remote', 'R');
    hubB.addConnection(remote);
    await admit(hubB, remote);

    expect(hubA.broadcastPresence('R', { kind: 'poke', feature: 'initiative' })).toBe(0);
    await tick();

    expect(remote.sent.map((message) => JSON.parse(message))).toEqual([
      {
        from: 'hub',
        op: { kind: 'presence', data: { kind: 'poke', feature: 'initiative' } },
      },
    ]);
    expect(await new RedisHubBackend(redis).snapshot('R')).toEqual({
      elements: [],
      tombstones: [],
    });
  });

  it('re-filters hierarchy-related elements per remote viewer while Redis keeps relationships', async () => {
    const bus = new FakeBus();
    const redis = new FakeRedis();
    const pub: RedisPublisher = { publish: (c: string, m: string) => bus.publish(c, m) };
    const sub: RedisSubscriber = {
      subscribe: (c: string, l: (m: string) => void) => bus.subscribe(c, l),
    };
    const canRead = ({ role, audience }: { role?: string; audience: string | undefined }) =>
      audience !== 'private' || role === 'gm';
    const mk = (id: string): SyncHub =>
      new SyncHub({
        instanceId: id,
        canRead,
        fanout: new RedisHubFanout(pub, sub),
        backend: new RedisHubBackend(redis),
      });
    const hubA = mk('A');
    const hubB = mk('B');
    await tick();
    const gm = { ...makeConn('gm', 'R'), role: 'gm' };
    const player = { ...makeConn('player', 'R'), role: 'player' };
    hubA.addConnection(gm);
    hubB.addConnection(player);
    await admit(hubA, gm);
    await admit(hubB, player);
    const parent = {
      ...createShape({ index: 'a0', position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'private-parent',
      audience: 'private',
      data: { secret: 'private-parent-sentinel' },
    };
    const forbiddenChild = {
      ...createShape({ index: 'a1', position: { x: 2, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'private-child',
      audience: 'private',
      parentId: parent.id,
      data: { secret: 'private-child-sentinel' },
    };
    const allowedChild = {
      ...createShape({ index: 'a2', position: { x: 3, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'public-child',
      parentId: parent.id,
    };

    for (const element of [parent, forbiddenChild, allowedChild]) {
      await hubA.handleMessage(
        gm.id,
        JSON.stringify({ from: gm.id, op: { kind: 'upsert', element } }),
      );
    }
    await tick();

    expect(player.sent).toHaveLength(1);
    expect(JSON.parse(player.sent[0] ?? '')).toMatchObject({
      op: { kind: 'upsert', element: { id: allowedChild.id, parentId: parent.id } },
    });
    expect(player.sent.join('')).not.toContain('private-parent-sentinel');
    expect(player.sent.join('')).not.toContain('private-child-sentinel');
    expect(player.sent.map((message) => JSON.parse(message).op.kind)).toEqual(['upsert']);
    const stored = await new RedisHubBackend(redis).snapshot('R');
    expect(stored.elements).toContainEqual(
      expect.objectContaining({
        id: allowedChild.id,
        parentId: parent.id,
      }),
    );
  });
});
