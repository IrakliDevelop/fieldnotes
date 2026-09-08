import type { CanvasElement, ServiceKey } from '@fieldnotes/core';
import {
  isValidElement,
  isValidLayerRecord,
  type LayerRecord,
  type SyncOp,
} from '@fieldnotes/sync';
import type { HubBackend } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';
import type { BackendSyncPlugin } from './sync-plugin';

export interface RedisHubBackendOptions {
  keyPrefix?: string;
  plugins?: readonly BackendSyncPlugin[];
}

export class RedisHubBackend implements HubBackend {
  readonly sharedAcrossInstances = true;
  private readonly client: RedisHashClient;
  private readonly keyPrefix: string;
  private readonly services = new Map<symbol, unknown>();
  private readonly pluginDisposers: (() => void)[] = [];

  constructor(client: RedisHashClient, options: RedisHubBackendOptions = {}) {
    this.client = client;
    this.keyPrefix = options.keyPrefix ?? 'fieldnotes:room:';
    this.installPlugins(options.plugins ?? []);
  }

  getService<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.id) as T | undefined;
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
      try {
        const parsed: unknown = JSON.parse(value);
        if (isValidElement(parsed)) out.push(parsed);
      } catch {
        // Corrupt fields are isolated from the rest of the room snapshot.
      }
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
    else if (op.kind === 'clear') await this.client.del(key);
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
