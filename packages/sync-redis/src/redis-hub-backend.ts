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
import {
  canonicalizeFogTile,
  tileIntersectsDefinition,
  parseFogRedisMetaResult,
  parseFogRedisPatchResult,
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
} from '@fieldnotes/vtt';
import type { CanvasElement } from '@fieldnotes/core';
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
      return parseFogRedisMetaResult(result, isValidFogMetaRecord);
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
      return parseFogRedisPatchResult(result);
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
