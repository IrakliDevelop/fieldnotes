import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuthorityMutation } from '@fieldnotes/sync';
import {
  FOG_AUTHORITY_REDIS_LIBRARY_V1,
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  assembleFogAuthorityRedisScriptV1,
  encodeFogAuthorityRedisIntentV1,
  parseFogAuthorityRedisPlanResultV1,
} from '../redis';
import { applyFogAuthorityIntent, prepareFogAuthorityIntent } from './fog-authority';
import { FogLedger } from './fog-ledger';
import type { FogAuthorityIntent } from './fog-authority';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from './fog-sync-types';
import { createTileBytes, encodeBase64, setBit } from './tile-codec';

const definition = (generation = 'generation-1', bounds = { x: 0, y: 0, w: 256, h: 128 }) => ({
  version: 1 as const,
  generation,
  bounds,
  cellSize: 1,
  tileCells: 128 as const,
  base: 'covered' as const,
});

const meta = (version = 1, editor = 'dm', generation = 'generation-1'): FogMetaRecord => ({
  version,
  editor,
  definition: definition(generation),
});

const data = (): string => {
  const bytes = createTileBytes(false);
  setBit(bytes, 0, 0, true);
  return encodeBase64(bytes);
};

const tile = (
  x = 0,
  version = 1,
  editor = 'dm',
  generation = 'generation-1',
  includeData = true,
): FogTileRecord => ({
  generation,
  x,
  y: 0,
  version,
  editor,
  ...(includeData ? { data: data() } : {}),
});

function intent(mutation: AuthorityMutation): FogAuthorityIntent {
  const prepared = prepareFogAuthorityIntent(mutation);
  if (prepared === null) throw new Error('fixture expected a fog intent');
  return prepared;
}

describe('fog authority Redis public boundary', () => {
  it('assembles the frozen library and trusted host with one exact newline', () => {
    const host = "return {'accepted', 'null'}";
    expect(assembleFogAuthorityRedisScriptV1(host)).toBe(
      `${FOG_AUTHORITY_REDIS_LIBRARY_V1}\n${host}`,
    );
    expect(assembleFogAuthorityRedisScriptV1('')).toBe(`${FOG_AUTHORITY_REDIS_LIBRARY_V1}\n`);
    expect(() => assembleFogAuthorityRedisScriptV1(new String(host) as never)).toThrow(TypeError);
    expect(() => assembleFogAuthorityRedisScriptV1('return 1\0')).toThrow(TypeError);
    expect(() => assembleFogAuthorityRedisScriptV1('é'.repeat(131_073))).toThrow(RangeError);
    expect(assembleFogAuthorityRedisScriptV1('x'.repeat(262_144))).toHaveLength(
      FOG_AUTHORITY_REDIS_LIBRARY_V1.length + 1 + 262_144,
    );
  });

  it('exports only the fixed planner/apply ABI and fixed Redis commands', () => {
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1.match(/local fn_fog_plan_v1\n/g)).toHaveLength(1);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1.match(/local fn_fog_apply_v1\n/g)).toHaveLength(1);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1.match(/fn_fog_plan_v1 = function\(/g)).toHaveLength(1);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1.match(/fn_fog_apply_v1 = function\(/g)).toHaveLength(1);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1).not.toMatch(/function\s+fn_fog_[^(]+_v[2-9]/);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1).not.toMatch(/redis\.call\s*\(\s*[a-zA-Z_]/);
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1).not.toContain('KEYS[');
    expect(FOG_AUTHORITY_REDIS_LIBRARY_V1).not.toContain('ARGV[');
    const applyStart = FOG_AUTHORITY_REDIS_LIBRARY_V1.indexOf('fn_fog_apply_v1 = function');
    const plannerSource = FOG_AUTHORITY_REDIS_LIBRARY_V1.slice(0, applyStart);
    const applySource = FOG_AUTHORITY_REDIS_LIBRARY_V1.slice(applyStart);
    expect(plannerSource).not.toMatch(/redis\.call\('(HSET|HDEL|DEL)'/);
    expect(plannerSource).not.toContain("redis.call('HGETALL'");
    expect(plannerSource).not.toContain("redis.call('HSCAN'");
    expect(
      [...plannerSource.matchAll(/redis\.call\('MEMORY', 'USAGE', ([^)]+)\)/g)].map(
        (match) => match[0],
      ),
    ).toEqual([
      "redis.call('MEMORY', 'USAGE', meta_key, 'SAMPLES', 0)",
      "redis.call('MEMORY', 'USAGE', tiles_key, 'SAMPLES', 0)",
    ]);
    expect(plannerSource).toContain("redis.call('HKEYS'");
    expect(plannerSource).toContain("redis.call('HSTRLEN'");
    expect(applySource).not.toMatch(/cjson|redis\.call\('(HGET|HGETALL|HLEN|TYPE)'/);
    expect([...applySource.matchAll(/redis\.call\('([^']+)'/g)].map((match) => match[1])).toEqual([
      'HSET',
      'HDEL',
      'HSET',
      'HDEL',
    ]);
  });

  it('encodes exact canonical intent bytes and rejects hostile shapes without invoking accessors', () => {
    const metaIntent = intent({ kind: 'fog-meta', record: meta() });
    const patchIntent = intent({
      kind: 'fog-patch',
      generation: 'generation-1',
      tiles: [tile(1, 2, 'b', 'generation-1', false), tile(0)],
    });
    expect(encodeFogAuthorityRedisIntentV1(metaIntent)).toBe(JSON.stringify(metaIntent));
    expect(encodeFogAuthorityRedisIntentV1(patchIntent)).toBe(JSON.stringify(patchIntent));

    const getter = vi.fn(() => 1);
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'schema', { value: 1, enumerable: true });
    Object.defineProperty(hostile, 'kind', { value: 'meta', enumerable: true });
    Object.defineProperty(hostile, 'record', { get: getter, enumerable: true });
    expect(() => encodeFogAuthorityRedisIntentV1(hostile as never)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(() => encodeFogAuthorityRedisIntentV1({ ...metaIntent, extra: true } as never)).toThrow(
      TypeError,
    );
    expect(() =>
      encodeFogAuthorityRedisIntentV1({
        schema: 1,
        kind: 'patch',
        generation: 'generation-1',
        tiles: [],
      }),
    ).toThrow(TypeError);
  });

  it('parses only the exact bounded diagnostic envelopes', () => {
    expect(parseFogAuthorityRedisPlanResultV1(['accepted', 'null'])).toEqual({
      status: 'accepted',
      nextStateJson: 'null',
    });
    expect(parseFogAuthorityRedisPlanResultV1(['rejected', 'conflict', 'null'])).toEqual({
      status: 'rejected',
      reason: 'conflict',
      currentStateJson: 'null',
    });

    const invalid: unknown[] = [
      null,
      {},
      ['accepted'],
      ['accepted', 'null', 'extra'],
      ['accepted', 1],
      ['accepted', 'x'.repeat(1_048_577)],
      ['rejected', 'other', 'null'],
      ['rejected', 'invalid'],
      ['rejected', 'invalid', 'null', 'extra'],
    ];
    for (const value of invalid) {
      expect(() => parseFogAuthorityRedisPlanResultV1(value)).toThrow(TypeError);
    }
    const getter = vi.fn(() => 'accepted');
    const hostile = ['accepted', 'null'];
    Object.defineProperty(hostile, '0', { get: getter, enumerable: true });
    expect(() => parseFogAuthorityRedisPlanResultV1(hostile)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps the legacy standalone Redis scripts byte-for-byte unchanged', () => {
    expect(createHash('sha256').update(FOG_META_LWW_SCRIPT).digest('hex')).toBe(
      'aef93a098b5fc600148100674ee97a9866100c3ea8b15d1c0123bbb25180a381',
    );
    expect(createHash('sha256').update(FOG_PATCH_LWW_SCRIPT).digest('hex')).toBe(
      '280c7401342997dd77865deef3e244f36714632d565446117d90e755db673644',
    );
  });
});

describe('shared fog authority parity corpus', () => {
  it('matches FogLedger state for wholly accepted operations and records equivalent rejections', () => {
    const operations: readonly AuthorityMutation[] = [
      { kind: 'fog-meta', record: meta() },
      {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile(1, 1, 'a', 'generation-1', false), tile(0)],
      },
      { kind: 'fog-meta', record: meta(2, 'dm', 'generation-2') },
      {
        kind: 'fog-patch',
        generation: 'generation-2',
        tiles: [tile(0, 1, 'a', 'generation-2', false)],
      },
    ];
    const ledger = new FogLedger();
    let authority: FogSnapshot | null = null;
    for (const mutation of operations) {
      const prepared = intent(mutation);
      const result = applyFogAuthorityIntent(authority, mutation, prepared);
      expect(result.status).toBe('accepted');
      if (result.status !== 'accepted') continue;
      authority = result.state;
      if (mutation.kind === 'fog-meta')
        expect(ledger.applyMeta(mutation.record).accepted).toBe(true);
      if (mutation.kind === 'fog-patch') {
        expect(ledger.applyPatch(mutation.tiles).accepted).toEqual(mutation.tiles);
      }
      const legacy = ledger.snapshot();
      expect(
        legacy
          ? { ...legacy, tiles: [...legacy.tiles].sort((a, b) => a.x - b.x || a.y - b.y) }
          : null,
      ).toEqual(authority);
    }

    const stale = { kind: 'fog-patch' as const, generation: 'generation-2', tiles: [tile(0)] };
    expect(applyFogAuthorityIntent(authority, stale, intent(stale))).toMatchObject({
      status: 'rejected',
      reason: 'generation-mismatch',
    });
    expect(ledger.applyPatch(stale.tiles).accepted).toEqual([]);
  });
});
