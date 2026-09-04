import {
  isValidElement,
  isValidLayerRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  type LayerRecord,
  type SyncOp,
  type FogSnapshot,
  type FogMetaRecord,
  type FogTileRecord,
} from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';
import type { HubBackend } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';

export interface RedisHubBackendOptions {
  keyPrefix?: string; // default 'fieldnotes:room:'
}

export class RedisHubBackend implements HubBackend {
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

    const tileMap = await this.client.hGetAll(this.fogTilesKey(room));
    const tiles: FogTileRecord[] = [];
    for (const value of Object.values(tileMap)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      if (isValidFogTileRecord(parsed)) tiles.push(parsed);
    }

    return { meta: meta as FogMetaRecord, tiles };
  }

  async applyFogMeta(room: string, record: FogMetaRecord): Promise<void> {
    const metaStr = await this.client.hGet(this.fogMetaKey(room), 'current');
    let oldGeneration: string | undefined;
    if (metaStr != null) {
      try {
        const oldMeta: unknown = JSON.parse(metaStr);
        if (isValidFogMetaRecord(oldMeta) && oldMeta.definition) {
          oldGeneration = oldMeta.definition.generation;
        }
      } catch {
        // corrupt, overwrite
      }
    }

    await this.client.hSet(this.fogMetaKey(room), 'current', JSON.stringify(record));

    const newGeneration = record.definition?.generation;
    if (!record.definition || (oldGeneration !== undefined && newGeneration !== oldGeneration)) {
      await this.client.del(this.fogTilesKey(room));
    }
  }

  async applyFogTile(room: string, record: FogTileRecord): Promise<void> {
    const key = `${record.x},${record.y}`;
    if (record.data === undefined) {
      await this.client.hDel(this.fogTilesKey(room), key);
    } else {
      await this.client.hSet(this.fogTilesKey(room), key, JSON.stringify(record));
    }
  }
}
