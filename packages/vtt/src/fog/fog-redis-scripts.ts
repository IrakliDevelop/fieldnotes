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

export const FOG_META_LWW_SCRIPT = `
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

export const FOG_PATCH_LWW_SCRIPT = `
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
