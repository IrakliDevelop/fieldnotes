import type { CanvasElement } from '@fieldnotes/core';
import type {
  SyncOp,
  LayerRecord,
  FogSnapshot,
  FogMetaRecord,
  FogTileRecord,
} from '@fieldnotes/sync';

export interface FogApplyResult<T> {
  readonly accepted: boolean;
  readonly correction?: T;
}

export interface FogPatchApplyResult {
  readonly accepted: FogTileRecord[];
  readonly corrections: FogTileRecord[];
}

export interface HubBackend {
  /** True when every hub instance addresses the same atomic backing state (for example Redis). */
  readonly sharedAcrossInstances?: boolean;
  snapshot(room: string): Promise<CanvasElement[]>;
  get(room: string, id: string): Promise<CanvasElement | undefined>;
  apply(room: string, op: SyncOp): Promise<void>;
  layerRecords?(room: string): Promise<LayerRecord[]>;
  getLayerRecord?(room: string, id: string): Promise<LayerRecord | undefined>;
  applyLayerRecord?(room: string, record: LayerRecord): Promise<void>;
  fogSnapshot?(room: string): Promise<FogSnapshot | undefined>;
  applyFogMeta?(room: string, record: FogMetaRecord): Promise<FogApplyResult<FogMetaRecord>>;
  applyFogTile?(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>>;
  applyFogPatch?(room: string, records: readonly FogTileRecord[]): Promise<FogPatchApplyResult>;
}
