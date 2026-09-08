import { createServiceKey } from '@fieldnotes/core';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from '../fog/fog-sync-types';

export interface FogApplyResult<T> {
  readonly accepted: boolean;
  readonly correction?: T;
}

export interface FogPatchApplyResult {
  readonly accepted: FogTileRecord[];
  readonly corrections: FogTileRecord[];
}

export interface FogBackendService {
  snapshot(room: string): Promise<FogSnapshot | undefined>;
  applyMeta(room: string, record: FogMetaRecord): Promise<FogApplyResult<FogMetaRecord>>;
  applyTile(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>>;
  applyPatch(room: string, records: readonly FogTileRecord[]): Promise<FogPatchApplyResult>;
}

export const FogBackendServiceKey = createServiceKey<FogBackendService>('vtt:fog-backend');
