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
  | {
      kind: 'clear';
      tombstones: StoredTombstone[];
      expected: ReadonlyMap<string, { version: number; editor?: string }>;
    };

export interface HubBackend {
  /** True when every hub instance addresses the same atomic backing state (for example Redis). */
  readonly sharedAcrossInstances?: boolean;
  /** Live elements and unexpired tombstones of a room. */
  snapshot(room: string): Promise<{ elements: SyncElement[]; tombstones: StoredTombstone[] }>;
  getRecord(room: string, id: string): Promise<HubRecord | undefined>;
  /**
   * Writes atomically when the stored record's version and editor equal `expected` (absent equals
   * absent; `null`: no record may exist). Comparing the editor keeps two instances from both winning
   * an equal-version race. `clear` ignores it and requires its `expected` map to match every element
   * exactly.
   * A clear's tombstone ids equal its `expected` keys; backends should reject one where they differ.
   */
  applyElement(
    room: string,
    write: ElementWrite,
    expected: { version: number; editor?: string } | null,
  ): Promise<{ ok: true } | { ok: false; current: HubRecord | undefined }>;
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
  getService?<T>(key: ServiceKey<T>): T | undefined;
  /** Called after `roomIdleTimeoutMs` with no local connection; drops only state held in process memory. */
  evictRoom?(room: string): Promise<void>;
}
