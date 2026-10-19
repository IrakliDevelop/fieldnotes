import type { ServiceKey } from '@fieldnotes/core';
import type { LayerRecord, SyncElement, Tombstone } from '@fieldnotes/sync';

/** A tombstone as the hub stores it: the deleted element's owner and audience stay server-side. */
export interface StoredTombstone extends Tombstone {
  removedAt: number;
  ownerId?: string;
  removedBy?: string;
  audience?: SyncElement['audience'];
}

/** What a backend holds for one element id. */
export type HubRecord =
  { kind: 'element'; element: SyncElement } | { kind: 'tombstone'; tombstone: StoredTombstone };

/** One compare-and-set element write. */
export type ElementWrite =
  | { kind: 'upsert'; element: SyncElement }
  | { kind: 'remove'; tombstone: StoredTombstone }
  | { kind: 'clear'; tombstones: StoredTombstone[]; expected: ReadonlyMap<string, number> };

export interface HubBackend {
  /** True when every hub instance addresses the same atomic backing state (for example Redis). */
  readonly sharedAcrossInstances?: boolean;
  /** Live elements and unexpired tombstones of a room. */
  snapshot(room: string): Promise<{ elements: SyncElement[]; tombstones: StoredTombstone[] }>;
  getRecord(room: string, id: string): Promise<HubRecord | undefined>;
  /**
   * Writes atomically when the stored record's version equals `expectedVersion` (`null`: no record
   * may exist). `clear` ignores it and requires its `expected` map to match every element exactly.
   */
  applyElement(
    room: string,
    write: ElementWrite,
    expectedVersion: number | null,
  ): Promise<{ ok: true } | { ok: false; current: HubRecord | undefined }>;
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
  getService?<T>(key: ServiceKey<T>): T | undefined;
  /** Called after `roomIdleTimeoutMs` with no local connection; drops only state held in process memory. */
  evictRoom?(room: string): Promise<void>;
}
