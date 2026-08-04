export type { SyncTransport } from './sync-transport';
export { BroadcastChannelTransport } from './broadcast-channel-transport';
export type { BroadcastChannelTransportOptions } from './broadcast-channel-transport';
export { WebSocketTransport } from './websocket-transport';
export type { WebSocketTransportOptions } from './websocket-transport';
export { SyncClient } from './sync-client';
export type {
  SyncClientOptions,
  AuthoritativeSnapshotPhase,
  AuthoritativeSnapshotContext,
  LocalOnlyElement,
  LocalOnlyResolution,
  ResolveLocalOnly,
  LayerSyncOptions,
  RemoteLayerUpdate,
} from './sync-client';
export { LayerLedger } from './layer-ledger';
export { createManagedSyncConnection } from './managed-connection';
export type {
  ManagedSyncConnection,
  ManagedSyncConnectionOptions,
  ManagedSyncStatus,
  ManagedSyncTransport,
} from './managed-connection';
export type { SyncOp, SyncEnvelope, SyncElement, LayerRecord } from './protocol';
export {
  isValidEnvelope,
  isValidElement,
  isValidLayerDefinition,
  isValidLayerRecord,
  isNewerLayerRecord,
  parseEnvelope,
  applyOpToMap,
  LAYER_SYNC_PROTOCOL_VERSION,
} from './protocol';
