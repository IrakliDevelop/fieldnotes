import type { CanvasElement } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';

export interface HubBackend {
  snapshot(room: string): Promise<CanvasElement[]>;
  get(room: string, id: string): Promise<CanvasElement | undefined>;
  apply(room: string, op: SyncOp): Promise<void>;
}
