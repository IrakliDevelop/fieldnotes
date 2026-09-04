import {
  isValidElement,
  isValidLayerRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  isValidFogSnapshot,
  type LayerRecord,
  type SyncOp,
  type FogSnapshot,
  type FogMetaRecord,
  type FogTileRecord,
} from '@fieldnotes/sync';
import { canonicalizeFogTile, type CanvasElement } from '@fieldnotes/core';
import type { FogApplyResult, FogPatchApplyResult, HubBackend } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';

export interface RedisHubBackendOptions {
  keyPrefix?: string; // default 'fieldnotes:room:'
}

export class RedisHubBackend implements HubBackend {
  readonly sharedAcrossInstances = true;
  private readonly client: RedisHashClient;
  private readonly keyPrefix: string;

  constructor(client: RedisHashClient, options: RedisHubBackendOptions = {}) {
    this.client = client;
    this.keyPrefix = options.keyPrefix ?? 'fieldnotes:room:';
  }

  private key(room: string): string {
    return `${this.keyPrefix}${room}`;
  }

  private layersKey(room: string): string {
    return `${this.keyPrefix}${room}:layers`;
  }

  async snapshot(room: string): Promise<CanvasElement[]> {
    const map = await this.client.hGetAll(this.key(room));
    const out: CanvasElement[] = [];
    for (const value of Object.values(map)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue; // skip a corrupt stored value rather than throwing the whole snapshot
      }
      if (isValidElement(parsed)) out.push(parsed);
    }
    return out;
  }

  async get(room: string, id: string): Promise<CanvasElement | undefined> {
    const value = await this.client.hGet(this.key(room), id);
    if (value == null) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      return isValidElement(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async apply(room: string, op: SyncOp): Promise<void> {
    const key = this.key(room);
    if (op.kind === 'upsert')
      await this.client.hSet(key, op.element.id, JSON.stringify(op.element));
    else if (op.kind === 'remove') await this.client.hDel(key, op.id);
    // 'clear' deletes elements only; the layer ledger is a separate hash and survives.
    else if (op.kind === 'clear') await this.client.del(key);
    // request-snapshot/snapshot never reach apply (the hub only applies data ops)
  }

  async layerRecords(room: string): Promise<LayerRecord[]> {
    const map = await this.client.hGetAll(this.layersKey(room));
    const out: LayerRecord[] = [];
    for (const value of Object.values(map)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue; // skip a corrupt stored value rather than throwing the whole ledger
      }
      if (isValidLayerRecord(parsed)) out.push(parsed);
    }
    return out;
  }

  async getLayerRecord(room: string, id: string): Promise<LayerRecord | undefined> {
    const value = await this.client.hGet(this.layersKey(room), id);
    if (value == null) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      return isValidLayerRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async applyLayerRecord(room: string, record: LayerRecord): Promise<void> {
    await this.client.hSet(this.layersKey(room), record.id, JSON.stringify(record));
  }

  private fogMetaKey(room: string): string {
    return `${this.keyPrefix}${room}:fog:meta`;
  }

  private fogTilesKey(room: string): string {
    return `${this.keyPrefix}${room}:fog:tiles`;
  }

  async fogSnapshot(room: string): Promise<FogSnapshot | undefined> {
    const metaStr = await this.client.hGet(this.fogMetaKey(room), 'current');
    if (metaStr == null) return undefined;
    let meta: unknown;
    try {
      meta = JSON.parse(metaStr);
    } catch {
      return undefined;
    }
    if (!isValidFogMetaRecord(meta)) return undefined;

    if (!(meta as FogMetaRecord).definition) return { meta: meta as FogMetaRecord, tiles: [] };

    const definition = (meta as FogMetaRecord).definition;
    if (!definition) return { meta: meta as FogMetaRecord, tiles: [] };
    const tileMap = await this.client.hGetAll(this.fogTilesKey(room));
    const tiles: FogTileRecord[] = [];
    const seen = new Set<string>();
    for (const value of Object.values(tileMap)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      if (!isValidFogTileRecord(parsed)) continue;
      if (parsed.generation !== definition.generation) continue;
      if (!tileIntersectsDefinition(parsed.x, parsed.y, definition)) continue;
      if (!isValidFogSnapshot({ meta: meta as FogMetaRecord, tiles: [parsed] })) continue;
      const key = `${parsed.x},${parsed.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(parsed);
      if (tiles.length === 256) break;
    }

    const snapshot = { meta: meta as FogMetaRecord, tiles };
    return isValidFogSnapshot(snapshot) ? snapshot : undefined;
  }

  async applyFogMeta(room: string, record: FogMetaRecord): Promise<FogApplyResult<FogMetaRecord>> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const metaKey = this.fogMetaKey(room);
      const tilesKey = this.fogTilesKey(room);
      const expectedMeta = await this.client.hGet(metaKey, 'current');
      const expectedTiles = await this.client.hGetAll(tilesKey);
      const replacements: FogTileRecord[] = [];
      let current: FogMetaRecord | undefined;
      if (expectedMeta !== null) {
        try {
          const parsed: unknown = JSON.parse(expectedMeta);
          if (isValidFogMetaRecord(parsed)) current = parsed;
        } catch {
          // Corrupt state is atomically replaced by a valid winning record.
        }
      }
      if (
        current?.definition &&
        record.definition &&
        current.definition.generation === record.definition.generation
      ) {
        for (const raw of Object.values(expectedTiles)) {
          let tile: unknown;
          try {
            tile = JSON.parse(raw);
          } catch {
            continue;
          }
          if (!isValidFogSnapshot({ meta: current, tiles: [tile] })) continue;
          const valid = tile as FogTileRecord;
          if (!tileIntersectsDefinition(valid.x, valid.y, record.definition)) continue;
          if (valid.data === undefined) {
            replacements.push(valid);
            continue;
          }
          const canonical = canonicalizeFogTile(
            { x: valid.x, y: valid.y, data: valid.data },
            record.definition,
          );
          if (canonical) replacements.push({ ...valid, data: canonical.data });
        }
      }
      const result = await this.evalFog(FOG_META_LWW_SCRIPT, room, record, [
        expectedMeta ?? '',
        JSON.stringify(expectedTiles),
        JSON.stringify(replacements),
      ]);
      if (Array.isArray(result) && result[0] === 2) continue;
      return parseApplyResult(result, isValidFogMetaRecord);
    }
    throw new Error('Redis fog meta update did not converge after concurrent writes');
  }

  async applyFogTile(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>> {
    const result = await this.applyFogPatch(room, [record]);
    if (result.accepted.length === 1) return { accepted: true };
    return { accepted: false, correction: result.corrections[0] };
  }

  async applyFogPatch(
    room: string,
    records: readonly FogTileRecord[],
  ): Promise<FogPatchApplyResult> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const metaRaw = await this.client.hGet(this.fogMetaKey(room), 'current');
      if (metaRaw === null) return { accepted: [], corrections: [] };
      let meta: unknown;
      try {
        meta = JSON.parse(metaRaw);
      } catch {
        return { accepted: [], corrections: [] };
      }
      if (!isValidFogMetaRecord(meta) || !meta.definition) {
        return { accepted: [], corrections: [] };
      }
      const definition = meta.definition;
      const stored = await this.client.hGetAll(this.fogTilesKey(room));
      const invalidStored: Record<string, string> = {};
      for (const [field, raw] of Object.entries(stored)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          invalidStored[field] = raw;
          continue;
        }
        if (!isValidFogSnapshot({ meta, tiles: [parsed] })) invalidStored[field] = raw;
      }
      if (records.some((tile) => !isValidFogSnapshot({ meta, tiles: [tile] }))) {
        return {
          accepted: [],
          corrections: records.map((tile) => {
            const raw = stored[`${tile.x},${tile.y}`];
            if (raw) {
              try {
                const parsed: unknown = JSON.parse(raw);
                if (isValidFogSnapshot({ meta, tiles: [parsed] })) return parsed as FogTileRecord;
              } catch {
                // Fall through to an authoritative tombstone.
              }
            }
            return {
              generation: definition.generation,
              x: tile.x,
              y: tile.y,
              version: 1,
              editor: 'hub',
            };
          }),
        };
      }
      const result = await this.evalFog(FOG_PATCH_LWW_SCRIPT, room, records, [
        metaRaw,
        JSON.stringify(invalidStored),
      ]);
      if (Array.isArray(result) && result[0] === 2) continue;
      return parsePatchApplyResult(result);
    }
    throw new Error('Redis fog patch did not converge after concurrent definition writes');
  }

  private async evalFog(
    script: string,
    room: string,
    record: object,
    extraArguments: string[] = [],
  ): Promise<unknown> {
    if (!this.client.eval) {
      throw new Error('Redis fog persistence requires a Redis client with EVAL support');
    }
    return this.client.eval(script, {
      keys: [this.fogMetaKey(room), this.fogTilesKey(room)],
      arguments: [JSON.stringify(record), ...extraArguments],
    });
  }
}

function tileIntersectsDefinition(
  x: number,
  y: number,
  definition: NonNullable<FogMetaRecord['definition']>,
): boolean {
  const tileWorldSize = 128 * definition.cellSize;
  const tileWorldX = x * tileWorldSize;
  const tileWorldY = y * tileWorldSize;
  return !(
    tileWorldX + tileWorldSize <= definition.bounds.x ||
    tileWorldY + tileWorldSize <= definition.bounds.y ||
    tileWorldX >= definition.bounds.x + definition.bounds.w ||
    tileWorldY >= definition.bounds.y + definition.bounds.h
  );
}

function parseApplyResult<T>(
  raw: unknown,
  guard: (value: unknown) => value is T,
): FogApplyResult<T> {
  if (!Array.isArray(raw) || (raw[0] !== 0 && raw[0] !== 1)) {
    throw new Error('Redis returned an invalid fog apply result');
  }
  if (raw[0] === 1) return { accepted: true };
  if (typeof raw[1] !== 'string' || raw[1].length === 0) return { accepted: false };
  let correction: unknown;
  try {
    correction = JSON.parse(raw[1]);
  } catch {
    throw new Error('Redis returned an invalid fog correction');
  }
  if (!guard(correction)) throw new Error('Redis returned an invalid fog correction');
  return { accepted: false, correction };
}

function parsePatchApplyResult(raw: unknown): FogPatchApplyResult {
  if (!Array.isArray(raw) || typeof raw[0] !== 'number') {
    throw new Error('Redis returned an invalid fog patch result');
  }
  const acceptedCount = raw[0];
  if (!Number.isSafeInteger(acceptedCount) || acceptedCount < 0) {
    throw new Error('Redis returned an invalid fog patch result');
  }
  const accepted: FogTileRecord[] = [];
  let cursor = 1;
  for (let i = 0; i < acceptedCount; i++, cursor++) {
    const parsed = parseFogTileResultRecord(raw[cursor]);
    accepted.push(parsed);
  }
  const correctionCount = raw[cursor++];
  if (!Number.isSafeInteger(correctionCount) || (correctionCount as number) < 0) {
    throw new Error('Redis returned an invalid fog patch result');
  }
  const corrections: FogTileRecord[] = [];
  for (let i = 0; i < (correctionCount as number); i++, cursor++) {
    corrections.push(parseFogTileResultRecord(raw[cursor]));
  }
  if (cursor !== raw.length) throw new Error('Redis returned an invalid fog patch result');
  return { accepted, corrections };
}

function parseFogTileResultRecord(raw: unknown): FogTileRecord {
  if (typeof raw !== 'string') throw new Error('Redis returned an invalid fog patch record');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Redis returned an invalid fog patch record');
  }
  if (!isValidFogTileRecord(parsed)) throw new Error('Redis returned an invalid fog patch record');
  return parsed;
}

const FOG_META_LWW_SCRIPT = `
local incomingRaw = ARGV[1]
local incoming = cjson.decode(incomingRaw)
local currentRaw = redis.call('HGET', KEYS[1], 'current')
local expectedMetaRaw = ARGV[2]
if (currentRaw or '') ~= expectedMetaRaw then return {2} end
local expectedTiles = cjson.decode(ARGV[3])
local expectedTileCount = 0
for field, raw in pairs(expectedTiles) do
  expectedTileCount = expectedTileCount + 1
  if redis.call('HGET', KEYS[2], field) ~= raw then return {2} end
end
if redis.call('HLEN', KEYS[2]) ~= expectedTileCount then return {2} end
local replacementTiles = cjson.decode(ARGV[4])
local function ascii(value)
  if type(value) ~= 'string' or #value < 1 or #value > 128 then return false end
  for i = 1, #value do
    local b = string.byte(value, i)
    if b < 32 or b > 126 then return false end
  end
  return true
end
local function integer(value)
  return type(value) == 'number' and value >= 1 and value <= 9007199254740991
    and value == math.floor(value)
end
local function validDef(def)
  return type(def) == 'table' and def.version == 1 and ascii(def.generation)
    and type(def.bounds) == 'table' and type(def.bounds.x) == 'number'
    and type(def.bounds.y) == 'number' and type(def.bounds.w) == 'number' and def.bounds.w > 0
    and type(def.bounds.h) == 'number' and def.bounds.h > 0 and type(def.cellSize) == 'number'
    and def.cellSize > 0 and def.tileCells == 128 and (def.base == 'covered' or def.base == 'revealed')
end
local function validMeta(value)
  return type(value) == 'table' and integer(value.version) and ascii(value.editor)
    and (value.definition == nil or validDef(value.definition))
end
local current = nil
if currentRaw then
  local ok, decoded = pcall(cjson.decode, currentRaw)
  if ok and validMeta(decoded) then current = decoded else redis.call('HDEL', KEYS[1], 'current') end
end
local function newer(a, b)
  return a.version > b.version or (a.version == b.version and a.editor > b.editor)
end
if current and not newer(incoming, current) then return {0, currentRaw} end
local oldDef = current and current.definition or nil
local newDef = incoming.definition
if oldDef and newDef and oldDef.generation == newDef.generation
  and (oldDef.cellSize ~= newDef.cellSize or oldDef.tileCells ~= newDef.tileCells
    or oldDef.base ~= newDef.base or newDef.bounds.x > oldDef.bounds.x
    or newDef.bounds.y > oldDef.bounds.y
    or newDef.bounds.x + newDef.bounds.w < oldDef.bounds.x + oldDef.bounds.w
    or newDef.bounds.y + newDef.bounds.h < oldDef.bounds.y + oldDef.bounds.h) then
  return {0, currentRaw}
end

redis.call('HSET', KEYS[1], 'current', incomingRaw)
redis.call('DEL', KEYS[2])
if newDef and oldDef and oldDef.generation == newDef.generation then
  for i = 1, #replacementTiles do
    local tile = replacementTiles[i]
    redis.call('HSET', KEYS[2], tostring(tile.x) .. ',' .. tostring(tile.y), cjson.encode(tile))
  end
end
return {1}
`;

const FOG_PATCH_LWW_SCRIPT = `
local incomingRaws = cjson.decode(ARGV[1])
local metaRaw = redis.call('HGET', KEYS[1], 'current')
if (metaRaw or '') ~= ARGV[2] then return {2} end
local invalidStored = cjson.decode(ARGV[3])
for field, raw in pairs(invalidStored) do
  if redis.call('HGET', KEYS[2], field) == raw then redis.call('HDEL', KEYS[2], field) end
end
if not metaRaw then return {0, 0} end
local metaOk, meta = pcall(cjson.decode, metaRaw)
if not metaOk or type(meta) ~= 'table' or type(meta.definition) ~= 'table'
  or type(meta.definition.generation) ~= 'string' then return {0, 0} end
local def = meta.definition
local tileSize = 128 * def.cellSize
local function intersects(tile)
  local tx = tile.x * tileSize
  local ty = tile.y * tileSize
  return tx + tileSize > def.bounds.x and ty + tileSize > def.bounds.y
    and tx < def.bounds.x + def.bounds.w and ty < def.bounds.y + def.bounds.h
end
local function newer(a, b)
  return a.version > b.version or (a.version == b.version and a.editor > b.editor)
end
local function validTile(tile)
  if type(tile) ~= 'table' then return false end
  local function ascii(value)
    if type(value) ~= 'string' or #value < 1 or #value > 128 then return false end
    for i = 1, #value do
      local b = string.byte(value, i)
      if b < 32 or b > 126 then return false end
    end
    return true
  end
  local dataOk = tile.data == nil or (type(tile.data) == 'string' and #tile.data == 2732
    and string.match(tile.data, '^[A-Za-z0-9+/]+[AEIMQUYcgkosw048]=$') ~= nil)
  return ascii(tile.generation)
    and type(tile.x) == 'number' and math.abs(tile.x) <= 9007199254740991
    and tile.x == math.floor(tile.x)
    and type(tile.y) == 'number' and math.abs(tile.y) <= 9007199254740991
    and tile.y == math.floor(tile.y)
    and type(tile.version) == 'number' and tile.version >= 1
    and tile.version <= 9007199254740991 and tile.version == math.floor(tile.version)
    and ascii(tile.editor) and dataOk
end
local stored = redis.call('HGETALL', KEYS[2])
local validCount = 0
for i = 1, #stored, 2 do
  local ok, tile = pcall(cjson.decode, stored[i + 1])
  if not ok or not validTile(tile) or stored[i] ~= tostring(tile.x) .. ',' .. tostring(tile.y)
    or tile.generation ~= def.generation or not intersects(tile) then
    redis.call('HDEL', KEYS[2], stored[i])
  else
    validCount = validCount + 1
  end
end
local accepted = {}
local corrections = {}
local newCount = 0
local currents = {}
for i = 1, #incomingRaws do
  local incomingRaw = cjson.encode(incomingRaws[i])
  local incoming = incomingRaws[i]
  local field = tostring(incoming.x) .. ',' .. tostring(incoming.y)
  local currentRaw = redis.call('HGET', KEYS[2], field)
  local current = nil
  if currentRaw then
    local ok, decoded = pcall(cjson.decode, currentRaw)
    if ok and validTile(decoded) then current = decoded else currentRaw = nil end
  end
  currents[i] = currentRaw or false
  if incoming.generation ~= def.generation or not intersects(incoming)
    or (current and not newer(incoming, current)) then
    corrections[#corrections + 1] = currentRaw or cjson.encode({generation=def.generation,
      x=incoming.x, y=incoming.y, version=1, editor='hub'})
  else
    accepted[#accepted + 1] = incomingRaw
    if not current then newCount = newCount + 1 end
  end
end
if validCount + newCount > 256 then
  accepted = {}
  corrections = {}
  for i = 1, #incomingRaws do
    local incoming = incomingRaws[i]
    corrections[#corrections + 1] = currents[i] or cjson.encode({generation=def.generation,
      x=incoming.x, y=incoming.y, version=1, editor='hub'})
  end
else
  for i = 1, #accepted do
    local record = cjson.decode(accepted[i])
    redis.call('HSET', KEYS[2], tostring(record.x) .. ',' .. tostring(record.y), accepted[i])
  end
end
local result = {#accepted}
for i = 1, #accepted do result[#result + 1] = accepted[i] end
result[#result + 1] = #corrections
for i = 1, #corrections do result[#result + 1] = corrections[i] end
return result
`;
