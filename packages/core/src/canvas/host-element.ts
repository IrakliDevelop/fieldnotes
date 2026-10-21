import type { Viewport } from './viewport';

/** Canvas-space position and optional fixed size of a host element. */
export interface HostElementGeometry {
  position: { x: number; y: number };
  size?: { w: number; h: number };
}

/** Handle returned by {@link attachHostElement}. */
export interface HostElementHandle {
  /** Updates position and size; a no-op when the values equal the last ones. */
  setGeometry(geometry: HostElementGeometry): void;
  /** Removes the element and its container from the canvas. Idempotent. */
  destroy(): void;
}

// External origin: host mutations are neither undo steps nor re-broadcast to the sync hub.
const HOST_ORIGIN = 'host';

// Plain copy, so the store never holds a framework proxy.
function copyGeometry({ position, size }: HostElementGeometry): HostElementGeometry {
  return {
    position: { x: position.x, y: position.y },
    ...(size ? { size: { w: size.w, h: size.h } } : {}),
  };
}

/**
 * Registers a wrapper-owned container as a transient, host-owned html element: never exported,
 * never an undo step, and restored after a store clear or state load. For framework bindings.
 */
export function attachHostElement(
  viewport: Viewport,
  container: HTMLElement,
  geometry: HostElementGeometry,
): HostElementHandle {
  let current = copyGeometry(geometry);
  const register = () => {
    // Append to domLayer immediately so framework children are queryable in the document
    // before the viewport render loop fires via requestAnimationFrame.
    viewport.domLayer.appendChild(container);
    return viewport.addHtmlElement(container, current.position, current.size, {
      transient: true,
      origin: HOST_ORIGIN,
    });
  };

  let elementId: string | null = register();

  // A store clear detaches every canvas-owned DOM node and forgets the content registered
  // for it, so the container has to be handed back afterwards. The decision is deferred to a
  // microtask because a remote clear is followed — synchronously, by the sync client — by
  // re-adding the transient elements: reading the store inside the event would always report
  // this element gone and add a duplicate.
  const handleStoreReplacement = () => {
    const clearedId = elementId;
    if (clearedId === null) return;
    queueMicrotask(() => {
      if (elementId !== clearedId) return;
      if (viewport.store.getById(clearedId)?.type === 'html') {
        // Re-added by the sync client: restore its content instead of adding a second.
        viewport.updateHtmlElement(clearedId, container);
      } else {
        elementId = register();
      }
      viewport.requestRender();
    });
  };
  // `clear` covers a clear-canvas gesture and a remote clear. A wholesale state replacement
  // (`loadState`/`loadJSON`) runs inside `suspendNotifications`, so the store coalesces its
  // events into a single `batch` instead: the same recovery applies.
  const unsubscribeClear = viewport.store.on('clear', handleStoreReplacement);
  const unsubscribeBatch = viewport.store.on('batch', handleStoreReplacement);

  return {
    setGeometry(next) {
      const { position, size } = next;
      if (
        position.x === current.position.x &&
        position.y === current.position.y &&
        size?.w === current.size?.w &&
        size?.h === current.size?.h
      ) {
        return;
      }
      current = copyGeometry(next);
      if (!elementId) return;
      viewport.store.update(elementId, current, { origin: HOST_ORIGIN });
      viewport.requestRender();
    },
    destroy() {
      unsubscribeClear();
      unsubscribeBatch();
      if (elementId) {
        viewport.store.remove(elementId, { origin: HOST_ORIGIN });
        viewport.requestRender();
        elementId = null;
      }
      // Removing the element usually detaches the container; never leave it orphaned in the layer.
      if (container.parentNode === viewport.domLayer) container.remove();
    },
  };
}
