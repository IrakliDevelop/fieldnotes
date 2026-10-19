import { assignLegacyOrder, type ServiceKey } from '@fieldnotes/core';
import {
  isValidElement,
  isValidLayerRecord,
  type LayerRecord,
  type SyncElement,
} from '@fieldnotes/sync';
import type { ElementWrite, HubBackend, HubRecord, StoredTombstone } from '@fieldnotes/sync-server';
import type { RedisHashClient } from './redis-hash-client';
import type { BackendSyncPlugin } from './sync-plugin';
import { encodeRoomKey } from './room-key';
import {
  ELEMENT_MIGRATE_SCRIPT,
  ELEMENT_SNAPSHOT_SCRIPT,
  ELEMENT_WRITE_SCRIPT,
  TOMBSTONE_EXPIRE_SCRIPT,
} from './element-scripts';
import { createScriptRunner, type ScriptRunner } from './script-runner';

export interface RedisHubBackendOptions {
  keyPrefix?: string;
  plugins?: readonly BackendSyncPlugin[];
  /**
   * Opt-in sliding expiry, refreshed on element, layer and plugin writes and snapshots. A room with no
   * writes and no joins for this long is deleted, so choose it well above the longest idle session.
   */
  ttlSeconds?: number;
  /** How long a removal tombstone is served after `removedAt`; defaults to seven days. */
  tombstoneRetentionMs?: number;
}

export class RedisHubBackend implements HubBackend {
  readonly sharedAcrossInstances = true;
  private readonly client: RedisHashClient;
  private readonly keyPrefix: string;
  private readonly services = new Map<symbol, unknown>();
  private readonly pluginDisposers: (() => void)[] = [];
  private readonly expire: ((key: string) => Promise<unknown>) | undefined;
  private readonly pluginRoomKeys: ((roomKey: string) => readonly string[])[] = [];
  private readonly runScript: ScriptRunner;
  private readonly tombstoneRetentionMs: number;
  private readonly migrations = new Map<string, Promise<void>>();

  constructor(client: RedisHashClient, options: RedisHubBackendOptions = {}) {
    const { ttlSeconds, tombstoneRetentionMs = 604_800_000 } = options;
    if (!Number.isFinite(tombstoneRetentionMs) || tombstoneRetentionMs <= 0) {
      throw new RangeError('tombstoneRetentionMs must be a positive finite number');
    }
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
    this.runScript = createScriptRunner(client);
    this.tombstoneRetentionMs = tombstoneRetentionMs;
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

  private tombstonesKey(room: string): string {
    return `${this.key(room)}:tombstones`;
  }

  private async touch(room: string): Promise<void> {
    const { expire } = this;
    if (!expire) return;
    const roomKey = this.key(room);
    const keys = [
      roomKey,
      this.layersKey(room),
      this.tombstonesKey(room),
      ...this.pluginRoomKeys.flatMap((k) => k(roomKey)),
    ];
    // A persisted write must not be reported as failed; the next write retries the expiry.
    await Promise.all(keys.map(expire)).catch(() => undefined);
  }

  async snapshot(
    room: string,
  ): Promise<{ elements: SyncElement[]; tombstones: StoredTombstone[] }> {
    const tombstonesKey = this.tombstonesKey(room);
    const keys = [this.key(room), tombstonesKey];
    const [read] = await Promise.all([
      this.migrate(room).then(() =>
        this.runScript(ELEMENT_SNAPSHOT_SCRIPT, { keys, arguments: [] }),
      ),
      this.touch(room),
    ]);
    if (!Array.isArray(read) || read.length !== 2) {
      throw new Error('Redis returned an invalid element snapshot');
    }
    const [elementMap, tombstoneMap] = read.map(fieldsToRecord);
    const cutoff = Date.now() - this.tombstoneRetentionMs;
    const tombstones: StoredTombstone[] = [];
    const expired: string[] = [];
    for (const [id, raw] of Object.entries(tombstoneMap ?? {})) {
      const tombstone = decode(raw, isStoredTombstone);
      if (!tombstone) continue;
      if (tombstone.removedAt < cutoff) expired.push(id, raw);
      else tombstones.push(tombstone);
    }
    if (expired.length > 0) {
      await this.runScript(TOMBSTONE_EXPIRE_SCRIPT, { keys: [tombstonesKey], arguments: expired });
    }
    return { elements: decodeElements(elementMap ?? {}), tombstones };
  }

  async getRecord(room: string, id: string): Promise<HubRecord | undefined> {
    await this.migrate(room);
    const element = decode(await this.client.hGet(this.key(room), id), isValidElement);
    if (element) return { kind: 'element', element };
    const tombstone = decode(
      await this.client.hGet(this.tombstonesKey(room), id),
      isStoredTombstone,
    );
    return tombstone ? { kind: 'tombstone', tombstone } : undefined;
  }

  async applyElement(
    room: string,
    write: ElementWrite,
    expectedVersion: number | null,
  ): Promise<{ ok: true } | { ok: false; current: HubRecord | undefined }> {
    await this.migrate(room);
    const expected = expectedVersion === null ? '' : String(expectedVersion);
    let args: string[];
    if (write.kind === 'clear') {
      args = [
        'clear',
        JSON.stringify(Object.fromEntries(write.expected)),
        ...write.tombstones.flatMap((t) => [t.id, JSON.stringify(t)]),
      ];
    } else if (write.kind === 'upsert') {
      args = ['upsert', write.element.id, expected, JSON.stringify(write.element)];
    } else {
      args = ['remove', write.tombstone.id, expected, JSON.stringify(write.tombstone)];
    }
    const result = await this.runScript(ELEMENT_WRITE_SCRIPT, {
      keys: [this.key(room), this.tombstonesKey(room)],
      arguments: args,
    });
    if (!Array.isArray(result) || (result[0] !== 0 && result[0] !== 1)) {
      throw new Error('Redis returned an invalid element write result');
    }
    if (result[0] === 0) return { ok: false, current: conflictRecord(result[1], result[2]) };
    await this.touch(room);
    return { ok: true };
  }

  async evictRoom(room: string): Promise<void> {
    this.migrations.delete(room);
  }

  /** Gives a pre-F1 room fractional keys once per process, in the HGETALL order its clients saw. */
  private migrate(room: string): Promise<void> {
    const memo = this.migrations.get(room);
    if (memo) return memo;
    const pending = this.migrateRoom(room);
    this.migrations.set(room, pending);
    pending.catch(() => {
      if (this.migrations.get(room) === pending) this.migrations.delete(room);
    });
    return pending;
  }

  private async migrateRoom(room: string): Promise<void> {
    const key = this.key(room);
    const elements = decodeElements(await this.client.hGetAll(key));
    const legacy = new Set(elements.filter((e) => e.index === undefined).map((e) => e.id));
    if (legacy.size === 0) return;
    const args = assignLegacyOrder(elements.map((e) => ({ ...e })))
      .filter((e) => legacy.has(e.id))
      .flatMap((e) => [e.id, JSON.stringify(e)]);
    await this.runScript(ELEMENT_MIGRATE_SCRIPT, { keys: [key], arguments: args });
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
        if (plugin.keyPrefix === 'tombstones') {
          throw new Error('Backend plugin key prefix "tombstones" is reserved');
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

function decode<T>(raw: string | null | undefined, guard: (value: unknown) => value is T) {
  if (raw == null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : undefined;
  } catch {
    // A corrupt field reads as absent, isolated from the rest of the room.
    return undefined;
  }
}

/** A flat HGETALL reply from a script, `[field, value, ...]`, as a record. */
function fieldsToRecord(reply: unknown): Record<string, string> {
  if (!Array.isArray(reply)) throw new Error('Redis returned an invalid element snapshot');
  const record: Record<string, string> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) {
    const [field, value]: unknown[] = [reply[i], reply[i + 1]];
    if (typeof field === 'string' && typeof value === 'string') record[field] = value;
  }
  return record;
}

function decodeElements(map: Record<string, string>): SyncElement[] {
  const elements: SyncElement[] = [];
  for (const raw of Object.values(map)) {
    const element = decode(raw, isValidElement);
    if (element) elements.push(element);
  }
  return elements;
}

function isStoredTombstone(value: unknown): value is StoredTombstone {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  const optionalString = (field: unknown) => field === undefined || typeof field === 'string';
  return (
    typeof t['id'] === 'string' &&
    Number.isSafeInteger(t['version']) &&
    Number(t['version']) >= 1 &&
    typeof t['editor'] === 'string' &&
    Number.isFinite(t['removedAt']) &&
    optionalString(t['ownerId']) &&
    optionalString(t['removedBy']) &&
    optionalString(t['audience'])
  );
}

function conflictRecord(kind: unknown, raw: unknown): HubRecord | undefined {
  if (typeof raw !== 'string') return undefined;
  if (kind === 'element') {
    const element = decode(raw, isValidElement);
    return element ? { kind: 'element', element } : undefined;
  }
  const tombstone = decode(raw, isStoredTombstone);
  return tombstone ? { kind: 'tombstone', tombstone } : undefined;
}

function safelyDispose(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // Continue rolling back later resources.
  }
}
