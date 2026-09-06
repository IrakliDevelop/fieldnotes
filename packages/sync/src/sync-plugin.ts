import type { CanvasElement } from '@fieldnotes/core';
import type { SyncOp, LayerRecord } from './protocol';

export interface PluginSnapshot {
  readonly pluginName: string;
  readonly version: number;
  readonly data: unknown;
}

export interface SyncSnapshot {
  readonly elements: CanvasElement[];
  readonly layers?: LayerRecord[];
  readonly extensions: Record<string, PluginSnapshot>;
}

export interface ClientSyncPlugin {
  readonly name: string;
  produceOps?(): SyncOp[];
  handleOp?(
    op: SyncOp,
    meta: { sender: string; isLocal: boolean; phase: 'live' | 'reconnect' | 'snapshot' },
  ): void;
  extendSnapshot?(snapshot: SyncSnapshot): void;
  applySnapshot?(
    snapshot: PluginSnapshot,
    meta: { phase: 'initial' | 'reconnect' | 'offline-replay' },
  ): void;
  validateSnapshot?(data: unknown): boolean;
  migrateSnapshot?(data: unknown, fromVersion: number): unknown;
  handleCorrection?(op: SyncOp): void;
}
