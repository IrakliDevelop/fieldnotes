import type { FogMetaRecord, FogTileRecord } from './fog-sync-types';
import { isValidFogTileRecord } from './fog-sync-types';
import { FOG_TILE_CELLS } from './types';

// ── Result types ──

export interface FogRedisApplyResult<T> {
  readonly accepted: boolean;
  readonly correction?: T;
}

export interface FogRedisPatchApplyResult {
  readonly accepted: FogTileRecord[];
  readonly corrections: FogTileRecord[];
}

// ── Helpers ──

export function tileIntersectsDefinition(
  x: number,
  y: number,
  definition: NonNullable<FogMetaRecord['definition']>,
): boolean {
  const tileWorldSize = FOG_TILE_CELLS * definition.cellSize;
  const tileWorldX = x * tileWorldSize;
  const tileWorldY = y * tileWorldSize;
  return !(
    tileWorldX + tileWorldSize <= definition.bounds.x ||
    tileWorldY + tileWorldSize <= definition.bounds.y ||
    tileWorldX >= definition.bounds.x + definition.bounds.w ||
    tileWorldY >= definition.bounds.y + definition.bounds.h
  );
}

// ── Result parsing ──

export function parseFogRedisMetaResult<T>(
  raw: unknown,
  guard: (value: unknown) => value is T,
): FogRedisApplyResult<T> {
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

export function parseFogRedisPatchResult(raw: unknown): FogRedisPatchApplyResult {
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

// ── Lua scripts ──

/**
 * One entry of `FOG_META_LWW_SCRIPT`'s ARGV[2]: the tiles-hash field to rewrite,
 * the raw value the caller read from it, and the record to store. A missing
 * `tile` deletes the field. The script applies an entry only while the field
 * still holds `expectedRaw`, so a tile written between the caller's read and the
 * script survives untouched instead of being discarded.
 */
export interface FogMetaTileReplacement {
  readonly field: string;
  readonly expectedRaw: string;
  readonly tile?: FogTileRecord;
}

export const FOG_META_LWW_SCRIPT = `
local incomingRaw = ARGV[1]
local incoming = cjson.decode(incomingRaw)
local replacements = cjson.decode(ARGV[2])
local currentRaw = redis.call('HGET', KEYS[1], 'current')
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
local sameGeneration = oldDef ~= nil and newDef ~= nil and oldDef.generation == newDef.generation
if sameGeneration
  and (oldDef.cellSize ~= newDef.cellSize or oldDef.tileCells ~= newDef.tileCells
    or oldDef.base ~= newDef.base or newDef.bounds.x > oldDef.bounds.x
    or newDef.bounds.y > oldDef.bounds.y
    or newDef.bounds.x + newDef.bounds.w < oldDef.bounds.x + oldDef.bounds.w
    or newDef.bounds.y + newDef.bounds.h < oldDef.bounds.y + oldDef.bounds.h) then
  return {0, currentRaw}
end

redis.call('HSET', KEYS[1], 'current', incomingRaw)
if not sameGeneration then
  redis.call('DEL', KEYS[2])
else
  for i = 1, #replacements do
    local replacement = replacements[i]
    if redis.call('HGET', KEYS[2], replacement.field) == replacement.expectedRaw then
      if replacement.tile then
        redis.call('HSET', KEYS[2], replacement.field, cjson.encode(replacement.tile))
      else
        redis.call('HDEL', KEYS[2], replacement.field)
      end
    end
  end
end
return {1}
`;

/**
 * Validates a whole fog patch against Redis state without a caller-side read of
 * the tiles hash: the script reads the meta record itself, so a meta write that
 * lands between the caller's read and this call cannot produce a conflict, and
 * per-tile LWW runs against the value stored at that moment. ARGV[1] is the
 * incoming tile array as JSON; there is no compare-and-set argument and no
 * retry result. The tiles hash is scanned only when the patch would otherwise
 * overflow capacity, to reclaim records the current definition no longer admits.
 */
export const FOG_PATCH_LWW_SCRIPT = `
local incomingTiles = cjson.decode(ARGV[1])
local function ascii(value)
  if type(value) ~= 'string' or #value < 1 or #value > 128 then return false end
  for i = 1, #value do
    local b = string.byte(value, i)
    if b < 32 or b > 126 then return false end
  end
  return true
end
local function validTile(tile)
  if type(tile) ~= 'table' then return false end
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
local function tombstone(generation, x, y)
  return cjson.encode({generation = generation, x = x, y = y, version = 1, editor = 'hub'})
end
local metaRaw = redis.call('HGET', KEYS[1], 'current')
local def = nil
if metaRaw then
  local metaOk, meta = pcall(cjson.decode, metaRaw)
  if metaOk and type(meta) == 'table' and type(meta.definition) == 'table'
    and type(meta.definition.generation) == 'string' and type(meta.definition.cellSize) == 'number'
    and type(meta.definition.bounds) == 'table' then
    def = meta.definition
  end
end
if not def then
  local orphaned = {0, #incomingTiles}
  for i = 1, #incomingTiles do
    local tile = incomingTiles[i]
    orphaned[#orphaned + 1] = tombstone(tile.generation, tile.x, tile.y)
  end
  return orphaned
end
local tileSize = 128 * def.cellSize
local function intersects(x, y)
  local tx = x * tileSize
  local ty = y * tileSize
  return tx + tileSize > def.bounds.x and ty + tileSize > def.bounds.y
    and tx < def.bounds.x + def.bounds.w and ty < def.bounds.y + def.bounds.h
end
local function newer(a, b)
  return a.version > b.version or (a.version == b.version and a.editor > b.editor)
end
local function admitted(field, raw)
  if not raw then return nil end
  local ok, tile = pcall(cjson.decode, raw)
  if not ok or not validTile(tile) then return nil end
  if field ~= tostring(tile.x) .. ',' .. tostring(tile.y) then return nil end
  if tile.generation ~= def.generation or not intersects(tile.x, tile.y) then return nil end
  return tile
end
local accepted = {}
local corrections = {}
local currents = {}
local newCount = 0
for i = 1, #incomingTiles do
  local incoming = incomingTiles[i]
  local field = tostring(incoming.x) .. ',' .. tostring(incoming.y)
  local currentRaw = redis.call('HGET', KEYS[2], field)
  local current = admitted(field, currentRaw)
  if not current then currentRaw = false end
  currents[i] = currentRaw
  if incoming.generation ~= def.generation or not intersects(incoming.x, incoming.y)
    or (current and not newer(incoming, current)) then
    corrections[#corrections + 1] = currentRaw or tombstone(def.generation, incoming.x, incoming.y)
  else
    accepted[#accepted + 1] = cjson.encode(incoming)
    if not current then newCount = newCount + 1 end
  end
end
local count = redis.call('HLEN', KEYS[2])
if count + newCount > 256 then
  local stored = redis.call('HGETALL', KEYS[2])
  count = 0
  for i = 1, #stored, 2 do
    if admitted(stored[i], stored[i + 1]) then
      count = count + 1
    else
      redis.call('HDEL', KEYS[2], stored[i])
    end
  end
end
if count + newCount > 256 then
  local overflow = {0, #incomingTiles}
  for i = 1, #incomingTiles do
    local incoming = incomingTiles[i]
    overflow[#overflow + 1] = currents[i] or tombstone(def.generation, incoming.x, incoming.y)
  end
  return overflow
end
for i = 1, #accepted do
  local record = cjson.decode(accepted[i])
  redis.call('HSET', KEYS[2], tostring(record.x) .. ',' .. tostring(record.y), accepted[i])
end
local result = {#accepted}
for i = 1, #accepted do result[#result + 1] = accepted[i] end
result[#result + 1] = #corrections
for i = 1, #corrections do result[#result + 1] = corrections[i] end
return result
`;
