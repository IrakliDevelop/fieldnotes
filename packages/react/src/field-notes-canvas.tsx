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
  options?: ViewportOptions;
  tools?: Tool[];
  defaultTool?: string;
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
    { options, tools, defaultTool, className, style, children, onReady },
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
        for (const tool of tools) {
          vp.toolManager.register(tool);
        }
      }

      if (defaultTool) {
        vp.toolManager.setTool(defaultTool, vp.toolContext);
      }

      setViewport(vp);
      onReady?.(vp);

      return () => {
        vp.destroy();
        setViewport(null);
      };
    }, []);

    return (
      <div ref={containerRef} className={className} style={style}>
        {viewport && (
          <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
        )}
      </div>
    );
  },
);
