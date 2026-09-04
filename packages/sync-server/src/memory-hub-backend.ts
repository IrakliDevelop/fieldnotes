import {
  applyOpToMap,
  FogLedger,
  type SyncOp,
  type LayerRecord,
  type FogSnapshot,
  type FogMetaRecord,
  type FogTileRecord,
} from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';
import type { FogApplyResult, FogPatchApplyResult, HubBackend } from './hub-backend';

export class MemoryHubBackend implements HubBackend {
  private rooms = new Map<string, Map<string, CanvasElement>>();
  private roomLayers = new Map<string, Map<string, LayerRecord>>();
  private roomFog = new Map<string, FogLedger>();

  private room(id: string): Map<string, CanvasElement> {
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

  async snapshot(room: string): Promise<CanvasElement[]> {
    return [...this.room(room).values()];
  }

  async get(room: string, id: string): Promise<CanvasElement | undefined> {
    return this.room(room).get(id);
  }

  async apply(room: string, op: SyncOp): Promise<void> {
    if (op.kind === 'clear') {
      // Clears elements only; layer records are a separate, longer-lived ledger.
      this.rooms.delete(room);
      return;
    }
    applyOpToMap(this.room(room), op);
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

  private fog(room: string): FogLedger {
    let ledger = this.roomFog.get(room);
    if (!ledger) {
      ledger = new FogLedger();
      this.roomFog.set(room, ledger);
    }
    return ledger;
  }

  async fogSnapshot(room: string): Promise<FogSnapshot | undefined> {
    return this.fog(room).snapshot();
  }

  async applyFogMeta(room: string, record: FogMetaRecord): Promise<FogApplyResult<FogMetaRecord>> {
    return this.fog(room).applyMeta(record);
  }

  async applyFogTile(room: string, record: FogTileRecord): Promise<FogApplyResult<FogTileRecord>> {
    return this.fog(room).applyTile(record);
  }

  async applyFogPatch(
    room: string,
    records: readonly FogTileRecord[],
  ): Promise<FogPatchApplyResult> {
    return this.fog(room).applyPatch(records);
  }
}
