import type { CanvasElement } from '@fieldnotes/core';
import type {
  SyncOp,
  LayerRecord,
  FogSnapshot,
  FogMetaRecord,
  FogTileRecord,
} from '@fieldnotes/sync';

export interface HubBackend {
  snapshot(room: string): Promise<CanvasElement[]>;
  get(room: string, id: string): Promise<CanvasElement | undefined>;
  apply(room: string, op: SyncOp): Promise<void>;
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
  fogSnapshot?(room: string): Promise<FogSnapshot | undefined>;
  applyFogMeta?(room: string, record: FogMetaRecord): Promise<void>;
  applyFogTile?(room: string, record: FogTileRecord): Promise<void>;
}
