import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { attachHostElement } from '@fieldnotes/core';
import type { HostElementGeometry, HostElementHandle } from '@fieldnotes/core';
import { useViewport } from './hooks/use-viewport';

/** Props for {@link CanvasElement}. */
export interface CanvasElementProps {
  /** Canvas-space position of the element's top-left corner. */
  position: { x: number; y: number };
  /** Optional fixed size; omit to let the element size to its content. */
  size?: { w: number; h: number };
  children: ReactNode;
}

/**
 * Renders a React subtree as an HTML element embedded in the canvas coordinate space.
 * The element is host-owned and transient: it is driven entirely by props, never appears
 * in exported state, and never records an undo step.
 * Must be used inside a `<FieldNotesCanvas>`.
 */
export function CanvasElement({ position, size, children }: CanvasElementProps) {
  const viewport = useViewport();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HostElementHandle | null>(null);
  // Latest geometry, so attaching uses current props rather than those of the first render.
  const geometryRef = useRef<HostElementGeometry>({ position, size });

  useEffect(() => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      width: '100%',
      height: '100%',
    });
    const host = attachHostElement(viewport, container, geometryRef.current);
    hostRef.current = host;
    setPortalTarget(container);

    return () => {
      host.destroy();
      setPortalTarget(null);
    };
  }, [viewport]);

  useEffect(() => {
    geometryRef.current = { position, size };
    hostRef.current?.setGeometry({ position, size });
    // Primitive deps (position.x/y, size?.w/h) are intentional: the effect re-runs on VALUE change,
    // not object identity — so inline { x, y } literals and memoized-but-unchanged objects both behave
    // correctly (no over-firing on every parent re-render).
  }, [viewport, position.x, position.y, size?.w, size?.h]);

  if (!portalTarget) return null;
  return createPortal(children, portalTarget);
}
