import type { CanvasElement } from '@fieldnotes/core';
import type { SyncOp, LayerRecord } from '@fieldnotes/sync';

export interface HubBackend {
  snapshot(room: string): Promise<CanvasElement[]>;
  get(room: string, id: string): Promise<CanvasElement | undefined>;
  apply(room: string, op: SyncOp): Promise<void>;
  /**
   * Optional versioned layer-definition persistence. The three methods are
   * additive and must be implemented together; when absent, the hub keeps
   * per-room layer records in its own memory (they then live and die with the
   * hub instance, while elements keep whatever durability the backend has).
   * Records include removal tombstones. An element `clear` op never touches
   * layer records.
   */
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
}
