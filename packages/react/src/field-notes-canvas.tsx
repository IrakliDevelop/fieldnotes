import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { mountViewport } from '@fieldnotes/core';
import type {
  Viewport,
  ViewportOptions,
  Tool,
  CanvasState,
  ActivationOptions,
  ElementActivationEvent,
  ImportableCanvasState,
  MountAutoSaveOptions,
  MountedViewport,
  ShortcutBindings,
} from '@fieldnotes/core';
import { ViewportContext } from './context';

export interface FieldNotesCanvasProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'autoSave' | 'onChange' | 'children'
> {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  options?: ViewportOptions;
  /**
   * `'default'` (mount-only): `createDefaultTools()` registered before `onReady`, `select` active.
   * Omitted: the same bundle after `onReady`, only if no tools are registered by then.
   * An array is reactive by name: new names register, departing names unregister, and a new
   * instance under an existing name is ignored. `[]` registers nothing.
   */
  tools?: Tool[] | 'default';
  /** Mount-only: a saved state (object or JSON string) loaded before `onReady`. */
  initialData?: ImportableCanvasState | string;
  /** Trailing-debounced with the exported state after any change; flushed on unmount. */
  onChange?: (state: CanvasState) => void;
  /** Debounce window for `onChange` in milliseconds (default 250). */
  changeDebounceMs?: number;
  /** Mount-only autosave configuration. */
  autoSave?: MountAutoSaveOptions;
  /** Reactive shortcut bindings. Hoist the object to avoid rebinding on every render. */
  shortcuts?: ShortcutBindings;
  /** Reactive activation options. A new object replaces activation, null disables it, and undefined leaves it unchanged. */
  activation?: ActivationOptions | null;
  /** Receives element activation events. */
  onElementActivate?: (event: ElementActivationEvent) => void;
  /** Uncontrolled initial tool. Ignored when `tool` is set. */
  defaultTool?: string;
  /** Controlled active tool. Pair with `onToolChange`. */
  tool?: string;
  /**
   * Fires whenever the active tool changes, including `''` when no tool remains active. Adopt a
   * controlled switch synchronously with `onToolChange={setTool}`.
   */
  onToolChange?: (name: string) => void;
  /**
   * Reactive compatibility toggle for the core snap flag.
   * @deprecated Grid snapping is domain behavior. Configure it through the
   * VTT grid/constraint service instead.
   */
  snapToGrid?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onReady?: (viewport: Viewport) => void;
}

export interface FieldNotesCanvasRef {
  /** The live mounted viewport, or null before mount and after unmount. */
  readonly viewport: Viewport | null;
  /** The live mounted autosave instance, or null when autosave is not configured. */
  readonly autoSave: MountedViewport['autoSave'];
}

export const FieldNotesCanvas = forwardRef<FieldNotesCanvasRef, FieldNotesCanvasProps>(
  function FieldNotesCanvas(
    {
      options,
      tools,
      defaultTool,
      tool,
      onToolChange,
      initialData,
      onChange,
      changeDebounceMs = 250,
      autoSave,
      shortcuts,
      activation,
      onElementActivate,
      snapToGrid,
      className,
      style,
      children,
      onReady,
      ...rest
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<Viewport | null>(null);
    const [active, setActive] = useState('');
    const mountedRef = useRef<MountedViewport | null>(null);
    const changeRef = useRef({ onChange, changeDebounceMs });
    const toolRef = useRef({ tool, defaultTool });
    const toolChangeRef = useRef(onToolChange);
    const previousShortcuts = useRef<ShortcutBindings | undefined>(undefined);
    const activationRef = useRef(onElementActivate);
    const activationDispose = useRef<(() => void) | undefined>(undefined);
    changeRef.current = { onChange, changeDebounceMs };
    toolRef.current = { tool, defaultTool };
    toolChangeRef.current = onToolChange;
    activationRef.current = onElementActivate;

    useImperativeHandle(
      ref,
      () => ({
        get viewport() {
          return mountedRef.current?.viewport ?? null;
        },
        get autoSave() {
          return mountedRef.current?.autoSave ?? null;
        },
      }),
      [],
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const mounted = mountViewport(el, {
        options,
        tools,
        initialData,
        autoSave,
        onReady,
        get tool() {
          return toolRef.current.tool;
        },
        get defaultTool() {
          return toolRef.current.defaultTool;
        },
        get onToolChange() {
          return (name: string) => {
            try {
              toolChangeRef.current?.(name);
            } finally {
              setActive(name);
            }
          };
        },
        get onChange() {
          return changeRef.current.onChange;
        },
        get changeDebounceMs() {
          return changeRef.current.changeDebounceMs;
        },
      });
      mountedRef.current = mounted;
      setActive(mounted.viewport.toolManager.activeTool?.name ?? '');
      setViewport(mounted.viewport);

      return () => {
        mounted.destroy();
        mountedRef.current = null;
        setViewport(null);
      };
      // Constructor effect: options/tools/defaultTool/initialData are mount-only by design.
    }, []);

    useEffect(() => {
      if (!viewport || !Array.isArray(tools)) return;
      mountedRef.current?.setTools(tools);
    }, [viewport, tools]);

    useEffect(() => {
      if (!viewport || tool === undefined || active === tool) return;
      mountedRef.current?.setTool(tool);
    }, [viewport, tool, active]);

    useEffect(() => {
      if (!viewport || snapToGrid === undefined) return;
      viewport.setSnapToGrid(snapToGrid);
    }, [viewport, snapToGrid]);

    useEffect(() => {
      if (!viewport) return;
      const previous = previousShortcuts.current ?? {};
      const next = shortcuts ?? {};
      for (const action of Object.keys(previous)) {
        if (!(action in next)) viewport.shortcuts.reset(action);
      }
      for (const [action, bindings] of Object.entries(next)) {
        viewport.shortcuts.rebind(action, bindings);
      }
      previousShortcuts.current = shortcuts;
    }, [viewport, shortcuts]);

    useEffect(() => {
      return () => {
        previousShortcuts.current = undefined;
      };
    }, [viewport]);

    useEffect(() => {
      if (!viewport || activation === undefined) return;
      const dispose = viewport.setActivation(activation);
      activationDispose.current?.();
      activationDispose.current = dispose;
    }, [viewport, activation]);

    useEffect(() => {
      return () => {
        activationDispose.current?.();
        activationDispose.current = undefined;
      };
    }, [viewport]);

    useEffect(() => {
      if (!viewport) return;
      return viewport.onElementActivate((event) => activationRef.current?.(event));
    }, [viewport]);

    return (
      <div {...rest} ref={containerRef} className={className} style={style}>
        {viewport && (
          <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
        )}
      </div>
    );
  },
);
