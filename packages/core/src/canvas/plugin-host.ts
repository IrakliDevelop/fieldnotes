import type { ActionRegistry } from '../actions/action-registry';
import type { Bounds } from '../core/types';
import type { ServiceKey } from '../core/service-key';
import type { PluginHandle, PluginStateManager } from '../core/plugin-state-manager';
import type { ElementRegistry } from '../elements/element-registry';
import type { ElementStore } from '../elements/element-store';
import type { HistoryStack } from '../history/history-stack';
import type { ToolManager } from '../tools/tool-manager';
import type { Minimap } from './minimap';
import type { RenderHooks } from './render-hooks';
import type { Viewport } from './viewport';
import type {
  PluginConfigureContext,
  PluginStartContext,
  RequiredCapabilities,
  ViewportPlugin,
} from './viewport-plugin';

interface ConfiguredPlugin {
  readonly plugin: ViewportPlugin;
  readonly configureDisposers: (() => void)[];
  startDisposers: (() => void)[];
  handle?: PluginHandle;
}

export interface PluginHostDeps {
  viewport: Viewport;
  elementRegistry: ElementRegistry;
  toolManager: ToolManager;
  renderHooks: RenderHooks;
  actionRegistry: ActionRegistry;
  store: ElementStore;
  history: HistoryStack;
  requestRender: () => void;
  pluginStateManager: PluginStateManager;
  getMinimap: () => Minimap | null;
}

/** Owns the viewport plugin lifecycle: configure, start, rollback, services, and change notifications. */
export class PluginHost {
  private readonly installedPlugins: ConfiguredPlugin[] = [];
  private readonly services = new Map<symbol, unknown>();
  private readonly extraBoundsProviders = new Set<() => Bounds | null>();
  private readonly pluginChangeListeners = new Set<() => void>();
  private pluginNotificationDepth = 0;
  private pluginChangePending = false;

  constructor(private readonly deps: PluginHostDeps) {}

  getService<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key.id) as T | undefined;
  }

  getExtraBounds(): Bounds | null {
    let combined: Bounds | null = null;
    for (const provider of this.extraBoundsProviders) {
      const b = provider();
      if (!b) continue;
      if (!combined) {
        combined = { ...b };
      } else {
        const minX = Math.min(combined.x, b.x);
        const minY = Math.min(combined.y, b.y);
        const maxR = Math.max(combined.x + combined.w, b.x + b.w);
        const maxB = Math.max(combined.y + combined.h, b.y + b.h);
        combined = { x: minX, y: minY, w: maxR - minX, h: maxB - minY };
      }
    }
    return combined;
  }

  beginNotificationSuspend(): void {
    this.pluginNotificationDepth += 1;
  }

  /** Flushing the outermost suspension emits one deferred change; discarding drops it. */
  endNotificationSuspend(flush: boolean): void {
    this.pluginNotificationDepth = Math.max(0, this.pluginNotificationDepth - 1);
    if (!flush) this.pluginChangePending = false;
    if (flush && this.pluginNotificationDepth === 0 && this.pluginChangePending) {
      this.pluginChangePending = false;
      this.emitChange();
    }
  }

  configurePlugins(plugins?: ViewportPlugin[]): void {
    if (!plugins?.length) return;
    const { elementRegistry, toolManager, renderHooks, actionRegistry } = this.deps;
    const names = new Set<string>();
    const ordered = plugins
      .map((plugin, index) => ({ plugin, index }))
      .sort((a, b) => (a.plugin.priority ?? 0) - (b.plugin.priority ?? 0) || a.index - b.index);
    for (const { plugin } of ordered) {
      if (names.has(plugin.name)) {
        console.warn(`[fieldnotes] skipping duplicate plugin "${plugin.name}"`);
        continue;
      }
      names.add(plugin.name);
      const configureDisposers: (() => void)[] = [];
      const track = (dispose: () => void): void => {
        configureDisposers.push(dispose);
      };
      const context: PluginConfigureContext = {
        elementRegistry,
        toolManager,
        registerElementType: (definition) => {
          elementRegistry.register(definition);
          track(() => elementRegistry.unregister(definition.type));
        },
        registerTool: (tool) => track(toolManager.register(tool)),
        registerViewportHooks: (hooks, options) =>
          track(renderHooks.viewport.register(hooks, options)),
        registerMinimapHooks: (hooks, options) =>
          track(renderHooks.minimap.register(hooks, options)),
        registerImageExportHooks: (hooks, options) =>
          track(renderHooks.imageExport.register(hooks, options)),
        registerSvgExportHooks: (hooks, options) =>
          track(renderHooks.svgExport.register(hooks, options)),
        registerAction: (definition) => track(actionRegistry.register(definition)),
      };
      try {
        plugin.configure?.(context);
        this.installedPlugins.push({ plugin, configureDisposers, startDisposers: [] });
      } catch (error) {
        for (const dispose of configureDisposers.reverse()) safelyDispose(dispose);
        if (plugin.required) {
          this.disposePlugins();
          throw error;
        }
        console.warn(
          `[fieldnotes] optional plugin "${plugin.name}" failed to configure: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  startPlugins(): void {
    for (const configured of [...this.installedPlugins]) {
      const startDisposers: (() => void)[] = [];
      const registeredServices: { key: symbol; previous: unknown; hadPrevious: boolean }[] = [];
      const context: PluginStartContext = {
        viewport: this.deps.viewport,
        store: this.deps.store,
        pushHistory: (command) => this.deps.history.push(command),
        requestRender: () => this.deps.requestRender(),
        invalidateMinimap: () => this.deps.getMinimap()?.invalidateScene(),
        registerService: (key, service) => {
          registeredServices.push({
            key: key.id,
            previous: this.services.get(key.id),
            hadPrevious: this.services.has(key.id),
          });
          this.services.set(key.id, service);
        },
        addDisposer: (dispose) => startDisposers.push(dispose),
        registerExtraBounds: (provider) => {
          this.extraBoundsProviders.add(provider);
          this.deps.getMinimap()?.invalidateScene();
          const dispose = () => {
            this.extraBoundsProviders.delete(provider);
            this.deps.getMinimap()?.invalidateScene();
          };
          startDisposers.push(dispose);
          return dispose;
        },
        onChange: (listener) => {
          this.pluginChangeListeners.add(listener);
          const dispose = () => this.pluginChangeListeners.delete(listener);
          startDisposers.push(dispose);
          return dispose;
        },
        notifyChange: () => {
          if (this.pluginNotificationDepth > 0) {
            this.pluginChangePending = true;
            return;
          }
          this.emitChange();
        },
      };
      try {
        const handle = configured.plugin.start?.(context);
        configured.startDisposers = startDisposers;
        if (handle) {
          configured.handle = handle;
          this.deps.pluginStateManager.registerPlugin(configured.plugin.name, handle);
        }
      } catch (error) {
        for (const dispose of startDisposers.reverse()) safelyDispose(dispose);
        for (const service of registeredServices.reverse()) {
          if (service.hadPrevious) this.services.set(service.key, service.previous);
          else this.services.delete(service.key);
        }
        for (const dispose of configured.configureDisposers.reverse()) safelyDispose(dispose);
        this.installedPlugins.splice(this.installedPlugins.indexOf(configured), 1);
        if (configured.plugin.required) {
          this.disposePlugins();
          throw error;
        }
        console.warn(
          `[fieldnotes] optional plugin "${configured.plugin.name}" failed to start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  validateRequiredCapabilities(required?: RequiredCapabilities): void {
    if (!required) return;
    const bySurface: Exclude<RequiredCapabilities, readonly string[]> = Array.isArray(required)
      ? {
          viewport: required,
          minimap: required,
          imageExport: required,
          svgExport: required,
        }
      : (required as Exclude<RequiredCapabilities, readonly string[]>);
    const surfaces = ['viewport', 'minimap', 'imageExport', 'svgExport'] as const;
    const missing: string[] = [];
    for (const surface of surfaces) {
      const satisfied = new Set(this.deps.renderHooks[surface].getSatisfiedCapabilities());
      for (const capability of bySurface[surface] ?? []) {
        if (!satisfied.has(capability)) missing.push(`${surface}:${capability}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Required plugin capabilities are missing: ${missing.join(', ')}`);
    }
  }

  disposePlugins(): void {
    for (const configured of [...this.installedPlugins].reverse()) {
      if (configured.handle) {
        this.deps.pluginStateManager.unregisterPlugin(configured.plugin.name, configured.handle);
        safelyDispose(() => configured.handle?.dispose());
      }
      for (const dispose of [...configured.startDisposers].reverse()) safelyDispose(dispose);
      for (const dispose of [...configured.configureDisposers].reverse()) safelyDispose(dispose);
    }
    this.installedPlugins.length = 0;
    this.services.clear();
  }

  private emitChange(): void {
    for (const listener of this.pluginChangeListeners) {
      try {
        listener();
      } catch (error) {
        console.error('[fieldnotes] plugin change listener failed', error);
      }
    }
  }
}

function safelyDispose(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // Cleanup remains best-effort so later resources are still released.
  }
}
