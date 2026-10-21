import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { mountViewport } from '@fieldnotes/core';
import type {
  Viewport,
  ViewportOptions,
  Tool,
  CanvasState,
  ImportableCanvasState,
  MountedViewport,
} from '@fieldnotes/core';
import { ViewportContext } from './context';

export interface FieldNotesCanvasProps {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  options?: ViewportOptions;
  /**
   * `'default'` (mount-only): `createDefaultTools()` registered before `onReady`, `select` active.
   * Omitted: the same bundle after `onReady`, only if no tools are registered by then.
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
    const mountedRef = useRef<MountedViewport | null>(null);
    const changeRef = useRef({ onChange, changeDebounceMs });
    changeRef.current = { onChange, changeDebounceMs };

    useImperativeHandle(ref, () => ({ viewport }), [viewport]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const mounted = mountViewport(el, {
        options,
        tools,
        initialData,
        tool,
        defaultTool,
        onReady,
        get onChange() {
          return changeRef.current.onChange;
        },
        get changeDebounceMs() {
          return changeRef.current.changeDebounceMs;
        },
      });
      mountedRef.current = mounted;
      setViewport(mounted.viewport);

      return () => {
        mounted.destroy();
        setViewport(null);
      };
      // Constructor effect: options/tools/defaultTool/initialData are mount-only by design.
    }, []);

    useEffect(() => {
      if (!viewport || tool === undefined) return;
      mountedRef.current?.setTool(tool);
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
      mountedRef.current?.addTools(tools);
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
