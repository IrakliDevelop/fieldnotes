import type { PluginSnapshot, SyncOp } from '@fieldnotes/sync';
import type { ApplyResult, ServerOpContext, ServerSyncPlugin } from '@fieldnotes/sync-server';
import { FogLedger } from './fog/fog-ledger';
import type { FogMetaRecord, FogSnapshot, FogTileRecord } from './fog/fog-sync-types';
import { FogBackendServiceKey } from './sync/fog-backend-service';

export { FogLedger } from './fog/fog-ledger';

type FogOp = Extract<SyncOp, { kind: 'fog-meta' | 'fog-patch' }>;

export interface FogAuthorizationContext {
  readonly userId?: string;
  readonly role?: string;
  readonly room: string;
  readonly op: FogOp;
  readonly current: FogSnapshot | undefined;
}

export interface FogServerPluginOptions {
  authorize?(context: FogAuthorizationContext): boolean | Promise<boolean>;
  filterSnapshot?(
    snapshot: PluginSnapshot,
    viewer: { userId?: string; role?: string },
  ): PluginSnapshot | null;
}

export function createFogServerPlugin(options: FogServerPluginOptions = {}): ServerSyncPlugin {
  const memory = new Map<string, FogLedger>();
  const ledger = (room: string): FogLedger => {
    let value = memory.get(room);
    if (!value) {
      value = new FogLedger();
      memory.set(room, value);
    }
    return value;
  };
  const snapshot = async (context: ServerOpContext): Promise<FogSnapshot | undefined> => {
    const backend = context.backendPlugin(FogBackendServiceKey);
    return backend ? backend.snapshot(context.room) : ledger(context.room).snapshot();
  };
  const applyMeta = async (context: ServerOpContext, record: FogMetaRecord) => {
    const backend = context.backendPlugin(FogBackendServiceKey);
    return backend
      ? backend.applyMeta(context.room, record)
      : ledger(context.room).applyMeta(record);
  };
  const applyPatch = async (context: ServerOpContext, records: readonly FogTileRecord[]) => {
    const backend = context.backendPlugin(FogBackendServiceKey);
    return backend
      ? backend.applyPatch(context.room, records)
      : ledger(context.room).applyPatch(records);
  };
  const process = async (op: FogOp, context: ServerOpContext): Promise<ApplyResult> => {
    const current = await snapshot(context);
    if (
      options.authorize &&
      !(await options.authorize({
        userId: context.userId,
        role: context.role,
        room: context.room,
        op,
        current,
      }))
    ) {
      if (op.kind === 'fog-meta') {
        return {
          accepted: null,
          corrections: [
            { kind: 'fog-meta', record: current?.meta ?? { version: 1, editor: 'hub' } },
          ],
        };
      }
      if (!current?.meta.definition) {
        return {
          accepted: null,
          corrections: [
            {
              kind: 'fog-meta',
              record: current?.meta ?? { version: 1, editor: 'hub' },
            },
          ],
        };
      }
      return {
        accepted: null,
        corrections: [
          {
            kind: 'fog-patch',
            generation: current.meta.definition.generation,
            tiles: op.tiles.map(
              (tile) =>
                current.tiles.find(
                  (candidate) => candidate.x === tile.x && candidate.y === tile.y,
                ) ?? {
                  generation: current.meta.definition?.generation ?? op.generation,
                  x: tile.x,
                  y: tile.y,
                  version: 1,
                  editor: 'hub',
                },
            ),
          },
        ],
      };
    }
    if (op.kind === 'fog-meta') {
      const result = await applyMeta(context, op.record);
      return result.accepted
        ? { accepted: op, corrections: [], locality: 'shared' }
        : {
            accepted: null,
            corrections: result.correction ? [{ kind: 'fog-meta', record: result.correction }] : [],
          };
    }
    const result = await applyPatch(context, op.tiles);
    return {
      accepted:
        result.accepted.length > 0
          ? { kind: 'fog-patch', generation: op.generation, tiles: result.accepted }
          : null,
      corrections:
        result.corrections.length > 0
          ? [
              {
                kind: 'fog-patch',
                generation: result.corrections[0]?.generation ?? op.generation,
                tiles: result.corrections,
              },
            ]
          : [],
      locality: 'shared',
    };
  };

  return {
    name: 'fog',
    ownedLegacyKinds: ['fog-meta', 'fog-patch'],
    legacySnapshotKey: 'fog',
    async process(op, context, next) {
      if (op.kind !== 'fog-meta' && op.kind !== 'fog-patch') return next(op, context);
      return process(op, context);
    },
    async applyFanout(op, context) {
      if (op.kind !== 'fog-meta' && op.kind !== 'fog-patch') return null;
      if (context.backend.sharedAcrossInstances && context.backendPlugin(FogBackendServiceKey)) {
        return op;
      }
      if (op.kind === 'fog-meta') {
        const result = await applyMeta(context, op.record);
        return result.accepted ? op : null;
      }
      const result = await applyPatch(context, op.tiles);
      return result.accepted.length > 0
        ? { kind: 'fog-patch', generation: op.generation, tiles: result.accepted }
        : null;
    },
    async snapshot(room, backend) {
      const context: ServerOpContext = {
        room,
        connectionId: 'snapshot',
        backend,
        backendPlugin: (key) => backend.getService?.(key),
      };
      const data = await snapshot(context);
      return data ? { pluginName: 'fog', version: 1, data } : undefined;
    },
    filterSnapshot: options.filterSnapshot,
  };
}
