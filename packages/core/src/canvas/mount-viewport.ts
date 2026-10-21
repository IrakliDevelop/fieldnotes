import { Viewport } from './viewport';
import type { ViewportOptions } from './viewport';
import { createDefaultTools } from '../tools/default-tools';
import { reportFailure } from '../core/report-failure';
import type { CanvasState, ImportableCanvasState } from '../core/state-serializer';
import type { Tool } from '../tools/types';

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
  defaultTool?: string;
  /** Called once the viewport exists; a throw destroys the viewport and is rethrown. */
  onReady?: (viewport: Viewport) => void;
  /** Trailing-debounced with the exported state after any change; flushed by `destroy()`. */
  onChange?: (state: CanvasState) => void;
  /** Debounce window for `onChange` in milliseconds (default 250). */
  changeDebounceMs?: number;
  /** Fires on active-tool changes after mount, not for activation during mount. */
  onToolChange?: (name: string) => void;
}

/** A viewport mounted by `mountViewport`, with the calls framework bindings need. */
export interface MountedViewport {
  readonly viewport: Viewport;
  /** Activates `name` unless it is already the active tool. */
  setTool(name: string): void;
  /** Registers each tool whose name is not registered yet (append-only). */
  addTools(tools: readonly Tool[]): void;
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

  const activate = (fallback?: string) => {
    const name = opts.tool ?? opts.defaultTool ?? fallback;
    if (name) vp.setTool(name);
  };
  // An explicit `options.tools` is the host's choice; core registers it and activates select.
  const deferDefaults = tools === undefined && options?.tools === undefined;
  for (const t of tools === 'default' ? createDefaultTools() : (tools ?? [])) {
    vp.toolManager.register(t);
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
    clearTimeout(timer);
    timer = setTimeout(emitChange, opts.changeDebounceMs ?? 250);
  });

  try {
    opts.onReady?.(vp);

    // Hosts that register their own tools in onReady keep exactly those.
    if (deferDefaults) {
      const registerDefaults = vp.toolManager.toolNames.length === 0;
      if (registerDefaults) {
        for (const t of createDefaultTools()) vp.toolManager.register(t);
      }
      activate(registerDefaults ? 'select' : undefined);
    }
  } catch (error) {
    clearTimeout(timer);
    unsubscribe();
    vp.destroy();
    throw error;
  }

  const unsubscribeTool = vp.toolManager.onChange((name) => opts.onToolChange?.(name));
  let destroyed = false;

  return {
    viewport: vp,
    setTool(name) {
      if (vp.toolManager.activeTool?.name !== name) vp.setTool(name);
    },
    addTools(added) {
      for (const t of added) {
        if (!vp.toolManager.getTool(t.name)) vp.toolManager.register(t);
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
      unsubscribeTool();
      unsubscribe();
      vp.destroy();
    },
  };
}
