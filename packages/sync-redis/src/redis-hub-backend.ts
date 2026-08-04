import {
  isValidElement,
  isValidLayerRecord,
  type LayerRecord,
  type SyncOp,
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
}
