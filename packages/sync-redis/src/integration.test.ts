import { describe, it, expect } from 'vitest';
import { createShape } from '@fieldnotes/core';
import { InMemoryHubFanout, SyncHub } from '@fieldnotes/sync-server';
import type { FogMetaRecord, FogTileRecord } from '@fieldnotes/sync';
import { RedisHubBackend, type RedisHashClient } from './index';

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
  async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const [metaKey, tilesKey] = options.keys;
    const incoming = JSON.parse(options.arguments[0] ?? '') as
      | FogMetaRecord
      | FogTileRecord
      | FogTileRecord[];
    if (!metaKey || !tilesKey) throw new Error('missing keys');
    if (Array.isArray(incoming)) {
      const accepted: FogTileRecord[] = [];
      const corrections: FogTileRecord[] = [];
      for (const tile of incoming) {
        const result = await this.eval(_script, {
          keys: options.keys,
          arguments: [JSON.stringify(tile)],
        });
        const row = result as unknown[];
        if (row[0] === 1) accepted.push(tile);
        else if (typeof row[1] === 'string') corrections.push(JSON.parse(row[1]));
      }
      return [
        accepted.length,
        ...accepted.map(JSON.stringify),
        corrections.length,
        ...corrections.map(JSON.stringify),
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

    const el = { ...createShape({ position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }), id: 'e1' };
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
    expect(fromRedis.map((e) => e.id)).toEqual(['e1']);

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
    const el = { ...createShape({ position: { x: 5, y: 6 }, size: { w: 7, h: 8 } }), id: 'e1' };
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
      backend: new RedisHubBackend(fake),
      fanout,
      instanceId: 'hub-a',
    });
    const hubB = new SyncHub({
      backend: new RedisHubBackend(fake),
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
    expect((await new RedisHubBackend(fake).fogSnapshot('R'))?.meta.version).toBe(10);
    hubA.close();
    hubB.close();
  });
});
