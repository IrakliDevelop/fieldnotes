import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { createClient } from 'redis';
import { createShape, ElementStore } from '@fieldnotes/core';
import {
  createSyncServer,
  InMemoryHubFanout,
  SyncHub,
  type Authenticate,
  type Authorize,
} from '@fieldnotes/sync-server';
import {
  SyncClient,
  WebSocketTransport,
  type FogMetaRecord,
  type FogTileRecord,
  type SyncElement,
} from '@fieldnotes/sync';
import { RedisHubBackend, RedisHubFanout, type RedisHashClient } from './index';
import { createFogBackendPlugin, FogBackendServiceKey } from '@fieldnotes/vtt/redis';
import { createFogServerPlugin } from '@fieldnotes/vtt/server';
import { emulateElementScript } from './test-support/element-scripts-fake';

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
  async hGet(key: string, field: string): Promise<string | null> {
    return this.store.get(key)?.get(field) ?? null;
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
  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const elementResult = emulateElementScript(this.store, script, options);
    if (elementResult !== undefined) return elementResult;
    const [metaKey, tilesKey] = options.keys;
    const incoming = JSON.parse(options.arguments[0] ?? '') as
      FogMetaRecord | FogTileRecord | FogTileRecord[];
    if (!metaKey || !tilesKey) throw new Error('missing keys');
    if (Array.isArray(incoming)) {
      const accepted: FogTileRecord[] = [];
      const corrections: FogTileRecord[] = [];
      for (const tile of incoming) {
        const result = await this.eval(script, {
          keys: options.keys,
          arguments: [JSON.stringify(tile)],
        });
        const row = result as unknown[];
        if (row[0] === 1) accepted.push(tile);
        else if (typeof row[1] === 'string') corrections.push(JSON.parse(row[1]));
      }
      return [
        accepted.length,
        ...accepted.map((record) => JSON.stringify(record)),
        corrections.length,
        ...corrections.map((record) => JSON.stringify(record)),
      ];
    }
    if ('x' in incoming) {
      const metaRaw = this.store.get(metaKey)?.get('current');
      const meta = metaRaw ? (JSON.parse(metaRaw) as FogMetaRecord) : undefined;
      if (!meta?.definition) return [0];
      const field = `${incoming.x},${incoming.y}`;
      const currentRaw = this.store.get(tilesKey)?.get(field);
      const current = currentRaw ? (JSON.parse(currentRaw) as FogTileRecord) : undefined;
      if (
        incoming.generation !== meta.definition.generation ||
        (current && !isNewer(incoming, current))
      ) {
        return [0, currentRaw];
      }
      this.hash(tilesKey).set(field, JSON.stringify(incoming));
      return [1];
    }
    const currentRaw = this.store.get(metaKey)?.get('current');
    const current = currentRaw ? (JSON.parse(currentRaw) as FogMetaRecord) : undefined;
    if (current && !isNewer(incoming, current)) return [0, currentRaw];
    this.hash(metaKey).set('current', JSON.stringify(incoming));
    if (
      !incoming.definition ||
      !current?.definition ||
      current.definition.generation !== incoming.definition.generation
    ) {
      this.store.delete(tilesKey);
    }
    return [1];
  }
}

function isNewer(
  a: { version: number; editor: string },
  b: { version: number; editor: string },
): boolean {
  return a.version > b.version || (a.version === b.version && a.editor > b.editor);
}

interface RecordingConnection {
  id: string;
  room: string;
  sent: string[];
  send(message: string): void;
}

function connection(id: string, room: string): RecordingConnection {
  return {
    id,
    room,
    sent: [],
    send(message: string) {
      this.sent.push(message);
    },
  };
}

describe('RedisHubBackend behind SyncHub', () => {
  it('Redis-backed relay: forwards ops, persists to redis, serves request-snapshot from redis', async () => {
    const fake = new FakeRedis();
    const hub = new SyncHub({ backend: new RedisHubBackend(fake) });

    const a = connection('A', 'R');
    const b = connection('B', 'R');
    hub.addConnection(a);
    hub.addConnection(b);

    const el = {
      ...createShape({ index: 'a0', position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'e1',
    };
    await hub.handleMessage(
      'A',
      JSON.stringify({ from: 'A', op: { kind: 'upsert', element: el } }),
    );

    // (a) C1 forward path still works Redis-backed: B received the forwarded upsert.
    expect(b.sent).toHaveLength(1);
    const forwarded = JSON.parse(b.sent[0] ?? '');
    expect(forwarded.op.kind).toBe('upsert');
    expect(forwarded.op.element.id).toBe('e1');

    // (b) the element was persisted to redis.
    const fromRedis = await new RedisHubBackend(fake).snapshot('R');
    expect(fromRedis.elements.map((e) => e.id)).toEqual(['e1']);

    await hub.handleMessage('B', JSON.stringify({ from: 'B', op: { kind: 'request-snapshot' } }));

    const last = JSON.parse(b.sent[b.sent.length - 1] ?? '');
    expect(last.from).toBe('hub');
    expect(last.op.kind).toBe('snapshot');
    expect(last.op.to).toBe('B');
    expect(last.op.elements.map((e: { id: string }) => e.id)).toEqual(['e1']);
    expect(last.op.elements[0].position).toEqual({ x: 1, y: 2 });
  });

  it('restart through the hub: a fresh hub over the same redis serves persisted state', async () => {
    const fake = new FakeRedis();
    const hub1 = new SyncHub({ backend: new RedisHubBackend(fake) });
    const a = connection('A', 'R');
    hub1.addConnection(a);
    const el = {
      ...createShape({ index: 'a0', position: { x: 5, y: 6 }, size: { w: 7, h: 8 } }),
      id: 'e1',
    };
    await hub1.handleMessage(
      'A',
      JSON.stringify({ from: 'A', op: { kind: 'upsert', element: el } }),
    );

    const hub2 = new SyncHub({ backend: new RedisHubBackend(fake) });
    const c = connection('C', 'R');
    hub2.addConnection(c);
    await hub2.handleMessage('C', JSON.stringify({ from: 'C', op: { kind: 'request-snapshot' } }));

    expect(c.sent).toHaveLength(1);
    const snap = JSON.parse(c.sent[0] ?? '');
    expect(snap.op.kind).toBe('snapshot');
    expect(snap.op.to).toBe('C');
    expect(snap.op.elements.map((e: { id: string }) => e.id)).toEqual(['e1']);
  });

  it('a stale hub instance cannot overwrite newer shared fog state', async () => {
    const fake = new FakeRedis();
    const fanout = new InMemoryHubFanout();
    const hubA = new SyncHub({
      backend: new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] }),
      plugins: [createFogServerPlugin()],
      fanout,
      instanceId: 'hub-a',
    });
    const hubB = new SyncHub({
      backend: new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] }),
      plugins: [createFogServerPlugin()],
      fanout,
      instanceId: 'hub-b',
    });
    const a = connection('A', 'R');
    const b = connection('B', 'R');
    hubA.addConnection(a);
    hubB.addConnection(b);
    const definition = {
      version: 1 as const,
      generation: 'gen-1',
      bounds: { x: 0, y: 0, w: 128, h: 128 },
      cellSize: 1,
      tileCells: 128 as const,
      base: 'covered' as const,
    };

    await hubA.handleMessage(
      'A',
      JSON.stringify({
        from: 'A',
        op: { kind: 'fog-meta', record: { version: 10, editor: 'Z', definition } },
      }),
    );
    b.sent.length = 0;
    await hubB.handleMessage(
      'B',
      JSON.stringify({
        from: 'B',
        op: { kind: 'fog-meta', record: { version: 6, editor: 'B', definition } },
      }),
    );

    expect(JSON.parse(b.sent[0] ?? '').op.record).toEqual({
      version: 10,
      editor: 'Z',
      definition,
    });
    const inspectionBackend = new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] });
    expect(
      (await inspectionBackend.getService(FogBackendServiceKey)?.snapshot('R'))?.meta.version,
    ).toBe(10);
    hubA.close();
    hubB.close();
  });
});

/**
 * Opt-in like `redis-fog.integration.test.ts`: runs the element Lua scripts and two hub instances
 * against a real Redis only when `REDIS_URL` is set.
 */
const redisUrl = process.env['REDIS_URL'];

type NodeRedisClient = ReturnType<typeof createClient>;

/** node-redis behind the documented adapter, with `scriptLoad`/`evalSha` so EVALSHA runs. */
function hashClient(client: NodeRedisClient): RedisHashClient {
  return {
    hGetAll: async (key) => ({ ...(await client.hGetAll(key)) }),
    hGet: async (key, field) => {
      const reply = await client.hGet(key, field);
      return typeof reply === 'string' ? reply : null;
    },
    hSet: (key, field, value) => client.hSet(key, field, value),
    hDel: (key, field) => client.hDel(key, field),
    del: (key) => client.del(key),
    eval: (script, options) => client.eval(script, options),
    scriptLoad: async (script) => String(await client.scriptLoad(script)),
    evalSha: (sha, options) => client.evalSha(sha, options),
    expire: (key, seconds) => client.expire(key, seconds),
  };
}

const realShape = (id: string, version: number, x = 0): SyncElement => ({
  ...createShape({ index: 'a0', position: { x, y: 0 }, size: { w: 1, h: 1 } }),
  id,
  version,
});

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(!redisUrl)('RedisHubBackend elements against a real Redis', () => {
  let connection: NodeRedisClient | undefined;
  let keyPrefix = '';

  function client(): NodeRedisClient {
    if (!connection) throw new Error('the integration Redis client is not connected');
    return connection;
  }
  const backend = (options: { ttlSeconds?: number } = {}) =>
    new RedisHubBackend(hashClient(client()), { keyPrefix, ...options });

  beforeAll(async () => {
    connection = createClient({ url: redisUrl });
    await connection.connect();
  });

  afterAll(async () => {
    const open = connection;
    connection = undefined;
    if (open) await open.close();
  });

  beforeEach(() => {
    keyPrefix = `fieldnotes-it:${randomUUID()}:room:`;
  });

  afterEach(async () => {
    const keys = await client().keys(`${keyPrefix}*`);
    if (keys.length > 0) await client().del(keys);
  });

  it('lets exactly one of two backends racing on one id win, in Lua', async () => {
    const [a, b] = [backend(), backend()];
    for (let round = 0; round < 20; round++) {
      const id = `e${round}`;
      const created = await Promise.all([
        a.applyElement('R', { kind: 'upsert', element: realShape(id, 1, 1) }, null),
        b.applyElement('R', { kind: 'upsert', element: realShape(id, 1, 2) }, null),
      ]);
      expect(created.filter((r) => r.ok)).toHaveLength(1);
      const edited = await Promise.all([
        a.applyElement('R', { kind: 'upsert', element: realShape(id, 2, 3) }, 1),
        b.applyElement('R', { kind: 'upsert', element: realShape(id, 2, 4) }, 1),
      ]);
      expect(edited.filter((r) => r.ok)).toHaveLength(1);
      const stored = await a.getRecord('R', id);
      expect(edited.find((r) => !r.ok)).toEqual({ ok: false, current: stored });
    }
  });

  it('stores tombstones, clears through the script and refuses a mismatched clear', async () => {
    const hub = backend();
    await hub.applyElement('R', { kind: 'upsert', element: realShape('a', 1) }, null);
    await hub.applyElement('R', { kind: 'upsert', element: realShape('b', 3) }, null);
    const removedAt = Date.now();
    const tomb = (id: string, version: number) => ({
      id,
      version,
      editor: 'gm',
      removedAt,
      ownerId: 'p1',
      removedBy: 'gm',
      audience: 'gm',
    });
    expect(await hub.applyElement('R', { kind: 'remove', tombstone: tomb('a', 2) }, 1)).toEqual({
      ok: true,
    });
    expect(await hub.getRecord('R', 'a')).toEqual({ kind: 'tombstone', tombstone: tomb('a', 2) });
    expect(
      await hub.applyElement('R', { kind: 'upsert', element: realShape('a', 3) }, null),
    ).toEqual({ ok: false, current: { kind: 'tombstone', tombstone: tomb('a', 2) } });

    await expect(
      hub.applyElement(
        'R',
        { kind: 'clear', tombstones: [tomb('a', 4)], expected: new Map([['b', 3]]) },
        null,
      ),
    ).rejects.toThrow('clear tombstones must match the expected ids');
    expect(
      await hub.applyElement(
        'R',
        { kind: 'clear', tombstones: [tomb('b', 3)], expected: new Map([['b', 2]]) },
        null,
      ),
    ).toEqual({ ok: false, current: { kind: 'element', element: realShape('b', 3) } });
    expect(
      await hub.applyElement(
        'R',
        { kind: 'clear', tombstones: [tomb('b', 4)], expected: new Map([['b', 3]]) },
        null,
      ),
    ).toEqual({ ok: true });
    expect(await hub.snapshot('R')).toEqual({
      elements: [],
      tombstones: expect.arrayContaining([tomb('a', 2), tomb('b', 4)]),
    });
  });

  it('migrates a pre-F1 room in HGETALL order, idempotently across two instances', async () => {
    const roomKey = `${keyPrefix}R`;
    for (const id of ['north', 'west', 'east']) {
      const stored: Record<string, unknown> = { ...realShape(id, 1), zIndex: 0 };
      delete stored['index'];
      delete stored['version'];
      await client().hSet(roomKey, id, JSON.stringify(stored));
    }
    const hgetallOrder = Object.keys(await client().hGetAll(roomKey));

    const [first, second] = await Promise.all([backend().snapshot('R'), backend().snapshot('R')]);
    const byIndex = [...first.elements].sort((x, y) => (x.index < y.index ? -1 : 1));
    expect(byIndex.map((e) => e.id)).toEqual(hgetallOrder);
    expect(new Set(byIndex.map((e) => e.index)).size).toBe(3);
    expect(byIndex.every((e) => e.version === 1 && !('zIndex' in e))).toBe(true);
    expect(second.elements).toEqual(first.elements);

    const migrated = await client().hGetAll(roomKey);
    await backend().snapshot('R');
    expect(await client().hGetAll(roomKey)).toEqual(migrated);
  });

  it('ttlSeconds refreshes the tombstone key', async () => {
    const hub = backend({ ttlSeconds: 120 });
    const removedAt = Date.now();
    await hub.applyElement(
      'R',
      { kind: 'remove', tombstone: { id: 't', version: 1, editor: 'gm', removedAt } },
      null,
    );
    const ttl = await client().ttl(`${keyPrefix}R:tombstones`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  describe('two SyncHub instances with RedisHubFanout', () => {
    const authenticate: Authenticate = ({ token }) =>
      token ? { userId: token, role: token === 'gm' ? 'gm' : 'player' } : null;
    const authorize: Authorize = ({ role, op, currentElement, userId }) =>
      role === 'gm' ||
      (op.kind !== 'clear' && (!currentElement || currentElement.ownerId === userId));
    const cleanup: (() => unknown)[] = [];

    afterEach(async () => {
      for (const step of cleanup.reverse()) await step();
      cleanup.length = 0;
    });

    async function startHubs(): Promise<[number, number]> {
      const channel = `${keyPrefix}fanout`;
      const ports: number[] = [];
      for (let i = 0; i < 2; i++) {
        const subscriber = client().duplicate();
        await subscriber.connect();
        cleanup.push(() => subscriber.close());
        const fanout = new RedisHubFanout(
          { publish: (c, m) => client().publish(c, m) },
          { subscribe: (c, listener) => subscriber.subscribe(c, listener) },
          { channel },
        );
        const server = createSyncServer({
          port: 0,
          backend: backend(),
          fanout,
          authenticate,
          authorize,
        });
        cleanup.push(() => server.close());
        ports.push((server.wss.address() as AddressInfo).port);
      }
      await waitFor(async () => (await client().pubSubNumSub(channel))[channel] === 2);
      const [a = 0, b = 0] = ports;
      return [a, b];
    }

    function connect(port: number, user: string): ElementStore {
      const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=R&token=${user}`);
      const store = new ElementStore();
      const syncClient = new SyncClient({ store, transport, clientId: `${user}-peer` });
      syncClient.start();
      cleanup.push(
        () => transport.close(),
        () => syncClient.stop(),
      );
      return store;
    }

    async function connectRaw(port: number, user: string): Promise<WebSocket> {
      const socket = new WebSocket(`ws://127.0.0.1:${port}?room=R&token=${user}`);
      cleanup.push(() => socket.close());
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      return socket;
    }

    it('accepts one of two concurrent upserts at the same base version and converges both instances', async () => {
      const [portA, portB] = await startHubs();
      const gmA = connect(portA, 'gm');
      const gmB = connect(portB, 'gm');
      gmA.add(realShape('e', 1));
      await waitFor(() => gmB.getById('e') !== undefined);
      const base = gmA.getById('e')?.version;
      expect(gmB.getById('e')?.version).toBe(base);

      gmA.update('e', { position: { x: 10, y: 10 } });
      gmB.update('e', { position: { x: 20, y: 20 } });

      const hub = backend();
      await waitFor(async () => {
        const stored = await hub.getRecord('R', 'e');
        if (stored?.kind !== 'element') return false;
        return [gmA, gmB].every(
          (store) =>
            store.getById('e')?.version === stored.element.version &&
            store.getById('e')?.position.x === stored.element.position.x,
        );
      });
      const stored = await hub.getRecord('R', 'e');
      expect(stored?.kind === 'element' && stored.element.version).toBe(Number(base) + 1);
      expect([10, 20]).toContain(stored?.kind === 'element' && stored.element.position.x);
    });

    it('never leaves a player-owned element when a player recreate races a GM delete', async () => {
      const [portA, portB] = await startHubs();
      const gm = connect(portA, 'gm');
      const player = await connectRaw(portB, 'p1');
      const corrections: string[] = [];
      player.addEventListener('message', (event) => {
        if (JSON.parse(String(event.data)).from === 'hub') corrections.push(String(event.data));
      });
      const hub = backend();
      const ids = Array.from({ length: 10 }, (_, i) => `x${i}`);
      for (const id of ids) gm.add(realShape(id, 1));
      await waitFor(async () => (await hub.snapshot('R')).elements.length === ids.length);

      for (const id of ids) {
        const element = gm.getById(id);
        gm.remove(id);
        player.send(
          JSON.stringify({
            from: 'p1-peer',
            op: { kind: 'upsert', element: { ...element, version: 5 } },
          }),
        );
      }

      await waitFor(async () => (await hub.snapshot('R')).tombstones.length === ids.length);
      await waitFor(() => corrections.length >= ids.length);
      for (const id of ids) {
        const record = await hub.getRecord('R', id);
        expect(record?.kind).toBe('tombstone');
        expect(gm.getById(id)).toBeUndefined();
      }
    });
  });
});
