import type { Layer } from '@fieldnotes/core';
import { isNewerLayerRecord, type LayerRecord } from './protocol';

/**
 * Versioned layer-definition state for one canvas: the latest known
 * `LayerRecord` per layer id, including tombstones so a removal is never
 * resurrected by a stale upsert. All parties (clients and hub) converge by
 * applying the same last-writer-wins rule from `isNewerLayerRecord`.
 *
 * One ledger can outlive individual `SyncClient` instances — pass the same
 * ledger to successive clients over one store (e.g. across managed-connection
 * rebuilds) so version counters and tombstones survive credential rebuilds.
 */
export class LayerLedger {
  private readonly byId = new Map<string, LayerRecord>();

  get(id: string): LayerRecord | undefined {
    return this.byId.get(id);
  }

  /** All known records, tombstones included. */
  records(): LayerRecord[] {
    return [...this.byId.values()];
  }

  /**
   * Applies an incoming record iff it is strictly newer than the known one.
   * Returns whether it won (and was stored).
   */
  applyRemote(record: LayerRecord): boolean {
    const current = this.byId.get(record.id);
    if (current && !isNewerLayerRecord(record, current)) return false;
    this.byId.set(record.id, record);
    return true;
  }

  /**
   * Overwrites the known record unconditionally — for authoritative hub
   * corrections, which must win even against a locally-newer version.
   */
  applyAuthoritative(record: LayerRecord): void {
    this.byId.set(record.id, record);
  }

  /** Stamps and stores the next local edit of a definition. */
  recordUpsert(definition: Layer, editor: string): LayerRecord {
    const record: LayerRecord = {
      id: definition.id,
      version: this.nextVersion(definition.id),
      editor,
      definition,
    };
    this.byId.set(record.id, record);
    return record;
  }

  /** Stamps and stores a local removal tombstone. */
  recordRemove(id: string, editor: string): LayerRecord {
    const record: LayerRecord = { id, version: this.nextVersion(id), editor };
    this.byId.set(id, record);
    return record;
  }

  private nextVersion(id: string): number {
    return (this.byId.get(id)?.version ?? 0) + 1;
  }
}
