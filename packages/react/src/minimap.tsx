import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MinimapController } from '@fieldnotes/core';
import { useViewport } from './hooks/use-viewport';

export interface MinimapProps {
  /** Thumbnail width in CSS pixels. Default `200`. */
  width?: number;
  /** Thumbnail height in CSS pixels. Default `140`. */
  height?: number;
  /** Start collapsed (icon button only). Uncontrolled. Default `false`. */
  defaultCollapsed?: boolean;
  /** Backdrop fill behind the thumbnail. */
  background?: string;
  /** Viewport rectangle stroke color. */
  viewportStroke?: string;
  className?: string;
  style?: CSSProperties;
}

const toggleStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  font: '14px/1 system-ui, sans-serif',
  cursor: 'pointer',
};

/**
 * Collapsible thumbnail overview navigator. Renders inside `<FieldNotesCanvas>`
 * (or any `ViewportContext.Provider`). Positioning is host-owned — place and
 * style the component via `className`/`style`. While collapsed, no controller
 * exists: zero listeners, zero rendering.
 */
export function Minimap({
  width = 200,
  height = 140,
  defaultCollapsed = false,
  background,
  viewportStroke,
  className,
  style,
}: MinimapProps) {
  const viewport = useViewport();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (collapsed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new MinimapController(viewport, canvas, {
      width,
      height,
      background,
      viewportStroke,
    });
    return () => controller.dispose();
  }, [viewport, collapsed, width, height, background, viewportStroke]);

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Expand minimap"
        onClick={() => setCollapsed(false)}
        className={className}
        style={{
          minWidth: 44,
          minHeight: 44,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.85)',
          cursor: 'pointer',
          font: '18px/1 system-ui, sans-serif',
          ...style,
        }}
      >
        {'▣'}
      </button>
    );
  }

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <canvas
        ref={canvasRef}
        style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
      />
      <button
        type="button"
        aria-label="Collapse minimap"
        onClick={() => setCollapsed(true)}
        style={toggleStyle}
      >
        {'–'}
      </button>
    </div>
  );
}
