import type { NotificationController, PersistedPluginState, PluginHandle } from './types';

export interface PluginLoadResult {
  readonly success: boolean;
  readonly error?: string;
  readonly droppedPlugins?: string[];
}

interface PreparedLoad {
  readonly name: string;
  readonly handle: PluginHandle;
  readonly data: unknown;
}

export class PluginStateManager {
  private readonly plugins = new Map<string, PluginHandle>();
  private state: Record<string, PersistedPluginState> = {};

  constructor(
    private readonly suspendNotifications: () => NotificationController = createNotificationController,
  ) {}

  registerPlugin(name: string, handle: PluginHandle): void {
    this.plugins.set(name, handle);
  }

  loadState(persisted: Record<string, PersistedPluginState>): PluginLoadResult {
    const controller = this.suspendNotifications();
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
            controller.discard();
            return {
              success: false,
              error: `Plugin "${name}" state validation failed: ${errorMessage(error)}`,
            };
          }
        }
      }

      if (!handle.exportState) {
        controller.discard();
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
      controller.discard();
      return { success: false, error: `Could not capture plugin state: ${errorMessage(error)}` };
    }

    const attempted: PreparedLoad[] = [];
    try {
      for (const prepared of preparedLoads) {
        attempted.push(prepared);
        prepared.handle.loadState?.(prepared.data);
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const prepared of attempted.reverse()) {
        try {
          prepared.handle.loadState?.(previous.get(prepared.name));
        } catch (rollbackError) {
          rollbackErrors.push(`${prepared.name}: ${errorMessage(rollbackError)}`);
        }
      }
      controller.discard();
      return {
        success: false,
        error: [
          `Plugin state commit failed: ${errorMessage(error)}`,
          ...(rollbackErrors.length > 0 ? [`Rollback failed (${rollbackErrors.join(', ')})`] : []),
        ].join('. '),
      };
    }

    this.state = preservedUnknown;
    controller.resume();
    return {
      success: true,
      ...(droppedPlugins.length > 0 ? { droppedPlugins } : {}),
    };
  }

  exportState(): Record<string, PersistedPluginState> {
    const result: Record<string, PersistedPluginState> = { ...this.state };
    for (const [name, handle] of this.plugins) {
      if (!handle.exportState) continue;
      result[name] = {
        version: handle.stateVersion ?? 1,
        data: handle.exportState(),
      };
    }
    return result;
  }

  getState(): Record<string, PersistedPluginState> {
    return { ...this.state };
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
