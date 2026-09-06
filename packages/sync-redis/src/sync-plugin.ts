import type { SyncOp } from '@fieldnotes/sync';

export interface ApplyResult {
  accepted: SyncOp | null;
  corrections: SyncOp[];
  broadcast?: SyncOp[];
  locality?: 'shared' | 'local';
}

export interface BackendOpContext {
  readonly room: string;
}

export interface PluginSnapshot {
  readonly pluginName: string;
  readonly version: number;
  readonly data: unknown;
}

export interface BackendSyncPlugin {
  readonly name: string;
  readonly keyPrefix: string;
  readonly scripts?: Record<string, string>;
  snapshot?(room: string): Promise<PluginSnapshot>;
  applyOp?(op: SyncOp, ctx: BackendOpContext): Promise<ApplyResult>;
  dispose?(): void;
}
