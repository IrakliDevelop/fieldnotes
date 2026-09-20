import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { fogEncodeBase64 } from '@fieldnotes/vtt';
import {
  createFogBackendPlugin,
  FogBackendServiceKey,
  type FogBackendService,
} from '@fieldnotes/vtt/redis';
import { RedisHubBackend } from './index';
import type { RedisHashClient } from './index';
import type { FogMetaRecord, FogTileRecord } from '@fieldnotes/sync';

/**
 * Opt-in: runs the real fog Lua scripts against a real Redis. Without
 * `REDIS_URL` the whole suite is skipped, so the default test run needs no
 * server. Start one and point the variable at it to exercise EVALSHA, cjson
 * round-trips and real hash-field ordering:
 *
 *   REDIS_URL=redis://localhost:6379 pnpm --filter @fieldnotes/sync-redis test
 */
const redisUrl = process.env['REDIS_URL'];

type NodeRedisClient = ReturnType<typeof createClient>;

/** Normalizes every shape node-redis may return for HGETALL into a plain record. */
function toHash(reply: unknown): Record<string, string> {
  const hash: Record<string, string> = {};
  if (reply instanceof Map) {
    for (const [field, value] of reply) {
      if (typeof field === 'string' && typeof value === 'string') hash[field] = value;
    }
    return hash;
  }
  if (Array.isArray(reply)) {
    for (let i = 0; i + 1 < reply.length; i += 2) {
      const field = reply[i];
      const value = reply[i + 1];
      if (typeof field === 'string' && typeof value === 'string') hash[field] = value;
    }
    return hash;
  }
  if (typeof reply === 'object' && reply !== null) {
    for (const [field, value] of Object.entries(reply)) {
      if (typeof value === 'string') hash[field] = value;
    }
  }
  return hash;
}

/**
 * The adapter the README documents, including the optional `scriptLoad` /
 * `evalSha` pair — so this suite exercises the EVALSHA path of
 * `createScriptRunner`, not just plain EVAL.
 */
function fogHashClient(client: NodeRedisClient): RedisHashClient {
  return {
    hGetAll: async (key) => toHash(await client.hGetAll(key)),
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
  };
}

const definition = {
  version: 1 as const,
  generation: 'gen-1',
  bounds: { x: 0, y: 0, w: 256, h: 128 },
  cellSize: 1,
  tileCells: 128 as const,
  base: 'covered' as const,
};

/** A full-of-bits tile: base is `covered`, so an all-zero tile would be invalid. */
const data = fogEncodeBase64(new Uint8Array(2048).fill(0xff));

function tombstoneTile(x: number, version: number, editor: string): FogTileRecord {
  return { generation: 'gen-1', x, y: 0, version, editor };
}

function paintedTile(x: number, version: number, editor: string): FogTileRecord {
  return { generation: 'gen-1', x, y: 0, version, editor, data };
}

/** Redis returns hash fields in arbitrary order; compare on a stable order. */
function sortTiles(tiles: readonly FogTileRecord[]): FogTileRecord[] {
  return [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
}

describe.skipIf(!redisUrl)('fog persistence against a real Redis', () => {
  let connection: NodeRedisClient | undefined;
  let keyPrefix = '';
  let fog: FogBackendService;

  function client(): NodeRedisClient {
    if (!connection) throw new Error('the integration Redis client is not connected');
    return connection;
  }

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
    // A random prefix keeps parallel runs and leftover state out of each test.
    keyPrefix = `fieldnotes-it:${randomUUID()}:room:`;
    const hub = new RedisHubBackend(fogHashClient(client()), {
      keyPrefix,
      plugins: [createFogBackendPlugin()],
    });
    const service = hub.getService(FogBackendServiceKey);
    if (!service) throw new Error('fog backend plugin did not register its service');
    fog = service;
  });

  afterEach(async () => {
    const keys = await client().keys(`${keyPrefix}*`);
    if (keys.length > 0) await client().del(keys);
  });

  it('accepts a meta record and corrects an older one with the stored record', async () => {
    const winner: FogMetaRecord = { version: 10, editor: 'Z', definition };
    expect(await fog.applyMeta('R', winner)).toEqual({ accepted: true });

    expect(await fog.applyMeta('R', { version: 6, editor: 'A', definition })).toEqual({
      accepted: false,
      correction: winner,
    });
    expect((await fog.snapshot('R'))?.meta).toEqual(winner);
  });

  it('decides tile LWW per coordinate inside the script', async () => {
    await fog.applyMeta('R', { version: 1, editor: 'A', definition });

    const first = await fog.applyPatch('R', [paintedTile(0, 2, 'B'), paintedTile(1, 1, 'A')]);
    expect(sortTiles(first.accepted)).toEqual([paintedTile(0, 2, 'B'), paintedTile(1, 1, 'A')]);
    expect(first.corrections).toEqual([]);

    // (0,0) loses on version and is corrected; (1,0) wins and is accepted.
    const second = await fog.applyPatch('R', [paintedTile(0, 1, 'A'), tombstoneTile(1, 2, 'A')]);
    expect(second.accepted).toEqual([tombstoneTile(1, 2, 'A')]);
    expect(second.corrections).toEqual([paintedTile(0, 2, 'B')]);

    expect(sortTiles((await fog.snapshot('R'))?.tiles ?? [])).toEqual([
      paintedTile(0, 2, 'B'),
      tombstoneTile(1, 2, 'A'),
    ]);
  });

  it('holds the tiles hash at the 256-tile capacity', async () => {
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 258 * 128, h: 128 } };
    await fog.applyMeta('R', { version: 1, editor: 'A', definition: wide });

    const fill = await fog.applyPatch(
      'R',
      Array.from({ length: 255 }, (_, x) => tombstoneTile(x, 1, 'A')),
    );
    expect(fill.accepted).toHaveLength(255);
    expect(fill.corrections).toEqual([]);

    // 255 stored + 2 new would be 257: the whole patch becomes corrections.
    const overflow = await fog.applyPatch('R', [
      tombstoneTile(255, 1, 'A'),
      tombstoneTile(256, 1, 'A'),
    ]);
    expect(overflow.accepted).toEqual([]);
    expect(overflow.corrections).toHaveLength(2);
    expect((await fog.snapshot('R'))?.tiles).toHaveLength(255);

    // The 256th slot is still available to a patch that fits exactly.
    const lastSlot = await fog.applyPatch('R', [tombstoneTile(255, 1, 'A')]);
    expect(lastSlot.accepted).toEqual([tombstoneTile(255, 1, 'A')]);
    expect((await fog.snapshot('R'))?.tiles).toHaveLength(256);
  });

  // 20 rounds of four concurrent writes is ~250 round trips; give it room.
  it('never throws when meta and patch writes race', async () => {
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 4 * 128, h: 128 } };
    await fog.applyMeta('R', { version: 1, editor: 'A', definition: wide });

    for (let round = 0; round < 20; round += 1) {
      const version = round + 2;
      const results = await Promise.all([
        fog.applyMeta('R', { version, editor: 'A', definition: wide }),
        fog.applyPatch('R', [paintedTile(0, version, 'P')]),
        fog.applyMeta('R', { version, editor: 'B', definition: wide }),
        fog.applyPatch('R', [paintedTile(1, version, 'P')]),
      ]);
      expect(results).toHaveLength(4);
    }

    // `B` sorts above `A`, so the last round's `B` record is the winner.
    const snapshot = await fog.snapshot('R');
    expect(snapshot?.meta).toEqual({ version: 21, editor: 'B', definition: wide });
    expect(sortTiles(snapshot?.tiles ?? [])).toEqual([
      paintedTile(0, 21, 'P'),
      paintedTile(1, 21, 'P'),
    ]);
  }, 30_000);
});
