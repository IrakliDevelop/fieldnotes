import {
  createAuthorityClientExtension,
  createAuthorityLegacyExtensionReducer,
} from '@fieldnotes/sync';
import type {
  AuthorityClientExtension,
  AuthorityMutation,
  AuthorityReadonly,
} from '@fieldnotes/sync';
import type { FogDefinitionV1 } from './types';
import { FOG_MAX_TILES, FOG_TILE_CELLS } from './types';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from './fog-sync-types';
import {
  isNewerFogRecord,
  isValidFogMetaRecord,
  isValidFogSnapshot,
  isValidFogTileRecord,
} from './fog-sync-types';
import { canonicalizeFogTile, validateFogDefinition } from './tile-codec';

const FOG_AUTHORITY_KEY = 'fog';
const FOG_AUTHORITY_VERSION = 1;
const FOG_AUTHORITY_PATCH_LIMIT = 64;

type FogMutation = Extract<AuthorityMutation, { kind: 'fog-meta' | 'fog-patch' }>;
type FogRejectionReason = 'invalid' | 'conflict' | 'generation-mismatch' | 'overloaded';

export type FogAuthorityIntent =
  | { readonly schema: 1; readonly kind: 'meta'; readonly record: FogMetaRecord }
  | {
      readonly schema: 1;
      readonly kind: 'patch';
      readonly generation: string;
      readonly tiles: readonly FogTileRecord[];
    };

export type FogAuthorityTransitionResult =
  | { readonly status: 'accepted'; readonly state: FogSnapshot | null }
  | {
      readonly status: 'rejected';
      readonly reason: FogRejectionReason;
      readonly current: FogSnapshot | null;
    };

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function ownDataValues(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  if (!isObject(value) || Array.isArray(value)) throw new TypeError('Invalid fog authority value');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid fog authority value');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string'))
    throw new TypeError('Invalid fog authority value');
  const names = keys as string[];
  if (
    names.length < required.length ||
    names.length > required.length + optional.length ||
    !required.every((key) => names.includes(key)) ||
    !names.every((key) => required.includes(key) || optional.includes(key))
  ) {
    throw new TypeError('Invalid fog authority value');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new TypeError('Invalid fog authority value');
    result[key] = descriptor.value;
  }
  return result;
}

function arrayValues(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError('Invalid fog authority array');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length > maximum)
    throw new TypeError('Invalid fog authority array');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) throw new TypeError('Invalid fog authority array');
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new TypeError('Invalid fog authority array');
    result.push(descriptor.value);
  }
  return result;
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !('value' in descriptor))
    throw new TypeError('Invalid fog authority value');
  return descriptor.value;
}

function copyDefinition(value: unknown): FogDefinitionV1 {
  const source = ownDataValues(value, [
    'version',
    'generation',
    'bounds',
    'cellSize',
    'tileCells',
    'base',
  ]);
  const sourceBounds = ownDataValues(source['bounds'], ['x', 'y', 'w', 'h']);
  const bounds = Object.freeze({
    x: sourceBounds['x'],
    y: sourceBounds['y'],
    w: sourceBounds['w'],
    h: sourceBounds['h'],
  });
  const candidate = {
    version: source['version'],
    generation: source['generation'],
    bounds,
    cellSize: source['cellSize'],
    tileCells: source['tileCells'],
    base: source['base'],
  };
  try {
    validateFogDefinition(candidate);
  } catch {
    throw new TypeError('Invalid fog authority definition');
  }
  return Object.freeze(candidate) as FogDefinitionV1;
}

function copyMeta(value: unknown): FogMetaRecord {
  const source = ownDataValues(value, ['version', 'editor'], ['definition']);
  const candidate = Object.hasOwn(source, 'definition')
    ? {
        version: source['version'],
        editor: source['editor'],
        definition: copyDefinition(source['definition']),
      }
    : { version: source['version'], editor: source['editor'] };
  if (!isValidFogMetaRecord(candidate)) throw new TypeError('Invalid fog authority metadata');
  return Object.freeze(candidate);
}

function copyTile(value: unknown): FogTileRecord {
  const source = ownDataValues(value, ['generation', 'x', 'y', 'version', 'editor'], ['data']);
  const candidate = Object.hasOwn(source, 'data')
    ? {
        generation: source['generation'],
        x: source['x'],
        y: source['y'],
        version: source['version'],
        editor: source['editor'],
        data: source['data'],
      }
    : {
        generation: source['generation'],
        x: source['x'],
        y: source['y'],
        version: source['version'],
        editor: source['editor'],
      };
  if (
    typeof candidate.generation !== 'string' ||
    typeof candidate.x !== 'number' ||
    typeof candidate.y !== 'number' ||
    typeof candidate.version !== 'number' ||
    typeof candidate.editor !== 'string' ||
    (Object.hasOwn(candidate, 'data') && typeof candidate.data !== 'string')
  ) {
    throw new TypeError('Invalid fog authority tile');
  }
  if (!isValidFogTileRecord(candidate)) throw new TypeError('Invalid fog authority tile');
  return Object.freeze(candidate) as FogTileRecord;
}

function compareTiles(a: FogTileRecord, b: FogTileRecord): number {
  return a.x !== b.x ? a.x - b.x : a.y - b.y;
}

function tileKey(record: Pick<FogTileRecord, 'x' | 'y'>): string {
  return `${record.x},${record.y}`;
}

function equalValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function copyState(value: unknown, requireSorted = false): FogSnapshot | null {
  if (value === null) return null;
  const source = ownDataValues(value, ['meta', 'tiles']);
  const meta = copyMeta(source['meta']);
  const rawTiles = arrayValues(source['tiles'], FOG_MAX_TILES);
  const tiles = rawTiles.map(copyTile);
  if (requireSorted) {
    for (let index = 1; index < tiles.length; index++) {
      const previous = tiles[index - 1];
      const current = tiles[index];
      if (!previous || !current || compareTiles(previous, current) >= 0)
        throw new TypeError('Invalid fog authority tile order');
    }
  }
  const sorted = Object.freeze([...tiles].sort(compareTiles));
  const candidate = Object.freeze({ meta, tiles: sorted });
  if (!isValidFogSnapshot(candidate)) throw new TypeError('Invalid fog authority snapshot');
  return candidate;
}

export function isValidFogAuthorityState(value: unknown): value is FogSnapshot | null {
  try {
    copyState(value, true);
    return true;
  } catch {
    return false;
  }
}

function copyCurrent(value: unknown): FogSnapshot | null {
  return copyState(value);
}

function rejected(
  reason: FogRejectionReason,
  current: FogSnapshot | null,
): FogAuthorityTransitionResult {
  return Object.freeze({ status: 'rejected' as const, reason, current });
}

function accepted(state: FogSnapshot | null): FogAuthorityTransitionResult {
  return Object.freeze({ status: 'accepted' as const, state });
}

function mutationKind(value: unknown): unknown {
  if (!isObject(value) || Array.isArray(value)) return undefined;
  return dataProperty(value, 'kind');
}

function copyFogMutation(value: unknown): FogMutation {
  const kind = mutationKind(value);
  if (kind === 'fog-meta') {
    const source = ownDataValues(value, ['kind', 'record']);
    return Object.freeze({ kind, record: copyMeta(source['record']) });
  }
  if (kind === 'fog-patch') {
    const source = ownDataValues(value, ['kind', 'generation', 'tiles']);
    if (
      typeof source['generation'] !== 'string' ||
      source['generation'].length === 0 ||
      source['generation'].length > 128 ||
      !/^[\x20-\x7e]+$/.test(source['generation'])
    )
      throw new TypeError('Invalid fog authority patch');
    const rawTiles = arrayValues(source['tiles'], FOG_AUTHORITY_PATCH_LIMIT);
    if (rawTiles.length === 0) throw new TypeError('Invalid fog authority patch');
    const tiles = Object.freeze(rawTiles.map(copyTile));
    const seen = new Set<string>();
    for (const record of tiles) {
      const key = tileKey(record);
      if (seen.has(key)) throw new TypeError('Invalid fog authority patch');
      seen.add(key);
    }
    return Object.freeze({ kind, generation: source['generation'], tiles });
  }
  throw new TypeError('Invalid fog authority mutation');
}

function copyIntent(value: unknown): FogAuthorityIntent {
  const sourceKind = mutationKind(value);
  if (sourceKind === 'meta') {
    const source = ownDataValues(value, ['schema', 'kind', 'record']);
    if (source['schema'] !== 1) throw new TypeError('Invalid fog authority intent');
    return Object.freeze({
      schema: 1 as const,
      kind: 'meta' as const,
      record: copyMeta(source['record']),
    });
  }
  if (sourceKind === 'patch') {
    const source = ownDataValues(value, ['schema', 'kind', 'generation', 'tiles']);
    if (source['schema'] !== 1 || typeof source['generation'] !== 'string')
      throw new TypeError('Invalid fog authority intent');
    const rawTiles = arrayValues(source['tiles'], FOG_AUTHORITY_PATCH_LIMIT);
    if (rawTiles.length === 0) throw new TypeError('Invalid fog authority intent');
    const tiles = Object.freeze(rawTiles.map(copyTile));
    const seen = new Set<string>();
    for (const record of tiles) {
      const key = tileKey(record);
      if (seen.has(key)) throw new TypeError('Invalid fog authority intent');
      seen.add(key);
    }
    return Object.freeze({
      schema: 1 as const,
      kind: 'patch' as const,
      generation: source['generation'],
      tiles,
    });
  }
  throw new TypeError('Invalid fog authority intent');
}

function matchingIntent(mutation: FogMutation, intent: FogAuthorityIntent): boolean {
  if (mutation.kind === 'fog-meta')
    return intent.kind === 'meta' && equalValue(mutation.record, intent.record);
  return (
    intent.kind === 'patch' &&
    mutation.generation === intent.generation &&
    equalValue(mutation.tiles, intent.tiles)
  );
}

function compatibleMeta(current: FogMetaRecord, incoming: FogMetaRecord): boolean {
  const before = current.definition;
  const after = incoming.definition;
  if (!before || !after || before.generation !== after.generation) return true;
  return (
    before.cellSize === after.cellSize &&
    before.tileCells === after.tileCells &&
    before.base === after.base &&
    after.bounds.x <= before.bounds.x &&
    after.bounds.y <= before.bounds.y &&
    after.bounds.x + after.bounds.w >= before.bounds.x + before.bounds.w &&
    after.bounds.y + after.bounds.h >= before.bounds.y + before.bounds.h
  );
}

function intersectsDefinition(record: FogTileRecord, definition: FogDefinitionV1): boolean {
  const size = FOG_TILE_CELLS * definition.cellSize;
  const x = record.x * size;
  const y = record.y * size;
  return !(
    x + size <= definition.bounds.x ||
    y + size <= definition.bounds.y ||
    x >= definition.bounds.x + definition.bounds.w ||
    y >= definition.bounds.y + definition.bounds.h
  );
}

function metaTransition(
  current: FogSnapshot | null,
  record: FogMetaRecord,
): FogAuthorityTransitionResult {
  if (current && !isNewerFogRecord(record, current.meta)) return rejected('conflict', current);
  if (current && !compatibleMeta(current.meta, record)) return rejected('invalid', current);
  const previousGeneration = current?.meta.definition?.generation;
  const nextDefinition = record.definition;
  const tiles: FogTileRecord[] = [];
  if (
    current &&
    nextDefinition &&
    previousGeneration !== undefined &&
    previousGeneration === nextDefinition.generation
  ) {
    for (const existing of current.tiles) {
      if (!intersectsDefinition(existing, nextDefinition)) continue;
      if (existing.data === undefined) {
        tiles.push(existing);
        continue;
      }
      const canonical = canonicalizeFogTile(
        { x: existing.x, y: existing.y, data: existing.data },
        nextDefinition,
      );
      if (canonical) tiles.push(copyTile({ ...existing, data: canonical.data }));
    }
  }
  tiles.sort(compareTiles);
  return accepted(Object.freeze({ meta: record, tiles: Object.freeze(tiles) }));
}

function patchTransition(
  current: FogSnapshot | null,
  mutation: Extract<FogMutation, { kind: 'fog-patch' }>,
): FogAuthorityTransitionResult {
  const definition = current?.meta.definition;
  if (!definition) return rejected('generation-mismatch', current);
  if (
    mutation.generation !== definition.generation ||
    mutation.tiles.some((record) => record.generation !== mutation.generation)
  ) {
    return rejected('generation-mismatch', current);
  }
  for (const record of mutation.tiles) {
    if (!intersectsDefinition(record, definition)) return rejected('invalid', current);
    if (!isValidFogSnapshot({ meta: current.meta, tiles: [record] }))
      return rejected('invalid', current);
  }
  const records = new Map<string, FogTileRecord>();
  for (const record of current.tiles) records.set(tileKey(record), record);
  for (const record of mutation.tiles) {
    const existing = records.get(tileKey(record));
    if (existing && !isNewerFogRecord(record, existing)) return rejected('conflict', current);
  }
  for (const record of mutation.tiles) records.set(tileKey(record), record);
  if (records.size > FOG_MAX_TILES) return rejected('overloaded', current);
  const tiles = Object.freeze([...records.values()].sort(compareTiles));
  return accepted(Object.freeze({ meta: current.meta, tiles }));
}

export function prepareFogAuthorityIntent(mutation: AuthorityMutation): FogAuthorityIntent | null {
  const kind = mutationKind(mutation);
  if (kind !== 'fog-meta' && kind !== 'fog-patch') return null;
  const copy = copyFogMutation(mutation);
  return copy.kind === 'fog-meta'
    ? Object.freeze({ schema: 1 as const, kind: 'meta' as const, record: copy.record })
    : Object.freeze({
        schema: 1 as const,
        kind: 'patch' as const,
        generation: copy.generation,
        tiles: copy.tiles,
      });
}

export function applyFogAuthorityIntent(
  current: FogSnapshot | null,
  mutation: AuthorityMutation,
  intent: FogAuthorityIntent,
): FogAuthorityTransitionResult {
  let currentCopy: FogSnapshot | null;
  try {
    currentCopy = copyCurrent(current);
  } catch {
    return rejected('invalid', null);
  }
  let mutationCopy: FogMutation;
  let intentCopy: FogAuthorityIntent;
  try {
    mutationCopy = copyFogMutation(mutation);
    intentCopy = copyIntent(intent);
  } catch {
    return rejected('invalid', currentCopy);
  }
  if (!matchingIntent(mutationCopy, intentCopy)) return rejected('invalid', currentCopy);
  return mutationCopy.kind === 'fog-meta'
    ? metaTransition(currentCopy, mutationCopy.record)
    : patchTransition(currentCopy, mutationCopy);
}

function reduceFog(
  state: AuthorityReadonly<FogSnapshot | null>,
  mutation: FogMutation,
): FogSnapshot | null {
  const intent = prepareFogAuthorityIntent(mutation);
  if (intent === null) throw new TypeError('Invalid fog authority mutation');
  const result = applyFogAuthorityIntent(state as FogSnapshot | null, mutation, intent);
  if (result.status === 'rejected') throw new TypeError(`Fog authority ${result.reason}`);
  return result.state;
}

function transition(
  current: FogSnapshot | null,
  mutation: FogMutation,
): FogAuthorityTransitionResult {
  const intent = prepareFogAuthorityIntent(mutation);
  if (intent === null) return rejected('invalid', copyCurrent(current));
  return applyFogAuthorityIntent(current, mutation, intent);
}

export function createFogAuthorityClientExtension(): AuthorityClientExtension<FogSnapshot | null> {
  return createAuthorityClientExtension({
    key: FOG_AUTHORITY_KEY,
    pluginName: FOG_AUTHORITY_KEY,
    version: FOG_AUTHORITY_VERSION,
    validate: isValidFogAuthorityState,
    reducers: [],
    legacyReducers: [
      createAuthorityLegacyExtensionReducer({
        kind: 'fog-meta',
        reduce: (state: AuthorityReadonly<FogSnapshot | null>, mutation) =>
          reduceFog(state, mutation),
      }),
      createAuthorityLegacyExtensionReducer({
        kind: 'fog-patch',
        reduce: (state: AuthorityReadonly<FogSnapshot | null>, mutation) =>
          reduceFog(state, mutation),
      }),
    ],
  });
}

export function diffFogAuthorityStates(
  beforeValue: unknown,
  afterValue: unknown,
): readonly AuthorityMutation[] {
  let before: FogSnapshot | null;
  let after: FogSnapshot | null;
  try {
    before = copyState(beforeValue);
    after = copyState(afterValue);
  } catch {
    return Object.freeze([]);
  }
  if (equalValue(before, after)) return Object.freeze([]);
  if (after === null) return Object.freeze([]);

  const mutations: AuthorityMutation[] = [];
  let working = before;
  if (!before || !equalValue(before.meta, after.meta)) {
    const mutation = Object.freeze({ kind: 'fog-meta' as const, record: after.meta });
    const result = transition(working, mutation);
    if (result.status === 'rejected') return Object.freeze([]);
    working = result.state;
    mutations.push(mutation);
  }
  if (!working) return Object.freeze([]);

  const desired = new Map(after.tiles.map((record) => [tileKey(record), record]));
  for (const record of working.tiles) {
    if (!desired.has(tileKey(record))) return Object.freeze([]);
  }
  const delta = after.tiles.filter((record) => {
    const current = working?.tiles.find((candidate) => tileKey(candidate) === tileKey(record));
    return !current || !equalValue(current, record);
  });
  for (let start = 0; start < delta.length; start += FOG_AUTHORITY_PATCH_LIMIT) {
    const tiles = Object.freeze(delta.slice(start, start + FOG_AUTHORITY_PATCH_LIMIT));
    const generation = after.meta.definition?.generation;
    if (!generation) return Object.freeze([]);
    const mutation = Object.freeze({ kind: 'fog-patch' as const, generation, tiles });
    const result = transition(working, mutation);
    if (result.status === 'rejected') return Object.freeze([]);
    working = result.state;
    mutations.push(mutation);
  }
  if (!equalValue(working, after)) return Object.freeze([]);
  return Object.freeze(mutations);
}
