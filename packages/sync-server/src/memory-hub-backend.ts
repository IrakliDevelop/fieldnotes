import { applyOpToMap, type SyncOp } from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';
import type { HubBackend } from './hub-backend';

export class MemoryHubBackend implements HubBackend {
  private rooms = new Map<string, Map<string, CanvasElement>>();

  private room(id: string): Map<string, CanvasElement> {
    let r = this.rooms.get(id);
    if (!r) {
      r = new Map();
      this.rooms.set(id, r);
    }
    return r;
  }

  async snapshot(room: string): Promise<CanvasElement[]> {
    return [...this.room(room).values()];
  }

  async apply(room: string, op: SyncOp): Promise<void> {
    applyOpToMap(this.room(room), op);
  }
}
