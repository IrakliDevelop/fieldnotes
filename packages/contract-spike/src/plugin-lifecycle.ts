import type { NotificationController, PersistedPluginState, PluginHandle } from './types';

export class PluginStateManager {
  private readonly plugins = new Map<string, PluginHandle>();
  private state: Record<string, PersistedPluginState> = {};

  registerPlugin(name: string, handle: PluginHandle): void {
    this.plugins.set(name, handle);
  }

  loadState(persisted: Record<string, PersistedPluginState>): {
    success: boolean;
    error?: string;
    droppedPlugins?: string[];
  } {
    const controller = suspendNotifications();

    const prepared = new Map<string, PersistedPluginState>();
    const droppedPlugins: string[] = [];

    for (const [pluginName, entry] of Object.entries(persisted)) {
      const handle = this.plugins.get(pluginName);
      if (!handle) {
        // Unknown plugin: preserve the full entry as-is with original version
        prepared.set(pluginName, entry);
        continue;
      }

      const version = handle.stateVersion ?? 1;
      let data = entry.data;

      if (entry.version !== version) {
        if (!handle.migrateState) {
          // Drop this plugin entry and continue (per ADR)
          droppedPlugins.push(pluginName);
          continue;
        }
        try {
          data = handle.migrateState(data, entry.version);
        } catch {
          // Migration threw — drop this plugin and continue
          droppedPlugins.push(pluginName);
          continue;
        }
      }

      if (handle.validateState) {
        try {
          handle.validateState(data);
        } catch {
          // Validation failed — drop this plugin and continue
          droppedPlugins.push(pluginName);
          continue;
        }
      }

      prepared.set(pluginName, { version, data });
    }

    for (const [pluginName, entry] of prepared) {
      const handle = this.plugins.get(pluginName);
      if (handle?.loadState) {
        try {
          handle.loadState(entry.data);
        } catch {
          // loadState threw — record in dropped, continue with others
          droppedPlugins.push(pluginName);
        }
      }
    }

    // Only store unknown plugin entries in this.state.
    // Registered plugins are handled via exportState() so that
    // post-loadState() mutations are reflected (not stale persisted data).
    this.state = {};
    for (const [pluginName, entry] of prepared) {
      if (!this.plugins.has(pluginName)) {
        this.state[pluginName] = entry;
      }
    }

    controller.resume();
    return {
      success: true,
      ...(droppedPlugins.length > 0 ? { droppedPlugins } : {}),
    };
  }

  exportState(): Record<string, PersistedPluginState> {
    const result: Record<string, PersistedPluginState> = {};

    // Unknown plugins: return their preserved state
    for (const [name, entry] of Object.entries(this.state)) {
      result[name] = entry;
    }

    // Registered plugins: always call exportState() for current state
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
