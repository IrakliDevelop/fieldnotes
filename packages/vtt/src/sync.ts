import type { ClientSyncPlugin, SyncOp } from '@fieldnotes/sync';
import { FogSyncController } from './fog/fog-sync-controller';
import type { FogLedger } from './fog/fog-ledger';
import type { FogSyncManager } from './fog/fog-sync-types';
import { assertValidFogClientId, isValidFogSnapshot } from './fog/fog-sync-types';
import type { FogStateV1 } from './fog/types';

export { createFogAuthorityClientExtension } from './fog/fog-authority';

export { FogSyncController } from './fog/fog-sync-controller';

export interface FogClientPluginOptions {
  readonly manager: FogSyncManager;
  readonly preserveLocalWhenRemoteMissing?: boolean;
}

export function createFogClientPlugin(options: FogClientPluginOptions): ClientSyncPlugin {
  let controller: FogSyncController | undefined;
  let controllerClientId: string | undefined;
  let active = false;
  let disposed = false;
  // Edits made before the first start() have no controller to capture them
  // yet; buffer and replay them so offline fog is published, not wiped.
  type FogChangeEvent = Parameters<Parameters<FogSyncManager['on']>[1]>[0];
  const preStartEdits: FogChangeEvent[] = [];
  // Fog already on the board is the base state the first snapshot serves, not an edit to replay.
  const initialState = options.manager.getState();
  const offlineUnsubscribe = options.manager.on('change', (event) => {
    if (active) return;
    if (controller) controller.captureOfflineChange(event);
    else preStartEdits.push(event);
  });

  return {
    name: 'fog',
    ownedLegacyKinds: ['fog-meta', 'fog-patch'],
    snapshotVersion: 1,
    validateClientId: assertValidFogClientId,
    start(context) {
      if (disposed) throw new Error('Fog client plugin has been disposed');
      assertValidFogClientId(context.clientId);
      if (!controller) {
        controllerClientId = context.clientId;
        controller = new FogSyncController({
          clientId: context.clientId,
          manager: options.manager,
          preserveLocalWhenRemoteMissing: options.preserveLocalWhenRemoteMissing,
        });
        if (initialState) seedLedger(controller.getLedger(), initialState, context.clientId);
        for (const event of preStartEdits.splice(0)) controller.captureOfflineChange(event);
      } else if (controllerClientId !== context.clientId) {
        throw new Error('Fog client plugin cannot be reused with a different clientId');
      }
      active = true;
      const unsubscribe = controller.on('sendOp', (op) => context.send(op as SyncOp));
      controller.setEnabled(true);
      return () => {
        active = false;
        controller?.setEnabled(false);
        unsubscribe();
      };
    },
    onReconnect() {
      controller?.resetForReconnect();
    },
    createSnapshot() {
      return controller?.produceSnapshotFog();
    },
    handleOp(op, meta) {
      if (op.kind === 'fog-meta' || op.kind === 'fog-patch') {
        controller?.handleRemoteOp(meta.sender, op);
      }
    },
    validateSnapshot: (data) => data === undefined || data === null || isValidFogSnapshot(data),
    applySnapshot(snapshot) {
      controller?.mergeSnapshot(snapshot.data);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      offlineUnsubscribe();
      controller?.dispose();
      controller = undefined;
    },
  };
}

function seedLedger(ledger: FogLedger, state: FogStateV1, editor: string): void {
  const { generation } = state.definition;
  ledger.applyMeta({ version: 1, editor, definition: state.definition });
  for (const tile of state.tiles) ledger.applyTile({ generation, ...tile, version: 1, editor });
}
