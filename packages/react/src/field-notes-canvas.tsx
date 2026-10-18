import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Viewport, createDefaultTools } from '@fieldnotes/core';
import type { ViewportOptions, Tool, CanvasState, ImportableCanvasState } from '@fieldnotes/core';
import { ViewportContext } from './context';

export interface FieldNotesCanvasProps {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  options?: ViewportOptions;
  /**
   * Omitted or `'default'` (mount-only): `createDefaultTools()` with `select` active.
   * An array is reactive (append-only): tools present here are registered; removal is not
   * supported, and `[]` registers nothing. Hoist the array out of render — inline arrays
   * reconstruct Tool instances and re-run registration on every render.
   */
  tools?: Tool[] | 'default';
  /** Mount-only: a saved state (object or JSON string) loaded before `onReady`. */
  initialData?: ImportableCanvasState | string;
  /** Trailing-debounced with the exported state after any change; flushed on unmount. */
  onChange?: (state: CanvasState) => void;
  /** Debounce window for `onChange` in milliseconds (default 250). */
  changeDebounceMs?: number;
  /** Uncontrolled initial tool. Ignored when `tool` is set. */
  defaultTool?: string;
  /** Controlled active tool. Pair with `onToolChange`. */
  tool?: string;
  /**
   * Fires whenever the active tool changes (keyboard, API, or `tool` prop).
   * Memoize with useCallback to avoid re-subscribing each render.
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
  viewport: Viewport | null;
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
      snapToGrid,
      className,
      style,
      children,
      onReady,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<Viewport | null>(null);
    const changeRef = useRef({ onChange, changeDebounceMs });

    useLayoutEffect(() => {
      changeRef.current = { onChange, changeDebounceMs };
    });

    useImperativeHandle(ref, () => ({ viewport }), [viewport]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const vp = new Viewport(el, options);

      // An explicit `options.tools` is the host's choice; core registers it and activates select.
      const useDefaults =
        tools === 'default' || (tools === undefined && options?.tools === undefined);
      const mountTools = Array.isArray(tools) ? tools : [];
      for (const t of useDefaults ? createDefaultTools() : mountTools) {
        vp.toolManager.register(t);
      }

      const initialTool = tool ?? defaultTool ?? (useDefaults ? 'select' : undefined);
      if (initialTool) {
        vp.setTool(initialTool);
      }

      if (typeof initialData === 'string') vp.loadJSON(initialData);
      else if (initialData) vp.loadState(initialData);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const emit = () => {
        timer = undefined;
        changeRef.current.onChange?.(vp.exportState());
      };
      // Subscribed after initialData so the initial load is not reported as a change.
      const unsubscribe = vp.onStateChange(() => {
        clearTimeout(timer);
        timer = setTimeout(emit, changeRef.current.changeDebounceMs);
      });

      setViewport(vp);
      onReady?.(vp);

      return () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          try {
            emit();
          } catch (error) {
            // A failing host save must not leak the viewport or throw out of unmount.
            if (typeof reportError === 'function') reportError(error);
            else console.error('[fieldnotes] onChange failed during unmount', error);
          }
        }
        unsubscribe();
        vp.destroy();
        setViewport(null);
      };
      // Constructor effect: options/tools/defaultTool/initialData are mount-only by design.
    }, []);

    useEffect(() => {
      if (!viewport || tool === undefined) return;
      if (viewport.toolManager.activeTool?.name !== tool) {
        viewport.setTool(tool);
      }
    }, [viewport, tool]);

    useEffect(() => {
      if (!viewport || !onToolChange) return;
      return viewport.toolManager.onChange(onToolChange);
    }, [viewport, onToolChange]);

    useEffect(() => {
      if (!viewport || snapToGrid === undefined) return;
      viewport.setSnapToGrid(snapToGrid);
    }, [viewport, snapToGrid]);

    useEffect(() => {
      if (!viewport || !Array.isArray(tools)) return;
      for (const t of tools) {
        if (!viewport.toolManager.getTool(t.name)) {
          viewport.toolManager.register(t);
        }
      }
    }, [viewport, tools]);

    return (
      <div ref={containerRef} className={className} style={style}>
        {viewport && (
          <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
        )}
      </div>
    );
  },
);
