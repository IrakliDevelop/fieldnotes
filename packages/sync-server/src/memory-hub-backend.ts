import type { LayerRecord, SyncElement } from '@fieldnotes/sync';
import type { ElementWrite, HubBackend, HubRecord, StoredTombstone } from './hub-backend';

export class MemoryHubBackend implements HubBackend {
  private rooms = new Map<string, Map<string, HubRecord>>();
  private roomLayers = new Map<string, Map<string, LayerRecord>>();
  private readonly tombstoneRetentionMs: number;
  private readonly now: () => number;

  constructor(options: { tombstoneRetentionMs?: number; now?: () => number } = {}) {
    const retention = options.tombstoneRetentionMs ?? 604_800_000;
    if (!Number.isFinite(retention) || retention <= 0) {
      throw new RangeError('tombstoneRetentionMs must be a positive finite number');
    }
    this.tombstoneRetentionMs = retention;
    this.now = options.now ?? Date.now;
  }

  private room(id: string): Map<string, HubRecord> {
    let r = this.rooms.get(id);
    if (!r) {
      r = new Map();
      this.rooms.set(id, r);
    }
    return r;
  }

  private layers(room: string): Map<string, LayerRecord> {
    let r = this.roomLayers.get(room);
    if (!r) {
      r = new Map();
      this.roomLayers.set(room, r);
    }
    return r;
  }

  async snapshot(
    room: string,
  ): Promise<{ elements: SyncElement[]; tombstones: StoredTombstone[] }> {
    const records = this.room(room);
    const cutoff = this.now() - this.tombstoneRetentionMs;
    const elements: SyncElement[] = [];
    const tombstones: StoredTombstone[] = [];
    for (const [id, record] of records) {
      if (record.kind === 'element') elements.push(record.element);
      else if (record.tombstone.removedAt < cutoff) records.delete(id);
      else tombstones.push(record.tombstone);
    }
    return { elements, tombstones };
  }

  async getRecord(room: string, id: string): Promise<HubRecord | undefined> {
    return this.room(room).get(id);
  }

  async applyElement(
    room: string,
    write: ElementWrite,
    expected: { version: number; editor?: string } | null,
  ): Promise<{ ok: true } | { ok: false; current: HubRecord | undefined }> {
    const records = this.room(room);
    if (write.kind === 'clear') {
      let elementCount = 0;
      for (const [id, record] of records) {
        if (record.kind !== 'element') continue;
        elementCount++;
        const want = write.expected.get(id);
        if (want?.version !== record.element.version || want.editor !== record.element.editor)
          return { ok: false, current: record };
      }
      if (elementCount !== write.expected.size) return { ok: false, current: undefined };
      for (const tombstone of write.tombstones) {
        records.set(tombstone.id, { kind: 'tombstone', tombstone });
      }
      return { ok: true };
    }
    const id = write.kind === 'upsert' ? write.element.id : write.tombstone.id;
    const current = records.get(id);
    const stored = current?.kind === 'element' ? current.element : current?.tombstone;
    if (stored?.version !== expected?.version || stored?.editor !== expected?.editor)
      return { ok: false, current };
    records.set(
      id,
      write.kind === 'upsert'
        ? { kind: 'element', element: write.element }
        : { kind: 'tombstone', tombstone: write.tombstone },
    );
    return { ok: true };
  }

  async layerRecords(room: string): Promise<LayerRecord[]> {
    return [...this.layers(room).values()];
  }

  async getLayerRecord(room: string, id: string): Promise<LayerRecord | undefined> {
    return this.layers(room).get(id);
  }

  async applyLayerRecord(room: string, record: LayerRecord): Promise<void> {
    this.layers(room).set(record.id, record);
  }

  async evictRoom(room: string): Promise<void> {
    this.rooms.delete(room);
    this.roomLayers.delete(room);
  }
}
