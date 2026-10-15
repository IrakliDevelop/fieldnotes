import type { AuthorityMutation } from '@fieldnotes/sync';
import {
  isValidFogAuthorityState,
  prepareFogAuthorityIntent,
  type FogAuthorityIntent,
} from './fog-authority';

const MAX_HOST_SOURCE_BYTES = 256 * 1024;
const MAX_STATE_JSON_BYTES = 1024 * 1024;

export type FogAuthorityRedisPlanResultV1 =
  | { readonly status: 'accepted'; readonly nextStateJson: string }
  | {
      readonly status: 'rejected';
      readonly reason: 'invalid' | 'conflict' | 'generation-mismatch' | 'overloaded';
      readonly currentStateJson: string;
    };

/**
 * Frozen Redis Lua library for the VTT fog authority v1 transition.
 *
 * The appended, trusted host chunk may call only `fn_fog_plan_v1` and
 * `fn_fog_apply_v1`. The planner reads the two keys passed to it and performs
 * no writes. The apply helper recognizes only a plan table created during the
 * same script invocation and performs fixed, already-planned hash writes.
 */
export const FOG_AUTHORITY_REDIS_LIBRARY_V1 = String.raw`local fn_fog_plan_v1
local fn_fog_apply_v1
do
local fog_plan_meta_values_v1 = {}
local fog_number_tokens_v1 = {}

local function fog_table_exact_v1(value, allowed, required)
  if type(value) ~= 'table' then return false end
  for key, _ in pairs(value) do
    if type(key) ~= 'string' or not allowed[key] then return false end
  end
  for key, _ in pairs(required) do
    if rawget(value, key) == nil then return false end
  end
  return true
end

local function fog_array_length_v1(value, maximum)
  if type(value) ~= 'table' then return nil end
  local count = 0
  local maximum_index = 0
  for key, _ in pairs(value) do
    if type(key) ~= 'number' or key < 1 or key ~= math.floor(key) then return nil end
    count = count + 1
    if key > maximum_index then maximum_index = key end
    if count > maximum or maximum_index > maximum then return nil end
  end
  if count ~= maximum_index then return nil end
  return count
end

local function fog_ascii_v1(value)
  if type(value) ~= 'string' or #value < 1 or #value > 128 then return false end
  for index = 1, #value do
    local byte = string.byte(value, index)
    if byte < 32 or byte > 126 then return false end
  end
  return true
end

local function fog_finite_v1(value)
  return type(value) == 'number' and value == value and value > -math.huge and value < math.huge
end

local function fog_positive_integer_v1(value)
  return fog_finite_v1(value) and value >= 1 and value <= 9007199254740991
    and value == math.floor(value)
end

local function fog_safe_integer_v1(value)
  return fog_finite_v1(value) and math.abs(value) <= 9007199254740991
    and value == math.floor(value)
end

local function fog_integer_token_v1(token, value)
  if type(token) ~= 'string' or string.match(token, '^-?[0-9]+$') == nil then
    return false
  end
  local digits = string.sub(token, 1, 1) == '-' and string.sub(token, 2) or token
  if token == '-0' or (#digits > 1 and string.sub(digits, 1, 1) == '0') then return false end
  return tonumber(token) == value
end

local function fog_number_token_v1(token, value)
  if type(token) ~= 'string' then return false end
  local decoded = tonumber(token)
  return decoded ~= nil and fog_finite_v1(decoded) and decoded == value
end

local function fog_json_number_tokens_v1(raw, maximum)
  local tokens = {}
  local index = 1
  while index <= #raw do
    local character = string.sub(raw, index, index)
    if character == '"' then
      index = index + 1
      local closed = false
      while index <= #raw do
        local current = string.sub(raw, index, index)
        if current == '\\' then
          index = index + 2
        elseif current == '"' then
          index = index + 1
          closed = true
          break
        else
          index = index + 1
        end
      end
      if not closed then return nil end
    elseif character == '-' or string.match(character, '^[0-9]$') then
      local start = index
      index = index + 1
      while index <= #raw
        and string.match(string.sub(raw, index, index), '^[0-9eE+%.%-]$') do
        index = index + 1
      end
      tokens[#tokens + 1] = string.sub(raw, start, index - 1)
      if #tokens > maximum then return nil end
    else
      index = index + 1
    end
  end
  return tokens
end

local fog_bounds_keys_v1 = {x = true, y = true, w = true, h = true}
local fog_definition_keys_v1 = {
  version = true, generation = true, bounds = true, cellSize = true,
  tileCells = true, base = true
}
local fog_meta_keys_v1 = {version = true, editor = true, definition = true}
local fog_meta_required_v1 = {version = true, editor = true}
local fog_tile_keys_v1 = {
  generation = true, x = true, y = true, version = true, editor = true, data = true
}
local fog_tile_required_v1 = {
  generation = true, x = true, y = true, version = true, editor = true
}

local function fog_valid_bounds_v1(value)
  return fog_table_exact_v1(value, fog_bounds_keys_v1, fog_bounds_keys_v1)
    and fog_finite_v1(value.x) and fog_finite_v1(value.y)
    and fog_finite_v1(value.w) and value.w > 0
    and fog_finite_v1(value.h) and value.h > 0
end

local function fog_valid_definition_v1(value)
  return fog_table_exact_v1(value, fog_definition_keys_v1, fog_definition_keys_v1)
    and value.version == 1 and fog_ascii_v1(value.generation)
    and fog_valid_bounds_v1(value.bounds)
    and fog_finite_v1(value.cellSize) and value.cellSize > 0
    and value.tileCells == 128 and (value.base == 'covered' or value.base == 'revealed')
end

local function fog_valid_meta_v1(value)
  if not fog_table_exact_v1(value, fog_meta_keys_v1, fog_meta_required_v1)
    or not fog_positive_integer_v1(value.version) or not fog_ascii_v1(value.editor) then
    return false
  end
  return rawget(value, 'definition') == nil or fog_valid_definition_v1(value.definition)
end

local fog_b64_chars_v1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

local function fog_b64_value_v1(character)
  local index = string.find(fog_b64_chars_v1, character, 1, true)
  if not index then return nil end
  return index - 1
end

local function fog_decode_tile_v1(value)
  if type(value) ~= 'string' or #value ~= 2732 or string.sub(value, -1) ~= '='
    or string.sub(value, -2, -2) == '=' then return nil end
  local final = fog_b64_value_v1(string.sub(value, -2, -2))
  if not final or final % 4 ~= 0 then return nil end
  local bytes = {}
  local cursor = 1
  for index = 1, #value, 4 do
    local a = fog_b64_value_v1(string.sub(value, index, index))
    local b = fog_b64_value_v1(string.sub(value, index + 1, index + 1))
    local c_character = string.sub(value, index + 2, index + 2)
    local d_character = string.sub(value, index + 3, index + 3)
    local c = c_character == '=' and 0 or fog_b64_value_v1(c_character)
    local d = d_character == '=' and 0 or fog_b64_value_v1(d_character)
    if not a or not b or not c or not d then return nil end
    bytes[cursor] = a * 4 + math.floor(b / 16)
    cursor = cursor + 1
    if c_character ~= '=' then
      bytes[cursor] = (b % 16) * 16 + math.floor(c / 4)
      cursor = cursor + 1
    end
    if d_character ~= '=' then
      bytes[cursor] = (c % 4) * 64 + d
      cursor = cursor + 1
    end
  end
  if cursor ~= 2049 then return nil end
  return bytes
end

local function fog_intersects_v1(x, y, definition)
  local size = 128 * definition.cellSize
  local world_x = x * size
  local world_y = y * size
  return not (world_x + size <= definition.bounds.x
    or world_y + size <= definition.bounds.y
    or world_x >= definition.bounds.x + definition.bounds.w
    or world_y >= definition.bounds.y + definition.bounds.h)
end

local function fog_valid_tile_shape_v1(value)
  return fog_table_exact_v1(value, fog_tile_keys_v1, fog_tile_required_v1)
    and fog_ascii_v1(value.generation) and fog_safe_integer_v1(value.x)
    and fog_safe_integer_v1(value.y) and fog_positive_integer_v1(value.version)
    and fog_ascii_v1(value.editor)
    and (rawget(value, 'data') == nil or type(value.data) == 'string')
end

local function fog_valid_tile_for_definition_v1(value, definition)
  if not fog_valid_tile_shape_v1(value) or value.generation ~= definition.generation
    or not fog_intersects_v1(value.x, value.y, definition) then return false end
  if rawget(value, 'data') == nil then return true end
  local bytes = fog_decode_tile_v1(value.data)
  if not bytes then return false end
  local base_bit = definition.base == 'revealed' and 1 or 0
  local differs_from_base = false
  local world_x = value.x * 128 * definition.cellSize
  local world_y = value.y * 128 * definition.cellSize
  local right = definition.bounds.x + definition.bounds.w
  local bottom = definition.bounds.y + definition.bounds.h
  for row = 0, 127 do
    for column = 0, 127 do
      local offset = row * 128 + column
      local byte = bytes[math.floor(offset / 8) + 1]
      local bit = math.floor(byte / (2 ^ (7 - (offset % 8)))) % 2
      if bit ~= base_bit then differs_from_base = true end
      local cell_x = world_x + column * definition.cellSize
      local cell_y = world_y + row * definition.cellSize
      if (cell_x < definition.bounds.x or cell_y < definition.bounds.y
        or cell_x >= right or cell_y >= bottom) and bit ~= base_bit then return false end
    end
  end
  return differs_from_base
end

local function fog_json_string_v1(value)
  local escaped = string.gsub(value, '\\', '\\\\')
  escaped = string.gsub(escaped, '"', '\\"')
  return '"' .. escaped .. '"'
end

local function fog_assign_meta_tokens_v1(meta, tokens, start)
  local count = rawget(meta, 'definition') == nil and 1 or 8
  if start + count - 1 > #tokens
    or not fog_integer_token_v1(tokens[start], meta.version) then return nil end
  if count == 8 then
    local definition = meta.definition
    if tokens[start + 1] ~= '1'
      or not fog_number_token_v1(tokens[start + 2], definition.bounds.x)
      or not fog_number_token_v1(tokens[start + 3], definition.bounds.y)
      or not fog_number_token_v1(tokens[start + 4], definition.bounds.w)
      or not fog_number_token_v1(tokens[start + 5], definition.bounds.h)
      or not fog_number_token_v1(tokens[start + 6], definition.cellSize)
      or tokens[start + 7] ~= '128' then return nil end
  end
  local assigned = {}
  for offset = 0, count - 1 do assigned[offset + 1] = tokens[start + offset] end
  fog_number_tokens_v1[meta] = assigned
  return start + count
end

local function fog_assign_tile_tokens_v1(tile, tokens, start)
  if start + 2 > #tokens or not fog_integer_token_v1(tokens[start], tile.x)
    or not fog_integer_token_v1(tokens[start + 1], tile.y)
    or not fog_integer_token_v1(tokens[start + 2], tile.version) then return nil end
  fog_number_tokens_v1[tile] = {tokens[start], tokens[start + 1], tokens[start + 2]}
  return start + 3
end

local function fog_field_v1(tile)
  local tokens = fog_number_tokens_v1[tile]
  if not tokens then return nil end
  return tokens[1] .. ',' .. tokens[2]
end

local function fog_encode_definition_v1(value, tokens)
  return '{"version":1,"generation":' .. fog_json_string_v1(value.generation)
    .. ',"bounds":{"x":' .. tokens[3]
    .. ',"y":' .. tokens[4]
    .. ',"w":' .. tokens[5]
    .. ',"h":' .. tokens[6]
    .. '},"cellSize":' .. tokens[7]
    .. ',"tileCells":128,"base":' .. fog_json_string_v1(value.base) .. '}'
end

local function fog_encode_meta_v1(value)
  local tokens = fog_number_tokens_v1[value]
  if not tokens then return nil end
  local encoded = '{"version":' .. tokens[1]
    .. ',"editor":' .. fog_json_string_v1(value.editor)
  if rawget(value, 'definition') ~= nil then
    encoded = encoded .. ',"definition":' .. fog_encode_definition_v1(value.definition, tokens)
  end
  return encoded .. '}'
end

local function fog_encode_tile_v1(value)
  local tokens = fog_number_tokens_v1[value]
  if not tokens then return nil end
  local encoded = '{"generation":' .. fog_json_string_v1(value.generation)
    .. ',"x":' .. tokens[1]
    .. ',"y":' .. tokens[2]
    .. ',"version":' .. tokens[3]
    .. ',"editor":' .. fog_json_string_v1(value.editor)
  if rawget(value, 'data') ~= nil then encoded = encoded .. ',"data":' .. fog_json_string_v1(value.data) end
  return encoded .. '}'
end

local function fog_assign_meta_intent_tokens_v1(intent, raw)
  local tokens = fog_json_number_tokens_v1(raw, 9)
  if not tokens or tokens[1] ~= '1' then return false end
  local next_index = fog_assign_meta_tokens_v1(intent.record, tokens, 2)
  return next_index ~= nil and next_index == #tokens + 1
end

local function fog_assign_patch_intent_tokens_v1(intent, raw)
  local count = #intent.tiles
  local tokens = fog_json_number_tokens_v1(raw, 1 + count * 3)
  if not tokens or tokens[1] ~= '1' then return false end
  local next_index = 2
  for index = 1, count do
    next_index = fog_assign_tile_tokens_v1(intent.tiles[index], tokens, next_index)
    if not next_index then return false end
  end
  return next_index == #tokens + 1
end

local function fog_encode_meta_intent_v1(intent)
  return '{"schema":1,"kind":"meta","record":' .. fog_encode_meta_v1(intent.record) .. '}'
end

local function fog_encode_patch_intent_v1(intent)
  local parts = {
    '{"schema":1,"kind":"patch","generation":',
    fog_json_string_v1(intent.generation),
    ',"tiles":['
  }
  for index = 1, #intent.tiles do
    if index > 1 then parts[#parts + 1] = ',' end
    parts[#parts + 1] = fog_encode_tile_v1(intent.tiles[index])
  end
  parts[#parts + 1] = ']}'
  return table.concat(parts)
end

local function fog_compare_tiles_v1(left, right)
  return left.x < right.x or (left.x == right.x and left.y < right.y)
end

local function fog_encode_state_v1(meta, tiles)
  if not meta then return 'null' end
  local parts = {'{"meta":', fog_encode_meta_v1(meta), ',"tiles":['}
  for index = 1, #tiles do
    if index > 1 then parts[#parts + 1] = ',' end
    parts[#parts + 1] = fog_encode_tile_v1(tiles[index])
  end
  parts[#parts + 1] = ']}'
  return table.concat(parts)
end

local function fog_coordinate_field_v1(field)
  if type(field) ~= 'string' or #field > 35 then return false end
  local x_token, y_token = string.match(field, '^(-?[0-9]+),(-?[0-9]+)$')
  if not x_token or not y_token then return false end
  local x = tonumber(x_token)
  local y = tonumber(y_token)
  return fog_safe_integer_v1(x) and fog_safe_integer_v1(y)
    and fog_integer_token_v1(x_token, x) and fog_integer_token_v1(y_token, y)
end

local function fog_read_current_v1(meta_key, tiles_key)
  local meta_length = redis.call('HLEN', meta_key)
  local tile_length = redis.call('HLEN', tiles_key)
  if meta_length > 1 or tile_length > 256 then return nil, nil, false end
  local meta_memory = redis.call('MEMORY', 'USAGE', meta_key, 'SAMPLES', 0) or 0
  local tile_memory = redis.call('MEMORY', 'USAGE', tiles_key, 'SAMPLES', 0) or 0
  if meta_memory > 16384 or tile_memory > 2097152 then return nil, nil, false end
  if meta_length == 0 then
    if tile_length ~= 0 then return nil, nil, false end
    return nil, {}, true
  end
  if redis.call('HEXISTS', meta_key, 'current') ~= 1 then return nil, nil, false end
  local meta_bytes = redis.call('HSTRLEN', meta_key, 'current')
  if meta_bytes < 1 or meta_bytes > 4096 then return nil, nil, false end
  local total_bytes = meta_bytes + 7
  local fields = redis.call('HKEYS', tiles_key)
  if #fields ~= tile_length or #fields > 256 then return nil, nil, false end
  local seen = {}
  for index = 1, #fields do
    local field = fields[index]
    if seen[field] or not fog_coordinate_field_v1(field) then return nil, nil, false end
    local value_bytes = redis.call('HSTRLEN', tiles_key, field)
    if value_bytes < 1 or value_bytes > 4096 then return nil, nil, false end
    total_bytes = total_bytes + #field + value_bytes
    if total_bytes > 1048576 then return nil, nil, false end
    seen[field] = true
  end

  local meta_raw = redis.call('HGET', meta_key, 'current')
  local meta_ok, meta = pcall(cjson.decode, meta_raw)
  if not meta_ok or not fog_valid_meta_v1(meta) then return nil, nil, false end
  local meta_tokens = fog_json_number_tokens_v1(meta_raw, 8)
  local meta_next = meta_tokens and fog_assign_meta_tokens_v1(meta, meta_tokens, 1) or nil
  if not meta_next or meta_next ~= #meta_tokens + 1 or fog_encode_meta_v1(meta) ~= meta_raw then
    return nil, nil, false
  end
  local definition = meta.definition
  if not definition and #fields ~= 0 then return nil, nil, false end
  local tiles = {}
  for index = 1, #fields do
    local field = fields[index]
    local raw = redis.call('HGET', tiles_key, field)
    local tile_ok, tile = pcall(cjson.decode, raw)
    local tile_shape = tile_ok and fog_valid_tile_shape_v1(tile)
    local tile_tokens = tile_shape and fog_json_number_tokens_v1(raw, 3) or nil
    local tile_next = tile_tokens and fog_assign_tile_tokens_v1(tile, tile_tokens, 1) or nil
    if not tile_shape or not definition or not fog_valid_tile_for_definition_v1(tile, definition)
      or not tile_next or tile_next ~= #tile_tokens + 1
      or field ~= fog_field_v1(tile) or fog_encode_tile_v1(tile) ~= raw then
      return nil, nil, false
    end
    tiles[#tiles + 1] = tile
  end
  table.sort(tiles, fog_compare_tiles_v1)
  return meta, tiles, true
end

local function fog_newer_v1(incoming, current)
  return incoming.version > current.version
    or (incoming.version == current.version and incoming.editor > current.editor)
end

local function fog_compatible_meta_v1(current, incoming)
  local before = current and current.definition or nil
  local after = incoming.definition
  if not before or not after or before.generation ~= after.generation then return true end
  return before.cellSize == after.cellSize and before.tileCells == after.tileCells
    and before.base == after.base and after.bounds.x <= before.bounds.x
    and after.bounds.y <= before.bounds.y
    and after.bounds.x + after.bounds.w >= before.bounds.x + before.bounds.w
    and after.bounds.y + after.bounds.h >= before.bounds.y + before.bounds.h
end

local function fog_rejected_plan_v1(reason, meta, tiles)
  return {0, reason, fog_encode_state_v1(meta, tiles or {})}
end

fn_fog_plan_v1 = function(metaKey, tilesKey, intentJson)
  if type(metaKey) ~= 'string' or type(tilesKey) ~= 'string' or type(intentJson) ~= 'string'
    or #intentJson > 262144 then return {0, 'invalid', 'null'} end
  local current_meta, current_tiles, current_valid = fog_read_current_v1(metaKey, tilesKey)
  if not current_valid then return {0, 'invalid', 'null'} end
  local decoded_ok, intent = pcall(cjson.decode, intentJson)
  if not decoded_ok or type(intent) ~= 'table' then
    return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
  end

  if intent.kind == 'meta' then
    local intent_keys = {schema = true, kind = true, record = true}
    if not fog_table_exact_v1(intent, intent_keys, intent_keys) or intent.schema ~= 1
      or not fog_valid_meta_v1(intent.record)
      or not fog_assign_meta_intent_tokens_v1(intent, intentJson)
      or fog_encode_meta_intent_v1(intent) ~= intentJson then
      return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
    end
    local incoming = intent.record
    if current_meta and not fog_newer_v1(incoming, current_meta) then
      return fog_rejected_plan_v1('conflict', current_meta, current_tiles)
    end
    if current_meta and not fog_compatible_meta_v1(current_meta, incoming) then
      return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
    end
    local next_tiles = {}
    local tile_actions = {}
    local same_generation = current_meta and current_meta.definition and incoming.definition
      and current_meta.definition.generation == incoming.definition.generation
    if same_generation then
      for index = 1, #current_tiles do next_tiles[index] = current_tiles[index] end
    else
      for index = 1, #current_tiles do
        local tile = current_tiles[index]
        tile_actions[#tile_actions + 1] = {
          field = fog_field_v1(tile), action = 'delete'
        }
      end
    end
    local plan = {1, fog_encode_state_v1(incoming, next_tiles), 'set', tile_actions}
    fog_plan_meta_values_v1[plan] = fog_encode_meta_v1(incoming)
    return plan
  end

  if intent.kind == 'patch' then
    local intent_keys = {schema = true, kind = true, generation = true, tiles = true}
    if not fog_table_exact_v1(intent, intent_keys, intent_keys) or intent.schema ~= 1
      or not fog_ascii_v1(intent.generation) then
      return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
    end
    local count = fog_array_length_v1(intent.tiles, 64)
    if not count or count < 1 then
      return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
    end
    local seen = {}
    for index = 1, count do
      local tile = intent.tiles[index]
      if not fog_valid_tile_shape_v1(tile) then
        return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
      end
    end
    if not fog_assign_patch_intent_tokens_v1(intent, intentJson)
      or fog_encode_patch_intent_v1(intent) ~= intentJson then
      return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
    end
    for index = 1, count do
      local tile = intent.tiles[index]
      local field = fog_field_v1(tile)
      if seen[field] then return fog_rejected_plan_v1('invalid', current_meta, current_tiles) end
      seen[field] = true
    end
    local definition = current_meta and current_meta.definition or nil
    if not definition or intent.generation ~= definition.generation then
      return fog_rejected_plan_v1('generation-mismatch', current_meta, current_tiles)
    end
    for index = 1, count do
      local tile = intent.tiles[index]
      if tile.generation ~= intent.generation then
        return fog_rejected_plan_v1('generation-mismatch', current_meta, current_tiles)
      end
      if not fog_valid_tile_for_definition_v1(tile, definition) then
        return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
      end
    end
    local by_field = {}
    for index = 1, #current_tiles do
      local tile = current_tiles[index]
      by_field[fog_field_v1(tile)] = tile
    end
    for index = 1, count do
      local incoming = intent.tiles[index]
      local field = fog_field_v1(incoming)
      local current = by_field[field]
      if current and not fog_newer_v1(incoming, current) then
        return fog_rejected_plan_v1('conflict', current_meta, current_tiles)
      end
    end
    local next_count = #current_tiles
    for index = 1, count do
      local incoming = intent.tiles[index]
      local field = fog_field_v1(incoming)
      if not by_field[field] then next_count = next_count + 1 end
      by_field[field] = incoming
    end
    if next_count > 256 then return fog_rejected_plan_v1('overloaded', current_meta, current_tiles) end
    local next_tiles = {}
    for _, tile in pairs(by_field) do next_tiles[#next_tiles + 1] = tile end
    table.sort(next_tiles, fog_compare_tiles_v1)
    local planned_tiles = {}
    for index = 1, count do planned_tiles[index] = intent.tiles[index] end
    table.sort(planned_tiles, fog_compare_tiles_v1)
    local tile_actions = {}
    for index = 1, #planned_tiles do
      local tile = planned_tiles[index]
      tile_actions[index] = {
        field = fog_field_v1(tile),
        action = 'set',
        value = fog_encode_tile_v1(tile)
      }
    end
    local plan = {1, fog_encode_state_v1(current_meta, next_tiles), 'keep', tile_actions}
    fog_plan_meta_values_v1[plan] = false
    return plan
  end

  return fog_rejected_plan_v1('invalid', current_meta, current_tiles)
end

fn_fog_apply_v1 = function(metaKey, tilesKey, approvedPlan)
  local meta_value = fog_plan_meta_values_v1[approvedPlan]
  if meta_value == nil or type(approvedPlan) ~= 'table' or approvedPlan[1] ~= 1 then
    error('invalid fog authority plan')
  end
  fog_plan_meta_values_v1[approvedPlan] = nil
  if approvedPlan[3] == 'set' then
    redis.call('HSET', metaKey, 'current', meta_value)
  elseif approvedPlan[3] == 'delete' then
    redis.call('HDEL', metaKey, 'current')
  end
  local actions = approvedPlan[4]
  for index = 1, #actions do
    local action = actions[index]
    if action.action == 'set' then
      redis.call('HSET', tilesKey, action.field, action.value)
    else
      redis.call('HDEL', tilesKey, action.field)
    end
  end
  return {1}
end
end`;

function ownDataValues(
  value: unknown,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid fog authority Redis value');
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Invalid fog authority Redis value');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== required.length ||
    keys.some((key) => typeof key !== 'string' || !required.includes(key))
  ) {
    throw new TypeError('Invalid fog authority Redis value');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError('Invalid fog authority Redis value');
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function assembleFogAuthorityRedisScriptV1(trustedHostSource: string): string {
  if (typeof trustedHostSource !== 'string') {
    throw new TypeError('Fog authority Redis host source must be a primitive string');
  }
  if (trustedHostSource.includes('\0')) {
    throw new TypeError('Fog authority Redis host source must not contain NUL');
  }
  if (new TextEncoder().encode(trustedHostSource).byteLength > MAX_HOST_SOURCE_BYTES) {
    throw new RangeError('Fog authority Redis host source exceeds 256 KiB');
  }
  return `${FOG_AUTHORITY_REDIS_LIBRARY_V1}\n${trustedHostSource}`;
}

export function encodeFogAuthorityRedisIntentV1(intent: FogAuthorityIntent): string {
  if (typeof intent !== 'object' || intent === null) {
    throw new TypeError('Invalid fog authority Redis intent');
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(intent, 'kind');
  if (!kindDescriptor?.enumerable || !('value' in kindDescriptor)) {
    throw new TypeError('Invalid fog authority Redis intent');
  }
  const common = ownDataValues(
    intent,
    kindDescriptor.value === 'meta'
      ? ['schema', 'kind', 'record']
      : ['schema', 'kind', 'generation', 'tiles'],
  );
  if (common['schema'] !== 1) throw new TypeError('Invalid fog authority Redis intent');
  let mutation: AuthorityMutation;
  if (common['kind'] === 'meta') {
    mutation = { kind: 'fog-meta', record: common['record'] as never };
  } else if (common['kind'] === 'patch') {
    mutation = {
      kind: 'fog-patch',
      generation: common['generation'] as never,
      tiles: common['tiles'] as never,
    };
  } else {
    throw new TypeError('Invalid fog authority Redis intent');
  }
  const copy = prepareFogAuthorityIntent(mutation);
  if (copy === null) throw new TypeError('Invalid fog authority Redis intent');
  return JSON.stringify(copy);
}

function validStateJson(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (new TextEncoder().encode(value).byteLength > MAX_STATE_JSON_BYTES) return false;
  try {
    return isValidFogAuthorityState(JSON.parse(value) as unknown);
  } catch {
    return false;
  }
}

function arrayDataValues(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Invalid fog authority Redis plan result');
  }
  const length = value.length;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    throw new TypeError('Invalid fog authority Redis plan result');
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError('Invalid fog authority Redis plan result');
    }
    result.push(descriptor.value);
  }
  return result;
}

export function parseFogAuthorityRedisPlanResultV1(value: unknown): FogAuthorityRedisPlanResultV1 {
  const values = arrayDataValues(value);
  if (values.length === 2 && values[0] === 'accepted' && validStateJson(values[1])) {
    return Object.freeze({ status: 'accepted' as const, nextStateJson: values[1] });
  }
  const reasons = ['invalid', 'conflict', 'generation-mismatch', 'overloaded'] as const;
  if (
    values.length === 3 &&
    values[0] === 'rejected' &&
    reasons.some((reason) => reason === values[1]) &&
    validStateJson(values[2])
  ) {
    return Object.freeze({
      status: 'rejected' as const,
      reason: values[1] as (typeof reasons)[number],
      currentStateJson: values[2],
    });
  }
  throw new TypeError('Invalid fog authority Redis plan result');
}
