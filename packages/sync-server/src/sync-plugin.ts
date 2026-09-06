import type { SyncOp } from '@fieldnotes/sync';
import type { HubBackend } from './hub-backend';

export interface ApplyResult {
  accepted: SyncOp | null;
  corrections: SyncOp[];
  broadcast?: SyncOp[];
  locality?: 'shared' | 'local';
}

export interface ServerOpContext {
  readonly room: string;
  readonly sender: string;
  readonly backend: HubBackend;
}

export type ServerNext = () => Promise<ApplyResult>;

export interface ServerSyncPlugin {
  readonly name: string;
  readonly ownedLegacyKinds?: string[];
  process?(op: SyncOp, ctx: ServerOpContext, next: ServerNext): Promise<ApplyResult>;
  snapshot?(room: string, backend: HubBackend): Promise<PluginSnapshot>;
  filterSnapshot?(
    snapshot: PluginSnapshot,
    viewer: { userId: string; role: string },
  ): PluginSnapshot | null;
}

export interface PluginSnapshot {
  readonly pluginName: string;
  readonly version: number;
  readonly data: unknown;
}
