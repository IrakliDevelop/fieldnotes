import type { ServiceKey } from '@fieldnotes/core';
import {
  isValidElement,
  isValidLayerRecord,
  type LayerRecord,
  type SyncElement,
  type SyncOp,
} from '@fieldnotes/sync';
import type { HubBackend } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';
import type { BackendSyncPlugin } from './sync-plugin';
import { encodeRoomKey } from './room-key';

export interface RedisHubBackendOptions {
  keyPrefix?: string;
  plugins?: readonly BackendSyncPlugin[];
  /**
   * Opt-in sliding expiry, refreshed on element, layer and plugin writes and snapshots. A room with no
   * writes and no joins for this long is deleted, so choose it well above the longest idle session.
   */
  ttlSeconds?: number;
}

export class RedisHubBackend implements HubBackend {
  readonly sharedAcrossInstances = true;
  private readonly client: RedisHashClient;
  private readonly keyPrefix: string;
  private readonly services = new Map<symbol, unknown>();
  private readonly pluginDisposers: (() => void)[] = [];
  private readonly expire: ((key: string) => Promise<unknown>) | undefined;
  private readonly pluginRoomKeys: ((roomKey: string) => readonly string[])[] = [];

  constructor(client: RedisHashClient, options: RedisHubBackendOptions = {}) {
    const { ttlSeconds } = options;
    const expire = client.expire?.bind(client);
    if (ttlSeconds !== undefined) {
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error('RedisHubBackend ttlSeconds must be a positive safe integer');
      }
      if (!expire) throw new Error('RedisHubBackend ttlSeconds requires client.expire');
    }
    this.expire =
      ttlSeconds === undefined || !expire ? undefined : (key) => expire(key, ttlSeconds);
    this.client = client;
    this.keyPrefix = options.keyPrefix ?? 'fieldnotes:room:';
    this.installPlugins(options.plugins ?? []);
  }

  getService<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.id) as T | undefined;
  }

  private key(room: string): string {
    return `${this.keyPrefix}${encodeRoomKey(room)}`;
  }

  private layersKey(room: string): string {
    return `${this.key(room)}:layers`;
  }

  private async touch(room: string): Promise<void> {
    const { expire } = this;
    if (!expire) return;
    const roomKey = this.key(room);
    const keys = [roomKey, this.layersKey(room), ...this.pluginRoomKeys.flatMap((k) => k(roomKey))];
    // A persisted write must not be reported as failed; the next write retries the expiry.
    await Promise.all(keys.map(expire)).catch(() => undefined);
  }

  async snapshot(room: string): Promise<SyncElement[]> {
    const [map] = await Promise.all([this.client.hGetAll(this.key(room)), this.touch(room)]);
    const out: SyncElement[] = [];
    for (const value of Object.values(map)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isValidElement(parsed)) out.push(parsed);
      } catch {
        // Corrupt fields are isolated from the rest of the room snapshot.
      }
    }
    return out;
  }

  async get(room: string, id: string): Promise<SyncElement | undefined> {
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
    else if (op.kind === 'clear') await this.client.del(key);
    await this.touch(room);
  }

  async layerRecords(room: string): Promise<LayerRecord[]> {
    const map = await this.client.hGetAll(this.layersKey(room));
    const out: LayerRecord[] = [];
    for (const value of Object.values(map)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isValidLayerRecord(parsed)) out.push(parsed);
      } catch {
        // Corrupt fields are isolated from the rest of the layer ledger.
      }
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
    await this.touch(room);
  }

  dispose(): void {
    for (const dispose of [...this.pluginDisposers].reverse()) safelyDispose(dispose);
    this.pluginDisposers.length = 0;
    this.services.clear();
  }

  private installPlugins(plugins: readonly BackendSyncPlugin[]): void {
    const names = new Set<string>();
    const prefixes = new Set<string>();
    try {
      for (const plugin of plugins) {
        if (names.has(plugin.name))
          throw new Error(`Backend plugin "${plugin.name}" is duplicated`);
        if (prefixes.has(plugin.keyPrefix)) {
          throw new Error(`Backend plugin key prefix "${plugin.keyPrefix}" is duplicated`);
        }
        names.add(plugin.name);
        prefixes.add(plugin.keyPrefix);
        const localDisposers: (() => void)[] = [];
        const serviceKeys: symbol[] = [];
        try {
          plugin.start({
            client: this.client,
            roomKeyPrefix: this.keyPrefix,
            roomKey: (room) => this.key(room),
            touchRoom: (room) => this.touch(room),
            registerService: (key, service) => {
              if (this.services.has(key.id)) {
                throw new Error(`Backend service "${key.name}" is already registered`);
              }
              this.services.set(key.id, service);
              serviceKeys.push(key.id);
            },
            addDisposer: (dispose) => localDisposers.push(dispose),
          });
        } catch (error) {
          for (const dispose of localDisposers.reverse()) safelyDispose(dispose);
          for (const key of serviceKeys) this.services.delete(key);
          throw error;
        }
        if (plugin.roomKeys) this.pluginRoomKeys.push(plugin.roomKeys.bind(plugin));
        this.pluginDisposers.push(() => {
          for (const dispose of localDisposers.reverse()) safelyDispose(dispose);
          for (const key of serviceKeys) this.services.delete(key);
        });
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
}

function safelyDispose(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // Continue rolling back later resources.
  }
}
