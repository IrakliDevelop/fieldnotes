import { Viewport } from './viewport';
import type { ViewportOptions } from './viewport';
import { createDefaultTools } from '../tools/default-tools';
import { reportFailure } from '../core/report-failure';
import { AutoSave } from '../core/auto-save';
import type { AutoSaveOptions } from '../core/auto-save';
import type { CanvasState, ImportableCanvasState } from '../core/state-serializer';
import type { Tool } from '../tools/types';

/** Autosave options; the store, camera, layer manager, plugin state and registry come from the viewport. */
export type MountAutoSaveOptions = Omit<
  AutoSaveOptions,
  'layerManager' | 'elementRegistry' | 'pluginStateManager' | 'changeEmitters'
>;

/** Mount options; `onChange`, `changeDebounceMs`, `onToolChange`, `tool` and `defaultTool` are read at use time, so getters stay live. */
export interface MountViewportOptions {
  /** Read once at mount. */
  options?: ViewportOptions;
  /**
   * Read once at mount. `'default'`: `createDefaultTools()` before `onReady`, `select` active.
   * Omitted (and no `options.tools`): the same bundle after `onReady`, only if none is registered by then.
   */
  tools?: Tool[] | 'default';
  /** Read once at mount: a saved state (object or JSON string) loaded before `onReady`. */
  initialData?: ImportableCanvasState | string;
  /** Active tool at mount; wins over `defaultTool`. */
  tool?: string;
  /** Uncontrolled initial tool; ignored when `tool` is set. */
  defaultTool?: string;
  /** Called once the viewport exists; a throw destroys the viewport and is rethrown. */
  onReady?: (viewport: Viewport) => void;
  /** Trailing-debounced with the exported state after any change; flushed by `destroy()`. */
  onChange?: (state: CanvasState) => void;
  /** Debounce window for `onChange` in milliseconds (default 250). */
  changeDebounceMs?: number;
  /** Loads the saved board after `onReady` (a saved board wins over `initialData`), then saves on change. */
  autoSave?: MountAutoSaveOptions;
  /** Fires on active-tool changes after mount, not for activation during mount. */
  onToolChange?: (name: string) => void;
}

/** A viewport mounted by `mountViewport`, with the calls framework bindings need. */
export interface MountedViewport {
  readonly viewport: Viewport;
  /** The autosave instance, or `null` without `autoSave`. */
  readonly autoSave: AutoSave | null;
  /** Activates `name` unless it is already the active tool. */
  setTool(name: string): void;
  /** Registers each tool whose name is not registered yet (append-only). */
  addTools(tools: readonly Tool[]): void;
  /** Reconciles by name; the first instance stays until that name leaves this mount's tools. */
  setTools(tools: readonly Tool[]): void;
  /** Flushes a pending onChange, unsubscribes, destroys the viewport. Idempotent. */
  destroy(): void;
}

/** Constructs and wires a Viewport the way the framework bindings mount `FieldNotesCanvas`. */
export function mountViewport(
  container: HTMLElement,
  opts: MountViewportOptions = {},
): MountedViewport {
  const { options, tools, initialData } = opts;
  const vp = new Viewport(container, options);
  let destroyed = false;
  let muted = false;
  const registrations = new Map<string, { tool: Tool; dispose: () => void }>();

  const register = (tool: Tool) => {
    if (registrations.has(tool.name) || vp.toolManager.getTool(tool.name)) return;
    registrations.set(tool.name, { tool, dispose: vp.toolManager.register(tool) });
  };

  const activate = (fallback?: string) => {
    const name = opts.tool ?? opts.defaultTool ?? fallback;
    if (name) vp.setTool(name);
  };
  // An explicit `options.tools` is the host's choice; core registers it and activates select.
  const deferDefaults = tools === undefined && options?.tools === undefined;
  for (const t of tools === 'default' ? createDefaultTools() : (tools ?? [])) {
    register(t);
  }
  if (!deferDefaults) activate(tools === 'default' ? 'select' : undefined);

  try {
    if (typeof initialData === 'string') vp.loadJSON(initialData);
    else if (initialData) vp.loadState(initialData);
  } catch (error) {
    vp.destroy();
    throw error;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const emitChange = () => {
    timer = undefined;
    opts.onChange?.(vp.exportState());
  };
  // Subscribed after initialData so the initial load is not reported as a change.
  const unsubscribe = vp.onStateChange(() => {
    if (muted) return;
    clearTimeout(timer);
    timer = setTimeout(emitChange, opts.changeDebounceMs ?? 250);
  });

  try {
    opts.onReady?.(vp);

    // Hosts that register their own tools in onReady keep exactly those.
    if (deferDefaults) {
      const registerDefaults = vp.toolManager.toolNames.length === 0;
      if (registerDefaults) {
        for (const t of createDefaultTools()) register(t);
      }
      activate(registerDefaults ? 'select' : undefined);
    }
  } catch (error) {
    clearTimeout(timer);
    unsubscribe();
    vp.destroy();
    throw error;
  }

  const autoSave = opts.autoSave
    ? new AutoSave(vp.store, vp.camera, {
        ...opts.autoSave,
        layerManager: vp.layerManager,
        elementRegistry: vp.elementRegistry,
        pluginStateManager: vp.plugins,
        changeEmitters: [{ onChange: (listener) => vp.onStateChange(listener) }],
      })
    : null;
  if (autoSave) {
    void autoSave.load().then((state) => {
      if (destroyed) return;
      if (state) {
        clearTimeout(timer);
        timer = undefined;
        muted = true;
        try {
          vp.loadState(state);
        } catch (error) {
          if (destroyed) return;
          if (opts.autoSave?.onError) {
            opts.autoSave.onError(error instanceof Error ? error : new Error(String(error)));
          } else {
            reportFailure(error, 'autosave load failed to apply');
          }
          return;
        } finally {
          muted = false;
        }
        if (destroyed) return;
      }
      autoSave.start();
    });
  }

  const unsubscribeTool = vp.toolManager.onChange((name) => opts.onToolChange?.(name));

  return {
    viewport: vp,
    autoSave,
    setTool(name) {
      if (vp.toolManager.activeTool?.name !== name) vp.setTool(name);
    },
    addTools(added) {
      for (const tool of added) register(tool);
    },
    setTools(next) {
      const names = new Set(next.map((tool) => tool.name));
      for (const tool of next) register(tool);
      const removed = new Set([...registrations.keys()].filter((name) => !names.has(name)));

      for (const [name, { tool, dispose }] of registrations) {
        if (names.has(name)) continue;

        if (vp.toolManager.activeTool === tool) {
          const fallback = [opts.tool, opts.defaultTool, 'select', next[0]?.name].find(
            (candidate) =>
              candidate !== undefined &&
              !removed.has(candidate) &&
              vp.toolManager.getTool(candidate) !== undefined,
          );
          if (fallback) vp.setTool(fallback);
          else {
            tool.onDeactivate?.(vp.toolContext);
            dispose();
            opts.onToolChange?.('');
            registrations.delete(name);
            continue;
          }
        }

        dispose();
        registrations.delete(name);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        try {
          emitChange();
        } catch (error) {
          // A failing host save must not leak the viewport or throw out of unmount.
          reportFailure(error, 'onChange failed during unmount');
        }
      }
      if (autoSave) {
        void autoSave.flush();
        autoSave.stop();
      }
      unsubscribeTool();
      unsubscribe();
      vp.destroy();
    },
  };
}
