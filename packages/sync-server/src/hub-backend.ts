import type { CanvasElement } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';

export interface HubBackend {
  snapshot(room: string): Promise<CanvasElement[]>;
  apply(room: string, op: SyncOp): Promise<void>;
}
