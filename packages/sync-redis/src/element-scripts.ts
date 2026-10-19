/**
 * Versioned element compare-and-set. KEYS[1] is the room element hash, KEYS[2] its tombstone hash.
 * upsert/remove ARGV: mode, id, expected version ('' = no record), JSON to store. The current record
 * is the decodable element, else the decodable tombstone; returns {1}, {0, kind, raw} or {0}.
 * clear ARGV: 'clear', JSON {id: version} that must match every decodable element, then id and
 * tombstone JSON pairs whose ids must equal the expected ids.
 */
export const ELEMENT_WRITE_SCRIPT = `
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if ok and type(value) == 'table' then return value end
  return nil
end

if ARGV[1] == 'clear' then
  local expected = cjson.decode(ARGV[2])
  local count = 0
  for _ in pairs(expected) do count = count + 1 end
  if (#ARGV - 2) ~= count * 2 then
    return redis.error_reply('clear tombstones must match the expected ids')
  end
  local seen = {}
  for i = 3, #ARGV, 2 do
    local id = ARGV[i]
    if expected[id] == nil or seen[id] then
      return redis.error_reply('clear tombstones must match the expected ids')
    end
    seen[id] = true
  end
  local fields = redis.call('HGETALL', KEYS[1])
  local elements = 0
  for i = 1, #fields, 2 do
    local element = decode(fields[i + 1])
    if element then
      elements = elements + 1
      if expected[fields[i]] ~= element.version then return {0, 'element', fields[i + 1]} end
    end
  end
  if elements ~= count then return {0} end
  redis.call('DEL', KEYS[1])
  for i = 3, #ARGV, 2 do redis.call('HSET', KEYS[2], ARGV[i], ARGV[i + 1]) end
  return {1}
end

local id = ARGV[2]
local kind, raw = 'element', redis.call('HGET', KEYS[1], id)
local current = decode(raw)
if not current then
  kind, raw = 'tombstone', redis.call('HGET', KEYS[2], id)
  current = decode(raw)
end
if (current and current.version) ~= tonumber(ARGV[3]) then
  if current then return {0, kind, raw} end
  return {0}
end
if ARGV[1] == 'upsert' then
  redis.call('HSET', KEYS[1], id, ARGV[4])
  redis.call('HDEL', KEYS[2], id)
else
  redis.call('HDEL', KEYS[1], id)
  redis.call('HSET', KEYS[2], id, ARGV[4])
end
return {1}
`;

/**
 * Pre-F1 room migration. KEYS[1] is the room element hash; ARGV holds id and element JSON pairs.
 * Writes a field only while it still exists without an `index`, so racing instances agree.
 */
export const ELEMENT_MIGRATE_SCRIPT = `
for i = 1, #ARGV, 2 do
  local raw = redis.call('HGET', KEYS[1], ARGV[i])
  if raw then
    local ok, element = pcall(cjson.decode, raw)
    if ok and type(element) == 'table' and element.index == nil then
      redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
    end
  end
end
return 1
`;

/** Reads KEYS[1] (elements) and KEYS[2] (tombstones) in one step: {elements HGETALL, tombstones HGETALL}. */
export const ELEMENT_SNAPSHOT_SCRIPT = `
return {redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2])}
`;

/** Deletes expired tombstones from KEYS[1]; ARGV holds id and read value pairs, deleted only if unchanged. */
export const TOMBSTONE_EXPIRE_SCRIPT = `
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return 1
`;
