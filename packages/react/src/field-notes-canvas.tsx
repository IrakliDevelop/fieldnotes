import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Viewport } from '@fieldnotes/core';
import type { ViewportOptions, Tool } from '@fieldnotes/core';
import { ViewportContext } from './context';

export interface FieldNotesCanvasProps {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  options?: ViewportOptions;
  /** Reactive (append-only): tools present here are registered; removal is not supported. */
  tools?: Tool[];
  /** Uncontrolled initial tool. Ignored when `tool` is set. */
  defaultTool?: string;
  /** Controlled active tool. Pair with `onToolChange`. */
  tool?: string;
  /** Fires whenever the active tool changes (keyboard, API, or `tool` prop). */
  onToolChange?: (name: string) => void;
  /** Reactive: toggles grid snapping. */
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

    useImperativeHandle(ref, () => ({ viewport }), [viewport]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const vp = new Viewport(el, options);

      if (tools) {
        for (const t of tools) {
          vp.toolManager.register(t);
        }
      }

      const initialTool = tool ?? defaultTool;
      if (initialTool) {
        vp.setTool(initialTool);
      }

      setViewport(vp);
      onReady?.(vp);

      return () => {
        vp.destroy();
        setViewport(null);
      };
      // Constructor effect: options/tools/defaultTool are mount-only by design.
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
      if (!viewport || !tools) return;
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
