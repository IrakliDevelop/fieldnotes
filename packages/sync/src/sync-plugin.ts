import type { CanvasElement } from '@fieldnotes/core';
import type { LayerRecord, SyncOp } from './protocol';

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

export interface OpCodec<TPayload> {
  validate(payload: unknown): payload is TPayload;
}

export interface ExtensionKind<TPayload> {
  readonly extensionKind: string;
  readonly codec: OpCodec<TPayload>;
  readonly legacy?: {
    readonly kinds: readonly string[];
    readonly encode: (payload: TPayload) => SyncOp;
    readonly decode: (op: SyncOp) => TPayload | null;
  };
}

export function createExtensionKind<TPayload>(
  definition: ExtensionKind<TPayload>,
): ExtensionKind<TPayload> {
  return definition;
}

export interface TypedExtensionOp<TPayload> {
  readonly kind: 'extension';
  readonly extensionKind: string;
  readonly payload: TPayload;
}

export interface ClientOpMeta {
  readonly sender: string;
  readonly isLocal: boolean;
  readonly phase: 'live' | 'reconnect' | 'snapshot';
}

export interface ClientExtensionRegistry {
  register<TPayload>(
    kind: ExtensionKind<TPayload>,
    handler: (op: TypedExtensionOp<TPayload>, meta: ClientOpMeta) => void,
  ): void;
}

export interface ClientSyncPluginContext {
  readonly clientId: string;
  send(op: SyncOp): void;
}

export interface ClientSyncPlugin {
  readonly name: string;
  readonly ownedLegacyKinds?: readonly string[];
  readonly legacySnapshotKey?: string;
  readonly snapshotVersion?: number;
  validateClientId?(clientId: string): void;
  start?(context: ClientSyncPluginContext): (() => void) | undefined;
  onReconnect?(): void;
  createSnapshot?(): unknown;
  handleOp?(op: SyncOp, meta: ClientOpMeta): void;
  applySnapshot?(
    snapshot: PluginSnapshot,
    meta: { phase: 'initial' | 'reconnect' | 'offline-replay' },
  ): void;
  validateSnapshot?(data: unknown): boolean;
  migrateSnapshot?(data: unknown, fromVersion: number): unknown;
  registerExtensionKinds?(registry: ClientExtensionRegistry): void;
  dispose?(): void;
}

interface ClientExtensionEntry {
  readonly kind: ExtensionKind<unknown>;
  readonly handler: (op: TypedExtensionOp<unknown>, meta: ClientOpMeta) => void;
}

export class ClientPluginRegistry {
  private readonly byName = new Map<string, ClientSyncPlugin>();
  private readonly legacyOwners = new Map<string, ClientSyncPlugin>();
  private readonly extensions = new Map<string, ClientExtensionEntry>();

  constructor(plugins: readonly ClientSyncPlugin[]) {
    for (const plugin of plugins) this.register(plugin);
  }

  private register(plugin: ClientSyncPlugin): void {
    if (this.byName.has(plugin.name)) throw new Error(`Sync plugin "${plugin.name}" is duplicated`);
    this.byName.set(plugin.name, plugin);
    for (const kind of plugin.ownedLegacyKinds ?? []) {
      if (this.legacyOwners.has(kind)) throw new Error(`Sync op kind "${kind}" has two owners`);
      this.legacyOwners.set(kind, plugin);
    }
    plugin.registerExtensionKinds?.({
      register: <TPayload>(
        kind: ExtensionKind<TPayload>,
        handler: (op: TypedExtensionOp<TPayload>, meta: ClientOpMeta) => void,
      ) => {
        if (this.extensions.has(kind.extensionKind)) {
          throw new Error(`Extension kind "${kind.extensionKind}" has two owners`);
        }
        this.extensions.set(kind.extensionKind, {
          kind: kind as ExtensionKind<unknown>,
          handler: handler as (op: TypedExtensionOp<unknown>, meta: ClientOpMeta) => void,
        });
      },
    });
  }

  get plugins(): readonly ClientSyncPlugin[] {
    return [...this.byName.values()];
  }

  ownerOf(kind: string): ClientSyncPlugin | undefined {
    return this.legacyOwners.get(kind);
  }

  dispatchExtension(op: TypedExtensionOp<unknown>, meta: ClientOpMeta): boolean {
    const entry = this.extensions.get(op.extensionKind);
    if (!entry || !entry.kind.codec.validate(op.payload)) return false;
    entry.handler(op, meta);
    return true;
  }

  get extensionKinds(): readonly string[] {
    return [...this.extensions.keys()];
  }

  get extensionDefinitions(): ReadonlyMap<string, ExtensionKind<unknown>> {
    return new Map([...this.extensions].map(([name, entry]) => [name, entry.kind]));
  }
}
