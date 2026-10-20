import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  toRaw,
  watch,
  type PropType,
} from 'vue';
import { Viewport, createDefaultTools } from '@fieldnotes/core';
import type { ViewportOptions, Tool, CanvasState, ImportableCanvasState } from '@fieldnotes/core';
import { ViewportKey } from './context';

export interface FieldNotesCanvasProps {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  options?: ViewportOptions;
  /**
   * `'default'` (mount-only): `createDefaultTools()` registered before `onReady`, `select` active.
   * Omitted: the same bundle after `onReady`, only if no tools are registered by then.
   * An array is reactive (append-only): tools present here are registered, including ones pushed
   * into a reactive array; removal is not supported, and `[]` registers nothing.
   */
  tools?: Tool[] | 'default';
  /** Mount-only: a saved state (object or JSON string) loaded before `onReady`. */
  initialData?: ImportableCanvasState | string;
  /** Debounce window for `onChange` in milliseconds (default 250). */
  changeDebounceMs?: number;
  /** Uncontrolled initial tool. Ignored when `tool` is set. */
  defaultTool?: string;
  /** Controlled active tool. Pair with `v-model:tool` or `onToolChange`. */
  tool?: string;
  /**
   * Reactive compatibility toggle for the core snap flag.
   * @deprecated Grid snapping is domain behavior. Configure it through the
   * VTT grid/constraint service instead.
   */
  snapToGrid?: boolean;
  /** Called once the viewport exists; a throw destroys the viewport and is rethrown. */
  onReady?: (viewport: Viewport) => void;
  /** Trailing-debounced with the exported state after any change; flushed on unmount. */
  onChange?: (state: CanvasState) => void;
  /** Fires whenever the active tool changes (keyboard, API, or `tool` prop). */
  onToolChange?: (name: string) => void;
}

// Provides the viewport in its own setup so slot content only renders once it exists.
const ViewportProvider = defineComponent({
  props: { viewport: { type: Object as PropType<Viewport>, required: true } },
  setup(props, { slots }) {
    provide(ViewportKey, props.viewport);
    return () => slots.default?.();
  },
});

/** Mounts a Field Notes Viewport; the default slot renders inside it once the viewport exists. */
export const FieldNotesCanvas = defineComponent({
  name: 'FieldNotesCanvas',
  props: {
    options: Object as PropType<ViewportOptions>,
    tools: [Array, String] as PropType<Tool[] | 'default'>,
    initialData: [Object, String] as PropType<ImportableCanvasState | string>,
    changeDebounceMs: { type: Number, default: 250 },
    defaultTool: String,
    tool: String,
    // Vue casts an absent Boolean prop to false; undefined keeps the core flag untouched.
    snapToGrid: { type: Boolean, default: undefined },
    onReady: Function as PropType<(viewport: Viewport) => void>,
    onChange: Function as PropType<(state: CanvasState) => void>,
    onToolChange: Function as PropType<(name: string) => void>,
  },
  emits: { 'update:tool': (_name: string) => true },
  setup(props, { slots, emit, expose }) {
    const root = shallowRef<HTMLDivElement | null>(null);
    const viewport = shallowRef<Viewport | null>(null);
    let teardown: (() => void) | undefined;
    expose({ viewport });

    onMounted(() => {
      const el = root.value;
      if (!el) return;

      const options = toRaw(props.options);
      const tools = props.tools;
      const vp = new Viewport(el, options);

      const activate = (fallback?: string) => {
        const name = props.tool ?? props.defaultTool ?? fallback;
        if (name) vp.setTool(name);
      };
      // An explicit `options.tools` is the host's choice; core registers it and activates select.
      const deferDefaults = tools === undefined && options?.tools === undefined;
      for (const t of tools === 'default' ? createDefaultTools() : (tools ?? [])) {
        vp.toolManager.register(toRaw(t));
      }
      if (!deferDefaults) activate(tools === 'default' ? 'select' : undefined);

      try {
        if (typeof props.initialData === 'string') vp.loadJSON(props.initialData);
        else if (props.initialData) vp.loadState(toRaw(props.initialData));
      } catch (error) {
        vp.destroy();
        throw error;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const emitChange = () => {
        timer = undefined;
        props.onChange?.(vp.exportState());
      };
      // Subscribed after initialData so the initial load is not reported as a change.
      const unsubscribe = vp.onStateChange(() => {
        clearTimeout(timer);
        timer = setTimeout(emitChange, props.changeDebounceMs);
      });

      try {
        props.onReady?.(vp);

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

      const unsubscribeTool = vp.toolManager.onChange((name) => {
        props.onToolChange?.(name);
        emit('update:tool', name);
      });
      viewport.value = vp;

      teardown = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          try {
            emitChange();
          } catch (error) {
            // A failing host save must not leak the viewport or throw out of unmount.
            if (typeof reportError === 'function') reportError(error);
            else console.error('[fieldnotes] onChange failed during unmount', error);
          }
        }
        unsubscribeTool();
        unsubscribe();
        vp.destroy();
        viewport.value = null;
      };
    });

    onBeforeUnmount(() => teardown?.());

    watch([viewport, () => props.tool], ([vp, tool]) => {
      if (!vp || tool === undefined) return;
      if (vp.toolManager.activeTool?.name !== tool) vp.setTool(tool);
    });

    watch([viewport, () => props.snapToGrid], ([vp, snapToGrid]) => {
      if (!vp || snapToGrid === undefined) return;
      vp.setSnapToGrid(snapToGrid);
    });

    watch(
      () => props.tools,
      (tools) => {
        const vp = viewport.value;
        if (!vp || !Array.isArray(tools)) return;
        for (const t of tools) {
          const tool = toRaw(t);
          if (!vp.toolManager.getTool(tool.name)) vp.toolManager.register(tool);
        }
      },
      { deep: 1 },
    );

    return () =>
      h(
        'div',
        { ref: root },
        viewport.value
          ? h(ViewportProvider, { viewport: viewport.value }, slots.default)
          : undefined,
      );
  },
});
