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
import { mountViewport } from '@fieldnotes/core';
import type {
  MountedViewport,
  Viewport,
  ViewportOptions,
  Tool,
  CanvasState,
  ImportableCanvasState,
} from '@fieldnotes/core';
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

/** What a template ref on `<FieldNotesCanvas>` exposes. */
export interface FieldNotesCanvasRef {
  viewport: Viewport | null;
}

// Provides the viewport in its own setup so slot content only renders once it exists.
const ViewportProvider = defineComponent({
  props: { viewport: { type: Object as PropType<Viewport>, required: true } },
  setup(props, { slots }) {
    provide(ViewportKey, props.viewport);
    return () => slots.default?.();
  },
});

// Exported for the props/interface parity check in the test; not public API.
export const fieldNotesCanvasProps = {
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
} as const;

/** Mounts a Field Notes Viewport; the default slot renders inside it once the viewport exists. */
export const FieldNotesCanvas = defineComponent({
  name: 'FieldNotesCanvas',
  props: fieldNotesCanvasProps,
  emits: { 'update:tool': (_name: string) => true },
  setup(props, { slots, emit, expose }) {
    const root = shallowRef<HTMLDivElement | null>(null);
    const viewport = shallowRef<Viewport | null>(null);
    let mounted: MountedViewport | undefined;
    expose({ viewport });

    onMounted(() => {
      const el = root.value;
      if (!el) return;

      const tools = props.tools;
      mounted = mountViewport(el, {
        options: toRaw(props.options),
        tools: tools === 'default' ? tools : tools?.map(toRaw),
        initialData: toRaw(props.initialData),
        get tool() {
          return props.tool;
        },
        get defaultTool() {
          return props.defaultTool;
        },
        onReady: props.onReady,
        get onChange() {
          return props.onChange;
        },
        get changeDebounceMs() {
          return props.changeDebounceMs;
        },
        onToolChange: (name) => {
          props.onToolChange?.(name);
          emit('update:tool', name);
        },
      });
      viewport.value = mounted.viewport;
    });

    onBeforeUnmount(() => {
      if (!mounted) return;
      mounted.destroy();
      mounted = undefined;
      viewport.value = null;
    });

    watch([viewport, () => props.tool], ([, tool]) => {
      if (!mounted || tool === undefined) return;
      mounted.setTool(tool);
    });

    watch([viewport, () => props.snapToGrid], ([vp, snapToGrid]) => {
      if (!vp || snapToGrid === undefined) return;
      vp.setSnapToGrid(snapToGrid);
    });

    watch(
      () => props.tools,
      (tools) => {
        if (!mounted || !Array.isArray(tools)) return;
        mounted.addTools(tools.map(toRaw));
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
