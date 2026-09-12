import { createScriptRunner } from '@fieldnotes/sync-redis';
import type { BackendSyncPlugin, RedisHashClient, ScriptRunner } from '@fieldnotes/sync-redis';
import {
  isValidFogMetaRecord,
  isValidFogSnapshot,
  type FogMetaRecord,
  type FogSnapshot,
  type FogTileRecord,
} from './fog/fog-sync-types';
import { canonicalizeFogTile } from './fog/tile-codec';
import {
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
  tileIntersectsDefinition,
} from './fog/fog-redis-scripts';
import type { FogMetaTileReplacement } from './fog/fog-redis-scripts';
import {
  FogBackendServiceKey,
  type FogApplyResult,
  type FogBackendService,
  type FogPatchApplyResult,
} from './sync/fog-backend-service';

export {
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
  tileIntersectsDefinition,
} from './fog/fog-redis-scripts';
export type { FogRedisApplyResult, FogRedisPatchApplyResult } from './fog/fog-redis-scripts';

class RedisFogBackend implements FogBackendService {
  private readonly run: ScriptRunner;

  constructor(
    private readonly client: RedisHashClient,
    private readonly roomKey: (room: string) => string,
  ) {
    if (!client.eval) {
      throw new Error('Redis fog persistence requires a Redis client with EVAL support');
    }
    this.run = createScriptRunner(client);
  }

  private metaKey(room: string): string {
    return `${this.roomKey(room)}:fog:meta`;
  }

  private tilesKey(room: string): string {
    return `${this.roomKey(room)}:fog:tiles`;
  }

  async snapshot(room: string): Promise<FogSnapshot | undefined> {
    const metaRaw = await this.client.hGet(this.metaKey(room), 'current');
    if (metaRaw === null) return undefined;
    let meta: unknown;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return undefined;
    }
    if (!isValidFogMetaRecord(meta)) return undefined;
    if (!meta.definition) return { meta, tiles: [] };
    const stored = await this.client.hGetAll(this.tilesKey(room));
    const tiles: FogTileRecord[] = [];
    const seen = new Set<string>();
    for (const raw of Object.values(stored)) {
      let tile: unknown;
      try {
        tile = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isValidFogSnapshot({ meta, tiles: [tile] })) continue;
      const valid = tile as FogTileRecord;
      if (!tileIntersectsDefinition(valid.x, valid.y, meta.definition)) continue;
      const key = `${valid.x},${valid.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(valid);
      if (tiles.length === 256) break;
    }
    const snapshot = { meta, tiles };
    return isValidFogSnapshot(snapshot) ? snapshot : undefined;
  }

  async applyMeta(room: string, record: FogMetaRecord): Promise<FogApplyResult<FogMetaRecord>> {
    const metaRaw = await this.client.hGet(this.metaKey(room), 'current');
    let current: FogMetaRecord | undefined;
    if (metaRaw !== null) {
      try {
        const parsed: unknown = JSON.parse(metaRaw);
        if (isValidFogMetaRecord(parsed)) current = parsed;
      } catch {
        // A valid winning record atomically replaces corrupt metadata.
      }
    }
    // Only a same-generation change keeps tiles; the script drops the hash otherwise.
    const definition = record.definition;
    const replacements =
      current?.definition && definition && current.definition.generation === definition.generation
        ? metaTileReplacements(await this.client.hGetAll(this.tilesKey(room)), current, definition)
        : [];
    const result = await this.eval(FOG_META_LWW_SCRIPT, room, record, [
      JSON.stringify(replacements),
    ]);
    return parseFogRedisMetaResult(result, isValidFogMetaRecord);
  }

  async applyTile(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>> {
    const result = await this.applyPatch(room, [record]);
    return result.accepted.length === 1
      ? { accepted: true }
      : { accepted: false, correction: result.corrections[0] };
  }

  async applyPatch(room: string, records: readonly FogTileRecord[]): Promise<FogPatchApplyResult> {
    const metaRaw = await this.client.hGet(this.metaKey(room), 'current');
    if (metaRaw === null) return { accepted: [], corrections: [] };
    let meta: unknown;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return { accepted: [], corrections: [] };
    }
    if (!isValidFogMetaRecord(meta)) return { accepted: [], corrections: [] };
    const definition = meta.definition;
    if (!definition) return { accepted: [], corrections: [] };
    // Semantic tile validation the script cannot do (base fill, edge padding).
    // The script re-checks generation, bounds, LWW and capacity against the state
    // it reads itself, so this read of the meta record never needs to be a CAS.
    if (records.some((tile) => !isValidFogSnapshot({ meta, tiles: [tile] }))) {
      return {
        accepted: [],
        corrections: records.map((tile) => ({
          generation: definition.generation,
          x: tile.x,
          y: tile.y,
          version: 1,
          editor: 'hub',
        })),
      };
    }
    const result = await this.eval(FOG_PATCH_LWW_SCRIPT, room, records, []);
    return parseFogRedisPatchResult(result);
  }

  private async eval(
    script: string,
    room: string,
    record: object,
    extraArguments: readonly string[],
  ): Promise<unknown> {
    return this.run(script, {
      keys: [this.metaKey(room), this.tilesKey(room)],
      arguments: [JSON.stringify(record), ...extraArguments],
    });
  }
}

/**
 * The guarded rewrite of every tile the caller read, for a same-generation
 * definition change: each stored record is re-stored canonically, or dropped
 * when it is invalid, misfiled, outside the new bounds, or now equal to the base
 * fill. Tiles written after this read carry no entry and are left untouched.
 */
function metaTileReplacements(
  stored: Record<string, string>,
  current: FogMetaRecord,
  definition: NonNullable<FogMetaRecord['definition']>,
): FogMetaTileReplacement[] {
  const replacements: FogMetaTileReplacement[] = [];
  for (const [field, expectedRaw] of Object.entries(stored)) {
    const tile = canonicalMetaTile(field, expectedRaw, current, definition);
    replacements.push(tile ? { field, expectedRaw, tile } : { field, expectedRaw });
  }
  return replacements;
}

function canonicalMetaTile(
  field: string,
  raw: string,
  current: FogMetaRecord,
  definition: NonNullable<FogMetaRecord['definition']>,
): FogTileRecord | undefined {
  let tile: unknown;
  try {
    tile = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isValidFogSnapshot({ meta: current, tiles: [tile] })) return undefined;
  const valid = tile as FogTileRecord;
  if (field !== `${valid.x},${valid.y}`) return undefined;
  if (!tileIntersectsDefinition(valid.x, valid.y, definition)) return undefined;
  if (valid.data === undefined) return valid;
  const canonical = canonicalizeFogTile({ x: valid.x, y: valid.y, data: valid.data }, definition);
  return canonical ? { ...valid, data: canonical.data } : undefined;
}

export function createFogBackendPlugin(): BackendSyncPlugin {
  return {
    name: 'fog',
    keyPrefix: 'fog',
    scripts: { meta: FOG_META_LWW_SCRIPT, patch: FOG_PATCH_LWW_SCRIPT },
    start(context) {
      context.registerService(
        FogBackendServiceKey,
        new RedisFogBackend(context.client, context.roomKey),
      );
    },
  };
}

export { FogBackendServiceKey } from './sync/fog-backend-service';
export type {
  FogApplyResult,
  FogBackendService,
  FogPatchApplyResult,
} from './sync/fog-backend-service';
