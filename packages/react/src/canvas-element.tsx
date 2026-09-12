import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
 * Marks every store mutation this component makes as host-owned: external origin, so it
 * neither creates an undo step nor is re-broadcast to the sync hub.
 */
const HOST_ORIGIN = 'host';

/**
 * Renders a React subtree as an HTML element embedded in the canvas coordinate space.
 * The element is host-owned and transient: it is driven entirely by props, never appears
 * in exported state, and never records an undo step.
 * Must be used inside a `<FieldNotesCanvas>`.
 */
export function CanvasElement({ position, size, children }: CanvasElementProps) {
  const viewport = useViewport();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const elementIdRef = useRef<string | null>(null);
  // Latest geometry, so a re-registration after a store clear uses current props rather than
  // the values captured when the mount effect ran.
  const geometryRef = useRef<{
    position: { x: number; y: number };
    size?: { w: number; h: number };
  }>({ position, size });

  useEffect(() => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      width: '100%',
      height: '100%',
    });

    const register = () => {
      // Append to domLayer immediately so portal children are queryable in the document
      // before the viewport render loop fires via requestAnimationFrame.
      viewport.domLayer.appendChild(container);
      const { position: current, size: currentSize } = geometryRef.current;
      return viewport.addHtmlElement(container, current, currentSize, {
        transient: true,
        origin: HOST_ORIGIN,
      });
    };

    elementIdRef.current = register();
    setPortalTarget(container);

    let disposed = false;
    // A store clear detaches every canvas-owned DOM node and forgets the content registered
    // for it, so this component has to hand its container back afterwards. The decision is
    // deferred to a microtask because a remote clear is followed — synchronously, by the sync
    // client — by re-adding the transient elements: reading the store inside the event would
    // always report this element gone and add a duplicate.
    const handleStoreReplacement = () => {
      const clearedId = elementIdRef.current;
      if (clearedId === null) return;
      queueMicrotask(() => {
        if (disposed || elementIdRef.current !== clearedId) return;
        if (viewport.store.getById(clearedId)?.type === 'html') {
          // Survived the clear (the sync client re-adds transient elements after a remote
          // clear): restore the container as that element's content instead of adding a second.
          viewport.updateHtmlElement(clearedId, container);
        } else {
          elementIdRef.current = register();
        }
        viewport.requestRender();
      });
    };
    // `clear` covers a clear-canvas gesture and a remote clear. A wholesale state replacement
    // (`loadState`/`loadJSON`) runs inside `suspendNotifications`, so the store coalesces its
    // events into a single `batch` instead: the same recovery applies.
    const unsubscribeClear = viewport.store.on('clear', handleStoreReplacement);
    const unsubscribeBatch = viewport.store.on('batch', handleStoreReplacement);

    return () => {
      disposed = true;
      unsubscribeClear();
      unsubscribeBatch();
      if (elementIdRef.current) {
        viewport.store.remove(elementIdRef.current, { origin: HOST_ORIGIN });
        viewport.requestRender();
        elementIdRef.current = null;
      }
      // Removing the element usually detaches the container, but when no render pass ran between
      // this effect and its cleanup (StrictMode's double invocation) the node is still parented
      // in the DOM layer as an empty div.
      if (container.parentNode === viewport.domLayer) container.remove();
      setPortalTarget(null);
    };
  }, [viewport]);

  useEffect(() => {
    geometryRef.current = { position, size };
    const id = elementIdRef.current;
    if (!id) return;
    viewport.store.update(id, { position, ...(size ? { size } : {}) }, { origin: HOST_ORIGIN });
    viewport.requestRender();
    // Primitive deps (position.x/y, size?.w/h) are intentional: the effect re-runs on VALUE change,
    // not object identity — so inline { x, y } literals and memoized-but-unchanged objects both behave
    // correctly (no over-firing on every parent re-render).
  }, [viewport, position.x, position.y, size?.w, size?.h]);

  if (!portalTarget) return null;
  return createPortal(children, portalTarget);
}
