export interface PersistedPluginState {
  version: number;
  data: unknown;
}

export interface PluginHandle {
  dispose(): void;
  validateState?(data: unknown): void;
  loadState?(data: unknown): void;
  exportState?(): unknown;
  migrateState?(data: unknown, fromVersion: number): unknown;
  readonly stateVersion?: number;
}

export interface NotificationController {
  resume(): void;
  discard(): void;
}

export interface PluginLoadResult {
  readonly success: boolean;
  readonly error?: string;
  readonly droppedPlugins?: string[];
}

export interface PreparedLoad {
  readonly name: string;
  readonly handle: PluginHandle;
  readonly data: unknown;
}

export interface PreparedPluginState {
  readonly loads: readonly PreparedLoad[];
  readonly previous: ReadonlyMap<string, unknown>;
  readonly previousPreservedUnknown: Record<string, PersistedPluginState>;
  readonly preservedUnknown: Record<string, PersistedPluginState>;
  readonly droppedPlugins: readonly string[];
}

export type PluginPrepareResult =
  | { readonly success: true; readonly prepared: PreparedPluginState }
  | { readonly success: false; readonly error: string };

export class PluginStateManager {
  private readonly plugins = new Map<string, PluginHandle>();
  private preservedUnknown: Record<string, PersistedPluginState> = {};

  constructor(
    private readonly suspendNotifications: () => NotificationController = createNotificationController,
  ) {}

  registerPlugin(name: string, handle: PluginHandle): void {
    if (this.plugins.has(name)) throw new Error(`Plugin "${name}" is already registered`);
    this.plugins.set(name, handle);
  }

  unregisterPlugin(name: string, handle: PluginHandle): void {
    if (this.plugins.get(name) === handle) this.plugins.delete(name);
  }

  prepareState(persisted: Record<string, PersistedPluginState>): PluginPrepareResult {
    const preparedLoads: PreparedLoad[] = [];
    const preservedUnknown: Record<string, PersistedPluginState> = {};
    const droppedPlugins: string[] = [];

    for (const [name, entry] of Object.entries(persisted)) {
      if (!this.plugins.has(name)) preservedUnknown[name] = entry;
    }

    for (const [name, handle] of this.plugins) {
      if (!handle.loadState) continue;
      const entry = persisted[name];
      let data: unknown = undefined;

      if (entry) {
        const currentVersion = handle.stateVersion ?? 1;
        data = entry.data;
        if (entry.version !== currentVersion) {
          if (!handle.migrateState) {
            droppedPlugins.push(name);
            data = undefined;
          } else {
            try {
              data = handle.migrateState(data, entry.version);
            } catch {
              droppedPlugins.push(name);
              data = undefined;
            }
          }
        }

        if (data !== undefined && handle.validateState) {
          try {
            handle.validateState(data);
          } catch (error) {
            return {
              success: false,
              error: `Plugin "${name}" state validation failed: ${errorMessage(error)}`,
            };
          }
        }
      }

      if (!handle.exportState) {
        return {
          success: false,
          error: `Plugin "${name}" implements loadState but not exportState; rollback is impossible`,
        };
      }
      preparedLoads.push({ name, handle, data });
    }

    const previous = new Map<string, unknown>();
    try {
      for (const prepared of preparedLoads) {
        previous.set(prepared.name, structuredClone(prepared.handle.exportState?.()));
      }
    } catch (error) {
      return { success: false, error: `Could not capture plugin state: ${errorMessage(error)}` };
    }

    return {
      success: true,
      prepared: {
        loads: preparedLoads,
        previous,
        previousPreservedUnknown: { ...this.preservedUnknown },
        preservedUnknown,
        droppedPlugins,
      },
    };
  }

  commitPrepared(prepared: PreparedPluginState): PluginLoadResult {
    const attempted: PreparedLoad[] = [];
    try {
      for (const load of prepared.loads) {
        attempted.push(load);
        load.handle.loadState?.(load.data);
      }
    } catch (error) {
      const rollbackErrors = this.rollbackPrepared(prepared, attempted);
      return {
        success: false,
        error: [
          `Plugin state commit failed: ${errorMessage(error)}`,
          ...(rollbackErrors.length > 0 ? [`Rollback failed (${rollbackErrors.join(', ')})`] : []),
        ].join('. '),
      };
    }

    this.preservedUnknown = prepared.preservedUnknown;
    return {
      success: true,
      ...(prepared.droppedPlugins.length > 0
        ? { droppedPlugins: [...prepared.droppedPlugins] }
        : {}),
    };
  }

  rollbackPrepared(
    prepared: PreparedPluginState,
    loads: readonly PreparedLoad[] = prepared.loads,
  ): string[] {
    const rollbackErrors: string[] = [];
    for (const load of [...loads].reverse()) {
      try {
        load.handle.loadState?.(prepared.previous.get(load.name));
      } catch (rollbackError) {
        rollbackErrors.push(`${load.name}: ${errorMessage(rollbackError)}`);
      }
    }
    this.preservedUnknown = { ...prepared.previousPreservedUnknown };
    return rollbackErrors;
  }

  loadState(persisted: Record<string, PersistedPluginState>): PluginLoadResult {
    const controller = this.suspendNotifications();
    const prepared = this.prepareState(persisted);
    if (!prepared.success) {
      controller.discard();
      return prepared;
    }
    const result = this.commitPrepared(prepared.prepared);
    if (result.success) controller.resume();
    else controller.discard();
    return result;
  }

  exportState(): Record<string, PersistedPluginState> {
    const result: Record<string, PersistedPluginState> = { ...this.preservedUnknown };
    for (const [name, handle] of this.plugins) {
      if (!handle.exportState) continue;
      result[name] = {
        version: handle.stateVersion ?? 1,
        data: handle.exportState(),
      };
    }
    return result;
  }
}

function createNotificationController(): NotificationController {
  return {
    resume: () => undefined,
    discard: () => undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
