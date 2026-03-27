import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from './hooks/use-viewport';

export interface CanvasElementProps {
  position: { x: number; y: number };
  size?: { w: number; h: number };
  children: ReactNode;
}

export function CanvasElement({ position, size, children }: CanvasElementProps) {
  const viewport = useViewport();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const elementIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      width: '100%',
      height: '100%',
    });

    // Append to domLayer immediately so portal children are queryable in the document
    // before the viewport render loop fires via requestAnimationFrame.
    viewport.domLayer.appendChild(container);

    const id = viewport.addHtmlElement(container, position, size);
    elementIdRef.current = id;
    setPortalTarget(container);

    return () => {
      if (elementIdRef.current) {
        viewport.store.remove(elementIdRef.current);
        viewport.requestRender();
        elementIdRef.current = null;
      }
      setPortalTarget(null);
    };
  }, [viewport]);

  useEffect(() => {
    const id = elementIdRef.current;
    if (!id) return;
    viewport.store.update(id, { position });
    if (size) {
      viewport.store.update(id, { size });
    }
    viewport.requestRender();
  }, [viewport, position.x, position.y, size?.w, size?.h]);

  if (!portalTarget) return null;
  return createPortal(children, portalTarget);
}
