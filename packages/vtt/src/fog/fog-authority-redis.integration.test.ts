import { createHash, randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScriptRunner } from '@fieldnotes/sync-redis';
import type { RedisHashClient } from '@fieldnotes/sync-redis';
import type { AuthorityMutation } from '@fieldnotes/sync';
import {
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  assembleFogAuthorityRedisScriptV1,
  encodeFogAuthorityRedisIntentV1,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
  parseFogAuthorityRedisPlanResultV1,
} from '../redis';
import {
  applyFogAuthorityIntent,
  prepareFogAuthorityIntent,
  type FogAuthorityIntent,
} from './fog-authority';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from './fog-sync-types';
import { isValidFogMetaRecord } from './fog-sync-types';
import { FogLedger } from './fog-ledger';
import { createTileBytes, encodeBase64, setBit } from './tile-codec';

const redisUrl = process.env['REDIS_URL'];

type RespValue = string | number | Buffer | null | readonly RespValue[];

interface RespParsed {
  readonly value: RespValue;
  readonly cursor: number;
}

function lineEnd(buffer: Buffer, cursor: number): number {
  return buffer.indexOf('\r\n', cursor);
}

function parseResp(buffer: Buffer, cursor = 0): RespParsed | undefined {
  if (cursor >= buffer.length) return undefined;
  const prefix = String.fromCharCode(buffer[cursor] as number);
  const end = lineEnd(buffer, cursor + 1);
  if (end < 0) return undefined;
  const header = buffer.subarray(cursor + 1, end).toString('utf8');
  const body = end + 2;
  if (prefix === '+') return { value: header, cursor: body };
  if (prefix === '-') throw new Error(header);
  if (prefix === ':') return { value: Number(header), cursor: body };
  if (prefix === '$') {
    const length = Number(header);
    if (length === -1) return { value: null, cursor: body };
    if (!Number.isSafeInteger(length) || length < 0 || buffer.length < body + length + 2) {
      return undefined;
    }
    return { value: buffer.subarray(body, body + length), cursor: body + length + 2 };
  }
  if (prefix === '*') {
    const length = Number(header);
    if (length === -1) return { value: null, cursor: body };
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('invalid Redis array');
    const values: RespValue[] = [];
    let next = body;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseResp(buffer, next);
      if (!parsed) return undefined;
      values.push(parsed.value);
      next = parsed.cursor;
    }
    return { value: values, cursor: next };
  }
  throw new Error('unsupported Redis response');
}

function encodeCommand(arguments_: readonly (string | Buffer)[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${arguments_.length}\r\n`)];
  for (const argument of arguments_) {
    const value = typeof argument === 'string' ? Buffer.from(argument) : argument;
    chunks.push(Buffer.from(`$${value.byteLength}\r\n`), value, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

class RespClient {
  private readonly socket = new Socket();
  private buffer = Buffer.alloc(0);
  private readonly pending: {
    readonly resolve: (value: RespValue) => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  private failure: Error | undefined;

  async connect(urlText: string): Promise<void> {
    const url = new URL(urlText);
    if (url.protocol !== 'redis:') throw new Error('integration RESP client requires redis://');
    const port = url.port.length > 0 ? Number(url.port) : 6379;
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('close', () => this.fail(new Error('Redis connection closed')));
    await new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.connect(port, url.hostname, () => {
        this.socket.off('error', reject);
        resolve();
      });
    });
    if (url.password.length > 0) {
      await this.command(['AUTH', decodeURIComponent(url.password)]);
    }
    const database = url.pathname.slice(1);
    if (database.length > 0 && database !== '0') await this.command(['SELECT', database]);
  }

  command(arguments_: readonly (string | Buffer)[]): Promise<RespValue> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(arguments_), (error) => {
        if (error) this.fail(error);
      });
    });
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) return;
    await new Promise<void>((resolve) => {
      this.socket.once('close', resolve);
      this.socket.end();
    });
  }

  destroy(): void {
    this.socket.destroy();
  }

  private drain(): void {
    while (this.pending.length > 0) {
      let parsed: RespParsed | undefined;
      try {
        parsed = parseResp(this.buffer);
      } catch (error) {
        const next = this.pending.shift();
        next?.reject(error instanceof Error ? error : new Error(String(error)));
        this.buffer = Buffer.alloc(0);
        continue;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.cursor);
      this.pending.shift()?.resolve(parsed.value);
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    let next = this.pending.shift();
    while (next) {
      next.reject(error);
      next = this.pending.shift();
    }
  }
}

function text(value: RespValue): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  throw new Error('expected Redis string');
}

function normalized(value: RespValue): unknown {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(normalized);
  return value;
}

function hashClient(client: RespClient, onLoad?: (script: string) => void): RedisHashClient {
  return {
    hGetAll: async (key) => {
      const reply = await client.command(['HGETALL', key]);
      if (!Array.isArray(reply)) throw new Error('invalid HGETALL reply');
      const result: Record<string, string> = {};
      for (let index = 0; index + 1 < reply.length; index += 2) {
        const field = reply[index];
        const value = reply[index + 1];
        if (field !== undefined && value !== undefined) result[text(field)] = text(value);
      }
      return result;
    },
    hGet: async (key, field) => {
      const reply = await client.command(['HGET', key, field]);
      return reply === null ? null : text(reply);
    },
    hSet: (key, field, value) => client.command(['HSET', key, field, value]),
    hDel: (key, field) => client.command(['HDEL', key, field]),
    del: (key) => client.command(['DEL', key]),
    eval: async (script, options) =>
      normalized(
        await client.command([
          'EVAL',
          script,
          String(options.keys.length),
          ...options.keys,
          ...options.arguments,
        ]),
      ),
    scriptLoad: async (script) => {
      onLoad?.(script);
      return text(await client.command(['SCRIPT', 'LOAD', script]));
    },
    evalSha: async (sha, options) =>
      normalized(
        await client.command([
          'EVALSHA',
          sha,
          String(options.keys.length),
          ...options.keys,
          ...options.arguments,
        ]),
      ),
  };
}

const HOST_SOURCE = `local expected_types = {'hash', 'hash', 'hash', 'hash', 'hash', 'hash'}
for index = 1, #KEYS do
  local actual = redis.call('TYPE', KEYS[index])['ok']
  if actual ~= 'none' and actual ~= expected_types[index] then error('wrong key type') end
end
local fence = redis.call('HGET', KEYS[3], 'fence')
local guard = redis.call('HGET', KEYS[3], 'guard')
local revision_raw = redis.call('HGET', KEYS[3], 'revision')
local revision = tonumber(revision_raw)
local now = tonumber(ARGV[3])
local deadline = tonumber(ARGV[4])
if not guard or guard ~= ARGV[7] or not fence or fence ~= ARGV[2] or not revision or revision < 0
  or revision ~= math.floor(revision) or tostring(revision) ~= revision_raw
  or not now or not deadline or now ~= math.floor(now) or deadline ~= math.floor(deadline)
  or now > deadline then return {'rejected', 'invalid', 'null'} end
local prior_digest = redis.call('HGET', KEYS[6], ARGV[5])
if prior_digest then
  local prior_state = redis.call('HGET', KEYS[4], ARGV[5])
  if prior_digest == ARGV[6] and prior_state then return {'accepted', prior_state} end
  return {'rejected', 'invalid', 'null'}
end
local plan = fn_fog_plan_v1(KEYS[1], KEYS[2], ARGV[1])
if plan[1] == 0 then return {'rejected', plan[2], plan[3]} end
local next_revision = revision + 1
fn_fog_apply_v1(KEYS[1], KEYS[2], plan)
redis.call('HSET', KEYS[3], 'revision', tostring(next_revision))
redis.call('HSET', KEYS[4], ARGV[5], plan[2])
redis.call('HSET', KEYS[5], tostring(next_revision), ARGV[5])
redis.call('HSET', KEYS[6], ARGV[5], ARGV[6])
return {'accepted', plan[2]}`;

const SCRIPT = assembleFogAuthorityRedisScriptV1(HOST_SOURCE);

const definition = (
  generation = 'generation-1',
  bounds = { x: 0, y: 0, w: 257 * 128, h: 128 },
) => ({
  version: 1 as const,
  generation,
  bounds,
  cellSize: 1,
  tileCells: 128 as const,
  base: 'covered' as const,
});

const meta = (version = 1, generation = 'generation-1'): FogMetaRecord => ({
  version,
  editor: 'dm',
  definition: definition(generation),
});

const paintedData = (): string => {
  const bytes = createTileBytes(false);
  setBit(bytes, 0, 0, true);
  return encodeBase64(bytes);
};

const tile = (x = 0, version = 1, generation = 'generation-1', data?: string): FogTileRecord => ({
  generation,
  x,
  y: 0,
  version,
  editor: 'dm',
  ...(data === undefined ? {} : { data }),
});

function prepared(mutation: AuthorityMutation): FogAuthorityIntent {
  const result = prepareFogAuthorityIntent(mutation);
  if (result === null) throw new Error('fixture expected fog intent');
  return result;
}

interface RoomKeys {
  readonly all: readonly [string, string, string, string, string, string];
  readonly meta: string;
  readonly tiles: string;
  readonly authority: string;
  readonly receipt: string;
  readonly outbox: string;
  readonly dedupe: string;
}

function roomKeys(component: string): RoomKeys {
  const slot = `{${component}}`;
  const all = [
    `fieldnotes-it:${slot}:fog:meta`,
    `fieldnotes-it:${slot}:fog:tiles`,
    `fieldnotes-it:${slot}:authority`,
    `fieldnotes-it:${slot}:receipt`,
    `fieldnotes-it:${slot}:outbox`,
    `fieldnotes-it:${slot}:dedupe`,
  ] as const;
  return {
    all,
    meta: all[0],
    tiles: all[1],
    authority: all[2],
    receipt: all[3],
    outbox: all[4],
    dedupe: all[5],
  };
}

describe.skipIf(!redisUrl)('fog authority composition against a real Redis', () => {
  let connection: RespClient;
  let loads: string[];
  let run: ReturnType<typeof createScriptRunner>;

  beforeAll(async () => {
    connection = new RespClient();
    await connection.connect(redisUrl as string);
    loads = [];
    run = createScriptRunner(hashClient(connection, (script) => loads.push(script)));
  });

  afterAll(async () => {
    if (connection) await connection.close();
  });

  async function initialize(keys: RoomKeys, state: FogSnapshot | null = null): Promise<void> {
    await connection.command(['DEL', ...keys.all]);
    await connection.command([
      'HSET',
      keys.authority,
      'guard',
      'allow',
      'fence',
      '7',
      'revision',
      '0',
    ]);
    if (state) {
      await connection.command(['HSET', keys.meta, 'current', JSON.stringify(state.meta)]);
      for (const record of state.tiles) {
        await connection.command([
          'HSET',
          keys.tiles,
          `${record.x},${record.y}`,
          JSON.stringify(record),
        ]);
      }
    }
  }

  async function snapshot(keys: RoomKeys): Promise<readonly (string | null)[]> {
    return Promise.all(
      keys.all.map(async (key) => {
        const value = await connection.command(['DUMP', key]);
        return value === null ? null : (value as Buffer).toString('base64');
      }),
    );
  }

  async function readFog(keys: RoomKeys): Promise<FogSnapshot | null> {
    const metaRaw = await connection.command(['HGET', keys.meta, 'current']);
    if (metaRaw === null) return null;
    const metaRecord = JSON.parse(text(metaRaw)) as FogMetaRecord;
    const rawTiles = await connection.command(['HGETALL', keys.tiles]);
    if (!Array.isArray(rawTiles)) throw new Error('invalid tiles reply');
    const tiles: FogTileRecord[] = [];
    for (let index = 1; index < rawTiles.length; index += 2) {
      const raw = rawTiles[index];
      if (raw !== undefined) tiles.push(JSON.parse(text(raw)) as FogTileRecord);
    }
    tiles.sort((left, right) => left.x - right.x || left.y - right.y);
    return { meta: metaRecord, tiles };
  }

  async function execute(
    keys: RoomKeys,
    intentJson: string,
    operation: string = randomUUID(),
    digest = createHash('sha256').update(intentJson).digest('hex'),
    controls: {
      readonly guard?: string;
      readonly fence?: string;
      readonly now?: string;
      readonly deadline?: string;
    } = {},
  ): Promise<ReturnType<typeof parseFogAuthorityRedisPlanResultV1>> {
    const raw = await run(SCRIPT, {
      keys: [...keys.all],
      arguments: [
        intentJson,
        controls.fence ?? '7',
        controls.now ?? '100',
        controls.deadline ?? '200',
        operation,
        digest,
        controls.guard ?? 'allow',
      ],
    });
    return parseFogAuthorityRedisPlanResultV1(raw);
  }

  function encoded(mutation: AuthorityMutation): string {
    return encodeFogAuthorityRedisIntentV1(prepared(mutation));
  }

  function applyIntentJson(
    current: FogSnapshot | null,
    intentJson: string,
  ): ReturnType<typeof applyFogAuthorityIntent> {
    let raw: unknown;
    try {
      raw = JSON.parse(intentJson) as unknown;
    } catch {
      return { status: 'rejected', reason: 'invalid', current };
    }
    if (typeof raw !== 'object' || raw === null) {
      return { status: 'rejected', reason: 'invalid', current };
    }
    const candidate = raw as Record<string, unknown>;
    const mutation =
      candidate['kind'] === 'meta'
        ? { kind: 'fog-meta', record: candidate['record'] }
        : {
            kind: 'fog-patch',
            generation: candidate['generation'],
            tiles: candidate['tiles'],
          };
    return applyFogAuthorityIntent(
      current,
      mutation as AuthorityMutation,
      raw as FogAuthorityIntent,
    );
  }

  async function executeLegacy(keys: RoomKeys, mutation: AuthorityMutation): Promise<unknown> {
    if (mutation.kind === 'fog-meta') {
      return parseFogRedisMetaResult(
        await run(FOG_META_LWW_SCRIPT, {
          keys: [keys.meta, keys.tiles],
          arguments: [JSON.stringify(mutation.record), '[]'],
        }),
        isValidFogMetaRecord,
      );
    }
    if (mutation.kind === 'fog-patch') {
      return parseFogRedisPatchResult(
        await run(FOG_PATCH_LWW_SCRIPT, {
          keys: [keys.meta, keys.tiles],
          arguments: [JSON.stringify(mutation.tiles)],
        }),
      );
    }
    throw new Error('fixture expected a fog mutation');
  }

  it('leaves every declared key byte-identical for the full rejection matrix', async () => {
    const keys = roomKeys(randomUUID());
    const current: FogSnapshot = { meta: meta(), tiles: [tile(0, 2)] };
    const validPatch = prepared({
      kind: 'fog-patch',
      generation: 'generation-1',
      tiles: [tile(1, 1)],
    });
    const validJson = encodeFogAuthorityRedisIntentV1(validPatch);
    const validObject = JSON.parse(validJson) as {
      schema: 1;
      kind: 'patch';
      generation: string;
      tiles: FogTileRecord[];
    };
    const sixtyFour = encoded({
      kind: 'fog-patch',
      generation: 'generation-1',
      tiles: Array.from({ length: 64 }, (_, index) => tile(index + 1, 3)),
    });
    const sixtyFiveObject = JSON.parse(sixtyFour) as typeof validObject;
    sixtyFiveObject.tiles.push(tile(65, 3));
    const duplicateObject = structuredClone(validObject);
    duplicateObject.tiles.push(duplicateObject.tiles[0] as FogTileRecord);
    const noncanonicalObject = structuredClone(validObject);
    noncanonicalObject.tiles[0] = tile(1, 1, 'generation-1', encodeBase64(createTileBytes(false)));
    const cases: readonly {
      readonly name: string;
      readonly intentJson: string;
      readonly expected: string;
      readonly controls?: {
        readonly guard?: string;
        readonly fence?: string;
        readonly now?: string;
        readonly deadline?: string;
      };
    }[] = [
      { name: 'guard', intentJson: validJson, expected: 'invalid', controls: { guard: 'deny' } },
      { name: 'stale fence', intentJson: validJson, expected: 'invalid', controls: { fence: '8' } },
      { name: 'deadline', intentJson: validJson, expected: 'invalid', controls: { now: '201' } },
      { name: 'malformed', intentJson: validJson.slice(0, -1), expected: 'invalid' },
      {
        name: 'no definition',
        intentJson: validJson,
        expected: 'generation-mismatch',
      },
      {
        name: 'wrong generation',
        intentJson: encoded({
          kind: 'fog-patch',
          generation: 'generation-2',
          tiles: [tile(1, 1, 'generation-2')],
        }),
        expected: 'generation-mismatch',
      },
      {
        name: 'out of bounds',
        intentJson: encoded({
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [tile(300)],
        }),
        expected: 'invalid',
      },
      {
        name: 'noncanonical',
        intentJson: JSON.stringify(noncanonicalObject),
        expected: 'invalid',
      },
      {
        name: 'stale',
        intentJson: encoded({
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [tile(0, 1)],
        }),
        expected: 'conflict',
      },
      {
        name: 'duplicate',
        intentJson: JSON.stringify(duplicateObject),
        expected: 'invalid',
      },
      {
        name: 'empty',
        intentJson: JSON.stringify({ ...validObject, tiles: [] }),
        expected: 'invalid',
      },
      { name: '65 tiles', intentJson: JSON.stringify(sixtyFiveObject), expected: 'invalid' },
    ];

    for (const testCase of cases) {
      const state = testCase.name === 'no definition' ? null : current;
      await initialize(keys, state);
      const before = await snapshot(keys);
      const result = await execute(
        keys,
        testCase.intentJson,
        randomUUID(),
        undefined,
        testCase.controls,
      );
      expect(result, testCase.name).toMatchObject({
        status: 'rejected',
        reason: testCase.expected,
      });
      if (!['guard', 'stale fence', 'deadline'].includes(testCase.name)) {
        const jsResult = applyIntentJson(state, testCase.intentJson);
        expect(jsResult, `${testCase.name} JS parity`).toMatchObject({
          status: 'rejected',
          reason: testCase.expected,
        });
        if (result.status === 'rejected' && jsResult.status === 'rejected') {
          expect(JSON.parse(result.currentStateJson), `${testCase.name} state parity`).toEqual(
            jsResult.current,
          );
        }
      }
      expect(await snapshot(keys), testCase.name).toEqual(before);
    }

    const full: FogSnapshot = {
      meta: meta(),
      tiles: Array.from({ length: 256 }, (_, index) => tile(index, 1)),
    };
    await initialize(keys, full);
    const beforeOverflow = await snapshot(keys);
    const overflow = await execute(
      keys,
      encoded({
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile(256, 1)],
      }),
    );
    expect(overflow).toMatchObject({ status: 'rejected', reason: 'overloaded' });
    expect(
      applyIntentJson(
        full,
        encoded({
          kind: 'fog-patch',
          generation: 'generation-1',
          tiles: [tile(256, 1)],
        }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'overloaded' });
    expect(await snapshot(keys)).toEqual(beforeOverflow);
  }, 30_000);

  it('matches the JS transition and advances fog, revision, receipt and outbox exactly once', async () => {
    const keys = roomKeys(randomUUID());
    await initialize(keys);
    const metaMutation = { kind: 'fog-meta' as const, record: meta() };
    const metaIntent = prepared(metaMutation);
    const metaResult = await execute(keys, encodeFogAuthorityRedisIntentV1(metaIntent), 'meta-op');
    const jsMeta = applyFogAuthorityIntent(null, metaMutation, metaIntent);
    expect(metaResult.status).toBe('accepted');
    if (metaResult.status === 'accepted' && jsMeta.status === 'accepted') {
      expect(metaResult.nextStateJson).toBe(JSON.stringify(jsMeta.state));
    }
    expect(
      JSON.parse(metaResult.status === 'accepted' ? metaResult.nextStateJson : 'null'),
    ).toEqual(jsMeta.status === 'accepted' ? jsMeta.state : null);

    const patchMutation = {
      kind: 'fog-patch' as const,
      generation: 'generation-1',
      tiles: [tile(2, 1), tile(0, 1, 'generation-1', paintedData())],
    };
    const patchIntent = prepared(patchMutation);
    const patchJson = encodeFogAuthorityRedisIntentV1(patchIntent);
    const patchResult = await execute(keys, patchJson, 'patch-op');
    const jsPatch = applyFogAuthorityIntent(
      jsMeta.status === 'accepted' ? jsMeta.state : null,
      patchMutation,
      patchIntent,
    );
    expect(patchResult.status).toBe('accepted');
    if (patchResult.status === 'accepted' && jsPatch.status === 'accepted') {
      expect(patchResult.nextStateJson).toBe(JSON.stringify(jsPatch.state));
    }
    expect(
      JSON.parse(patchResult.status === 'accepted' ? patchResult.nextStateJson : 'null'),
    ).toEqual(jsPatch.status === 'accepted' ? jsPatch.state : null);
    expect(text(await connection.command(['HGET', keys.authority, 'revision']))).toBe('2');
    expect(Number(await connection.command(['HLEN', keys.receipt]))).toBe(2);
    expect(Number(await connection.command(['HLEN', keys.outbox]))).toBe(2);
    expect(Number(await connection.command(['HLEN', keys.dedupe]))).toBe(2);

    const beforeRetry = await snapshot(keys);
    const retry = await execute(keys, patchJson, 'patch-op');
    expect(retry).toEqual(patchResult);
    expect(await snapshot(keys)).toEqual(beforeRetry);
    const digestMismatch = await execute(keys, patchJson, 'patch-op', 'different-digest');
    expect(digestMismatch).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(await snapshot(keys)).toEqual(beforeRetry);
  });

  it('runs the shared accepted and correction corpus through JS, memory, legacy Redis and Lua', async () => {
    const authorityKeys = roomKeys(randomUUID());
    const legacyKeys = roomKeys(randomUUID());
    await initialize(authorityKeys);
    await initialize(legacyKeys);
    const ledger = new FogLedger();
    let jsState: FogSnapshot | null = null;
    const acceptedOperations: readonly AuthorityMutation[] = [
      { kind: 'fog-meta', record: meta() },
      {
        kind: 'fog-patch',
        generation: 'generation-1',
        tiles: [tile(2, 1), tile(0, 1, 'generation-1', paintedData())],
      },
      { kind: 'fog-meta', record: meta(2, 'generation-2') },
      {
        kind: 'fog-patch',
        generation: 'generation-2',
        tiles: [tile(1, 1, 'generation-2')],
      },
    ];

    for (const mutation of acceptedOperations) {
      const authorityIntent = prepared(mutation);
      const jsResult = applyFogAuthorityIntent(jsState, mutation, authorityIntent);
      expect(jsResult.status).toBe('accepted');
      if (jsResult.status !== 'accepted') continue;
      jsState = jsResult.state;
      const luaResult = await execute(
        authorityKeys,
        encodeFogAuthorityRedisIntentV1(authorityIntent),
      );
      expect(luaResult.status).toBe('accepted');
      const legacyResult = await executeLegacy(legacyKeys, mutation);
      if (mutation.kind === 'fog-meta') {
        expect(ledger.applyMeta(mutation.record).accepted).toBe(true);
        expect(legacyResult).toEqual({ accepted: true });
      } else if (mutation.kind === 'fog-patch') {
        expect(ledger.applyPatch(mutation.tiles).accepted).toEqual(mutation.tiles);
        expect(legacyResult).toMatchObject({ accepted: mutation.tiles, corrections: [] });
      }
      const memory = ledger.snapshot();
      const sortedMemory = memory
        ? { ...memory, tiles: [...memory.tiles].sort((a, b) => a.x - b.x || a.y - b.y) }
        : null;
      expect(await readFog(authorityKeys)).toEqual(jsState);
      expect(await readFog(legacyKeys)).toEqual(jsState);
      expect(sortedMemory).toEqual(jsState);
    }

    const stale = {
      kind: 'fog-patch' as const,
      generation: 'generation-2',
      tiles: [tile(1, 1, 'generation-2'), tile(2, 1, 'generation-2')],
    };
    const staleIntent = prepared(stale);
    const jsRejected = applyFogAuthorityIntent(jsState, stale, staleIntent);
    const authorityBefore = await snapshot(authorityKeys);
    const luaRejected = await execute(authorityKeys, encodeFogAuthorityRedisIntentV1(staleIntent));
    const memoryEvidence = ledger.applyPatch(stale.tiles);
    const legacyEvidence = await executeLegacy(legacyKeys, stale);
    expect(jsRejected).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(luaRejected).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await snapshot(authorityKeys)).toEqual(authorityBefore);
    expect(memoryEvidence.accepted).toEqual([stale.tiles[1]]);
    expect(memoryEvidence.corrections).toEqual([stale.tiles[0]]);
    expect(legacyEvidence).toMatchObject({
      accepted: [stale.tiles[1]],
      corrections: [stale.tiles[0]],
    });
  });

  it('isolates rooms, accepts hostile key components, and reloads the complete script after NOSCRIPT', async () => {
    const first = roomKeys(`${randomUUID()}}:evil\ncomponent`);
    const second = roomKeys(randomUUID());
    await initialize(first);
    await initialize(second);
    const intentJson = encoded({ kind: 'fog-meta', record: meta() });
    const secondBefore = await snapshot(second);
    await execute(first, intentJson, 'first');
    expect(await snapshot(second)).toEqual(secondBefore);

    const expectedSha = createHash('sha1').update(SCRIPT).digest('hex');
    const completeLoadsBeforeFlush = loads.filter((source) => source === SCRIPT).length;
    expect(completeLoadsBeforeFlush).toBeGreaterThan(0);
    expect(await connection.command(['SCRIPT', 'EXISTS', expectedSha])).toEqual([1]);
    await connection.command(['SCRIPT', 'FLUSH']);
    await execute(first, encoded({ kind: 'fog-meta', record: meta(2) }), 'second');
    expect(loads.filter((source) => source === SCRIPT)).toHaveLength(completeLoadsBeforeFlush + 1);
    expect(loads[loads.length - 1]).toBe(SCRIPT);
    expect(await connection.command(['SCRIPT', 'EXISTS', expectedSha])).toEqual([1]);
  });

  it('fails before writes on a wrong Redis key type', async () => {
    const keys = roomKeys(randomUUID());
    await initialize(keys);
    await connection.command(['SET', keys.tiles, 'wrong-type']);
    const before = await snapshot(keys);
    await expect(execute(keys, encoded({ kind: 'fog-meta', record: meta() }))).rejects.toThrow(
      'wrong key type',
    );
    expect(await snapshot(keys)).toEqual(before);
  });

  it('rejects malformed and oversized stored hashes before bounded fetch/decode', async () => {
    const keys = roomKeys(randomUUID());
    const incoming = encoded({ kind: 'fog-meta', record: meta(2) });
    const corruptions: readonly {
      readonly name: string;
      readonly apply: () => Promise<unknown>;
    }[] = [
      {
        name: 'oversized metadata value',
        apply: () =>
          connection.command(['HSET', keys.meta, 'current', 'x'.repeat(2 * 1024 * 1024)]),
      },
      {
        name: 'malformed metadata JSON',
        apply: () => connection.command(['HSET', keys.meta, 'current', '{']),
      },
      {
        name: 'unexpected metadata field',
        apply: async () => {
          await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
          return connection.command(['HSET', keys.meta, 'unexpected', 'x']);
        },
      },
      {
        name: 'oversized tile value',
        apply: async () => {
          await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
          return connection.command(['HSET', keys.tiles, '0,0', 'x'.repeat(2 * 1024 * 1024)]);
        },
      },
      {
        name: 'malformed tile JSON',
        apply: async () => {
          await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
          return connection.command(['HSET', keys.tiles, '0,0', '{']);
        },
      },
      {
        name: 'oversized hostile tile field',
        apply: async () => {
          await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
          return connection.command([
            'HSET',
            keys.tiles,
            '9'.repeat(3 * 1024 * 1024),
            JSON.stringify(tile()),
          ]);
        },
      },
      {
        name: 'oversized total state bytes',
        apply: async () => {
          await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
          for (let index = 0; index < 256; index += 1) {
            await connection.command(['HSET', keys.tiles, `${index},0`, 'x'.repeat(4_090)]);
          }
          return undefined;
        },
      },
    ];

    for (const corruption of corruptions) {
      await initialize(keys);
      await corruption.apply();
      const before = await snapshot(keys);
      const result = await execute(keys, incoming);
      expect(result, corruption.name).toEqual({
        status: 'rejected',
        reason: 'invalid',
        currentStateJson: 'null',
      });
      expect(await snapshot(keys), corruption.name).toEqual(before);
    }

    const nearLimit: FogSnapshot = {
      meta: {
        version: 1,
        editor: 'dm',
        definition: definition('generation-1', {
          x: 0,
          y: 0,
          w: 256 * 128,
          h: 128,
        }),
      },
      tiles: Array.from({ length: 256 }, (_, x) => tile(x, 1, 'generation-1', paintedData())),
    };
    await initialize(keys, nearLimit);
    const before = await snapshot(keys);
    const started = performance.now();
    const result = await execute(keys, encoded({ kind: 'fog-meta', record: nearLimit.meta }));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await snapshot(keys)).toEqual(before);
  }, 30_000);

  it('rejects a heterogeneous tile hash whose oversized field is missed by default sampling', async () => {
    const keys = roomKeys(randomUUID());
    await initialize(keys);
    await connection.command(['HSET', keys.meta, 'current', JSON.stringify(meta())]);
    for (let index = 0; index < 255; index += 1) {
      await connection.command(['HSET', keys.tiles, `${index},0`, 'x']);
    }
    await connection.command([
      'HSET',
      keys.tiles,
      '9'.repeat(3 * 1024 * 1024),
      JSON.stringify(tile()),
    ]);

    expect(await connection.command(['HLEN', keys.tiles])).toBe(256);
    expect(Number(await connection.command(['MEMORY', 'USAGE', keys.tiles]))).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    );
    expect(
      Number(await connection.command(['MEMORY', 'USAGE', keys.tiles, 'SAMPLES', '0'])),
    ).toBeGreaterThan(2 * 1024 * 1024);

    const before = await snapshot(keys);
    const result = await execute(keys, encoded({ kind: 'fog-meta', record: meta(2) }));
    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid',
      currentStateJson: 'null',
    });
    expect(await snapshot(keys)).toEqual(before);
  }, 30_000);

  it('preserves the full Task 2 numeric domain and subsequent persisted semantics', async () => {
    async function acceptWithParity(
      keys: RoomKeys,
      current: FogSnapshot | null,
      mutation: AuthorityMutation,
      operation: string,
    ): Promise<FogSnapshot | null> {
      const authorityIntent = prepared(mutation);
      const jsResult = applyFogAuthorityIntent(current, mutation, authorityIntent);
      expect(jsResult.status, `${operation} JS`).toBe('accepted');
      if (jsResult.status !== 'accepted') return current;
      const luaResult = await execute(
        keys,
        encodeFogAuthorityRedisIntentV1(authorityIntent),
        operation,
      );
      expect(luaResult.status, `${operation} Lua`).toBe('accepted');
      if (luaResult.status !== 'accepted') return current;
      expect(luaResult.nextStateJson, `${operation} canonical bytes`).toBe(
        JSON.stringify(jsResult.state),
      );
      expect(JSON.parse(luaResult.nextStateJson), `${operation} parsed state`).toEqual(
        jsResult.state,
      );
      expect(await readFog(keys), `${operation} persisted state`).toEqual(jsResult.state);
      return jsResult.state;
    }

    const precisionKeys = roomKeys(randomUUID());
    await initialize(precisionKeys);
    const preciseMeta: FogMetaRecord = {
      version: 123_456_789_012_345,
      editor: 'precision',
      definition: {
        version: 1,
        generation: 'precise-generation',
        bounds: {
          x: 0.12345678901234568,
          y: -0.9876543210987654,
          w: 32768.12345678901,
          h: 128.00000000000003,
        },
        cellSize: 1.0000000000000002,
        tileCells: 128,
        base: 'covered',
      },
    };
    let precisionState = await acceptWithParity(
      precisionKeys,
      null,
      { kind: 'fog-meta', record: preciseMeta },
      'precise-meta',
    );
    const staleMeta = { ...preciseMeta, version: 123_456_789_012_344 };
    const staleIntent = prepared({ kind: 'fog-meta', record: staleMeta });
    const staleResult = await execute(
      precisionKeys,
      encodeFogAuthorityRedisIntentV1(staleIntent),
      'precise-stale',
    );
    expect(staleResult).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(
      applyFogAuthorityIntent(precisionState, { kind: 'fog-meta', record: staleMeta }, staleIntent),
    ).toMatchObject({ status: 'rejected', reason: 'conflict' });
    precisionState = await acceptWithParity(
      precisionKeys,
      precisionState,
      { kind: 'fog-meta', record: { ...preciseMeta, version: 123_456_789_012_346 } },
      'precise-newer',
    );

    const coordinateKeys = roomKeys(randomUUID());
    await initialize(coordinateKeys);
    const coordinateMeta: FogMetaRecord = {
      version: Number.MAX_SAFE_INTEGER - 1,
      editor: 'coordinates',
      definition: {
        version: 1,
        generation: 'coordinate-generation',
        bounds: { x: -1e-305, y: -1, w: 2e-305, h: 2 },
        cellSize: Number.MIN_VALUE,
        tileCells: 128,
        base: 'covered',
      },
    };
    let coordinateState = await acceptWithParity(
      coordinateKeys,
      null,
      { kind: 'fog-meta', record: coordinateMeta },
      'coordinate-meta',
    );
    coordinateState = await acceptWithParity(
      coordinateKeys,
      coordinateState,
      {
        kind: 'fog-patch',
        generation: 'coordinate-generation',
        tiles: [
          {
            generation: 'coordinate-generation',
            x: Number.MIN_SAFE_INTEGER,
            y: 0,
            version: Number.MAX_SAFE_INTEGER - 1,
            editor: 'negative',
          },
          {
            generation: 'coordinate-generation',
            x: Number.MAX_SAFE_INTEGER,
            y: 0,
            version: Number.MAX_SAFE_INTEGER,
            editor: 'positive',
          },
        ],
      },
      'max-safe-coordinates',
    );

    const hugeKeys = roomKeys(randomUUID());
    await initialize(hugeKeys);
    const hugeMeta: FogMetaRecord = {
      version: 9_007_199_254_740_991,
      editor: 'huge',
      definition: {
        version: 1,
        generation: 'huge-generation',
        bounds: { x: 0, y: 0, w: 1e308, h: 1e308 },
        cellSize: 1e308,
        tileCells: 128,
        base: 'covered',
      },
    };
    let hugeState = await acceptWithParity(
      hugeKeys,
      null,
      { kind: 'fog-meta', record: hugeMeta },
      'huge-meta',
    );
    hugeState = await acceptWithParity(
      hugeKeys,
      hugeState,
      {
        kind: 'fog-patch',
        generation: 'huge-generation',
        tiles: [
          {
            generation: 'huge-generation',
            x: 0,
            y: 0,
            version: 9_007_199_254_740_991,
            editor: 'huge',
          },
        ],
      },
      'overflow-intersection',
    );
    expect(precisionState?.meta.version).toBe(123_456_789_012_346);
    expect(coordinateState?.tiles).toHaveLength(2);
    expect(hugeState?.tiles).toHaveLength(1);
  });

  it('surfaces a network failure without a false accepted result', async () => {
    const isolated = new RespClient();
    await isolated.connect(redisUrl as string);
    const isolatedRun = createScriptRunner(hashClient(isolated));
    isolated.destroy();
    await expect(
      isolatedRun(SCRIPT, {
        keys: [...roomKeys(randomUUID()).all],
        arguments: [
          encoded({ kind: 'fog-meta', record: meta() }),
          '7',
          '100',
          '200',
          'op',
          'd',
          'allow',
        ],
      }),
    ).rejects.toThrow();
  });
});
