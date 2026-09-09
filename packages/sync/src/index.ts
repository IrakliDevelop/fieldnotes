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
export type {
  SyncOp,
  SyncEnvelope,
  SyncElement,
  LayerRecord,
  FogMetaRecord,
  FogTileRecord,
  FogSnapshot,
  SyncCapabilities,
} from './protocol';
export {
  isValidEnvelope,
  isValidElement,
  isValidLayerDefinition,
  isValidLayerRecord,
  isNewerLayerRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  isValidFogSnapshot,
  isNewerFogRecord,
  parseEnvelope,
  applyOpToMap,
  LAYER_SYNC_PROTOCOL_VERSION,
  FOG_SYNC_PROTOCOL_VERSION,
  FOG_PATCH_MAX_TILES,
} from './protocol';
export type {
  ClientSyncPlugin,
  ClientSyncPluginContext,
  ClientOpMeta,
  ClientExtensionRegistry,
  ExtensionKind,
  TypedExtensionOp,
  OpCodec,
  PluginSnapshot,
  SyncSnapshot,
} from './sync-plugin';
export { createExtensionKind } from './sync-plugin';
export {
  CapabilityHandshake,
  createCurrentCapabilities,
  createLegacyCapabilities,
  translateOpForPeer,
  DEFAULT_CAPABILITY_TIMEOUT_MS,
  DEFAULT_CAPABILITY_QUEUE_LIMIT,
} from './capabilities';
