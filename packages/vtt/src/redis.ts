import type { BackendSyncPlugin, RedisHashClient } from '@fieldnotes/sync-redis';
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
  constructor(
    private readonly client: RedisHashClient,
    private readonly roomKeyPrefix: string,
  ) {}

  private metaKey(room: string): string {
    return `${this.roomKeyPrefix}${room}:fog:meta`;
  }

  private tilesKey(room: string): string {
    return `${this.roomKeyPrefix}${room}:fog:tiles`;
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
    for (let attempt = 0; attempt < 4; attempt++) {
      const expectedMeta = await this.client.hGet(this.metaKey(room), 'current');
      const expectedTiles = await this.client.hGetAll(this.tilesKey(room));
      const replacements: FogTileRecord[] = [];
      let current: FogMetaRecord | undefined;
      if (expectedMeta !== null) {
        try {
          const parsed: unknown = JSON.parse(expectedMeta);
          if (isValidFogMetaRecord(parsed)) current = parsed;
        } catch {
          // A valid winning record atomically replaces corrupt metadata.
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
      const result = await this.eval(FOG_META_LWW_SCRIPT, room, record, [
        expectedMeta ?? '',
        JSON.stringify(expectedTiles),
        JSON.stringify(replacements),
      ]);
      if (Array.isArray(result) && result[0] === 2) continue;
      return parseFogRedisMetaResult(result, isValidFogMetaRecord);
    }
    throw new Error('Redis fog meta update did not converge after concurrent writes');
  }

  async applyTile(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>> {
    const result = await this.applyPatch(room, [record]);
    return result.accepted.length === 1
      ? { accepted: true }
      : { accepted: false, correction: result.corrections[0] };
  }

  async applyPatch(room: string, records: readonly FogTileRecord[]): Promise<FogPatchApplyResult> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const metaRaw = await this.client.hGet(this.metaKey(room), 'current');
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
      const stored = await this.client.hGetAll(this.tilesKey(room));
      const invalidStored: Record<string, string> = {};
      for (const [field, raw] of Object.entries(stored)) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!isValidFogSnapshot({ meta, tiles: [parsed] })) invalidStored[field] = raw;
        } catch {
          invalidStored[field] = raw;
        }
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
              generation: meta.definition?.generation ?? tile.generation,
              x: tile.x,
              y: tile.y,
              version: 1,
              editor: 'hub',
            };
          }),
        };
      }
      const result = await this.eval(FOG_PATCH_LWW_SCRIPT, room, records, [
        metaRaw,
        JSON.stringify(invalidStored),
      ]);
      if (Array.isArray(result) && result[0] === 2) continue;
      return parseFogRedisPatchResult(result);
    }
    throw new Error('Redis fog patch did not converge after concurrent definition writes');
  }

  private async eval(
    script: string,
    room: string,
    record: object,
    extraArguments: readonly string[],
  ): Promise<unknown> {
    if (!this.client.eval) {
      throw new Error('Redis fog persistence requires a Redis client with EVAL support');
    }
    return this.client.eval(script, {
      keys: [this.metaKey(room), this.tilesKey(room)],
      arguments: [JSON.stringify(record), ...extraArguments],
    });
  }
}

export function createFogBackendPlugin(): BackendSyncPlugin {
  return {
    name: 'fog',
    keyPrefix: 'fog',
    scripts: { meta: FOG_META_LWW_SCRIPT, patch: FOG_PATCH_LWW_SCRIPT },
    start(context) {
      context.registerService(
        FogBackendServiceKey,
        new RedisFogBackend(context.client, context.roomKeyPrefix),
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
