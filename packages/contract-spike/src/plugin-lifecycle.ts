import type { NotificationController, PersistedPluginState, PluginHandle } from './types';

export class PluginStateManager {
  private readonly plugins = new Map<string, PluginHandle>();
  private state: Record<string, PersistedPluginState> = {};

  registerPlugin(name: string, handle: PluginHandle): void {
    this.plugins.set(name, handle);
  }

  loadState(persisted: Record<string, PersistedPluginState>): { success: boolean; error?: string } {
    const controller = suspendNotifications();

    const prepared = new Map<string, unknown>();

    for (const [pluginName, entry] of Object.entries(persisted)) {
      const handle = this.plugins.get(pluginName);
      if (!handle) {
        prepared.set(pluginName, entry.data);
        continue;
      }

      const version = handle.stateVersion ?? 1;
      let data = entry.data;

      if (entry.version !== version) {
        if (!handle.migrateState) {
          controller.discard();
          return {
            success: false,
            error: `Plugin "${pluginName}" has no migrateState but version mismatch (${entry.version} → ${version})`,
          };
        }
        try {
          data = handle.migrateState(data, entry.version);
        } catch (err) {
          controller.discard();
          return {
            success: false,
            error: `Plugin "${pluginName}" migration failed: ${String(err)}`,
          };
        }
      }

      if (handle.validateState) {
        try {
          handle.validateState(data);
        } catch (err) {
          controller.discard();
          return {
            success: false,
            error: `Plugin "${pluginName}" validation failed after migration: ${String(err)}`,
          };
        }
      }

      prepared.set(pluginName, data);
    }

    for (const [pluginName, data] of prepared) {
      const handle = this.plugins.get(pluginName);
      if (handle?.loadState) {
        handle.loadState(data);
      }
    }

    this.state = {};
    for (const [pluginName, data] of prepared) {
      const handle = this.plugins.get(pluginName);
      const version = handle?.stateVersion ?? 1;
      this.state[pluginName] = { version, data };
    }

    controller.resume();
    return { success: true };
  }

  exportState(): Record<string, PersistedPluginState> {
    const result: Record<string, PersistedPluginState> = {};

    for (const [name, entry] of Object.entries(this.state)) {
      result[name] = entry;
    }

    for (const [pluginName, handle] of this.plugins) {
      if (pluginName in result) continue;
      if (handle.exportState) {
        const version = handle.stateVersion ?? 1;
        result[pluginName] = { version, data: handle.exportState() };
      }
    }

    return result;
  }

  getState(): Record<string, PersistedPluginState> {
    return { ...this.state };
  }
}

function suspendNotifications(): NotificationController {
  let active = true;
  const queue: (() => void)[] = [];

  return {
    resume() {
      if (!active) return;
      active = false;
      for (const fn of queue) fn();
      queue.length = 0;
    },
    discard() {
      if (!active) return;
      active = false;
      queue.length = 0;
    },
  };
}
