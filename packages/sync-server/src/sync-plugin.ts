import type { ServiceKey } from '@fieldnotes/core';
import type { ExtensionKind, PluginSnapshot, TypedExtensionOp, WireSyncOp } from '@fieldnotes/sync';
import type { HubBackend } from './hub-backend';

export interface ApplyResult {
  readonly accepted: WireSyncOp | null;
  readonly corrections: WireSyncOp[];
  readonly broadcast?: WireSyncOp[];
  readonly locality?: 'shared' | 'local';
}

export interface ServerOpContext {
  readonly room: string;
  readonly connectionId: string;
  readonly userId?: string;
  readonly role?: string;
  readonly backend: HubBackend;
  backendPlugin<T>(key: ServiceKey<T>): T | undefined;
}

export type ServerNext = (op: WireSyncOp, context: ServerOpContext) => Promise<ApplyResult>;

export interface ServerExtensionRegistry {
  register<TPayload>(
    kind: ExtensionKind<TPayload>,
    handler: (op: TypedExtensionOp<TPayload>, context: ServerOpContext) => Promise<ApplyResult>,
  ): void;
}

export interface ServerSyncPlugin {
  readonly name: string;
  readonly ownedLegacyKinds?: readonly string[];
  readonly legacySnapshotKey?: string;
  process?(op: WireSyncOp, context: ServerOpContext, next: ServerNext): Promise<ApplyResult>;
  applyFanout?(op: WireSyncOp, context: ServerOpContext): Promise<WireSyncOp | null>;
  registerExtensionKinds?(registry: ServerExtensionRegistry): void;
  snapshot?(room: string, backend: HubBackend): Promise<PluginSnapshot | undefined>;
  filterSnapshot?(
    snapshot: PluginSnapshot,
    viewer: { userId?: string; role?: string },
  ): PluginSnapshot | null;
}

interface ServerExtensionEntry {
  readonly kind: ExtensionKind<unknown>;
  readonly plugin: ServerSyncPlugin;
  readonly handler: (
    op: TypedExtensionOp<unknown>,
    context: ServerOpContext,
  ) => Promise<ApplyResult>;
}

export class ServerPluginRegistry {
  private readonly byName = new Map<string, ServerSyncPlugin>();
  private readonly legacyOwners = new Map<string, ServerSyncPlugin>();
  private readonly extensions = new Map<string, ServerExtensionEntry>();
  private readonly definitions: ReadonlyMap<string, ExtensionKind<unknown>>;

  constructor(plugins: readonly ServerSyncPlugin[]) {
    for (const plugin of plugins) this.register(plugin);
    // Registration is constructor-only, so the translation view is fixed here
    // instead of rebuilt on every relayed frame.
    this.definitions = new Map([...this.extensions].map(([name, entry]) => [name, entry.kind]));
  }

  private register(plugin: ServerSyncPlugin): void {
    if (this.byName.has(plugin.name))
      throw new Error(`Server plugin "${plugin.name}" is duplicated`);
    this.byName.set(plugin.name, plugin);
    for (const kind of plugin.ownedLegacyKinds ?? []) {
      if (this.legacyOwners.has(kind)) throw new Error(`Sync op kind "${kind}" has two owners`);
      this.legacyOwners.set(kind, plugin);
    }
    plugin.registerExtensionKinds?.({
      register: <TPayload>(
        kind: ExtensionKind<TPayload>,
        handler: (op: TypedExtensionOp<TPayload>, context: ServerOpContext) => Promise<ApplyResult>,
      ) => {
        if (this.extensions.has(kind.extensionKind)) {
          throw new Error(`Extension kind "${kind.extensionKind}" has two owners`);
        }
        this.extensions.set(kind.extensionKind, {
          kind: kind as ExtensionKind<unknown>,
          plugin,
          handler: handler as ServerExtensionEntry['handler'],
        });
      },
    });
  }

  get plugins(): readonly ServerSyncPlugin[] {
    return [...this.byName.values()];
  }

  ownerOf(kind: string): ServerSyncPlugin | undefined {
    return this.legacyOwners.get(kind);
  }

  extension(extensionKind: string): ServerExtensionEntry | undefined {
    return this.extensions.get(extensionKind);
  }

  get extensionKinds(): readonly string[] {
    return [...this.extensions.keys()];
  }

  get extensionDefinitions(): ReadonlyMap<string, ExtensionKind<unknown>> {
    return this.definitions;
  }
}

export type { PluginSnapshot } from '@fieldnotes/sync';
