import type { ServiceKey } from '@fieldnotes/core';
import type { LayerRecord, SyncElement, SyncOp } from '@fieldnotes/sync';

export interface HubBackend {
  /** True when every hub instance addresses the same atomic backing state (for example Redis). */
  readonly sharedAcrossInstances?: boolean;
  snapshot(room: string): Promise<SyncElement[]>;
  get(room: string, id: string): Promise<SyncElement | undefined>;
  apply(room: string, op: SyncOp): Promise<void>;
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
  getService?<T>(key: ServiceKey<T>): T | undefined;
}
