import {
  applyOpToMap,
  type LayerRecord,
  type WireSyncElement,
  type WireSyncOp,
} from '@fieldnotes/sync';
import type { HubBackend } from './hub-backend';

export class MemoryHubBackend implements HubBackend {
  private rooms = new Map<string, Map<string, WireSyncElement>>();
  private roomLayers = new Map<string, Map<string, LayerRecord>>();

  private room(id: string): Map<string, WireSyncElement> {
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

  async snapshot(room: string): Promise<WireSyncElement[]> {
    return [...this.room(room).values()];
  }

  async get(room: string, id: string): Promise<WireSyncElement | undefined> {
    return this.room(room).get(id);
  }

  async apply(room: string, op: WireSyncOp): Promise<void> {
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
}
