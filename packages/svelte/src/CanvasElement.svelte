<script module lang="ts">
  import type { Snippet } from 'svelte';

  /** Props for {@link CanvasElement}. */
  export interface CanvasElementProps {
    /** Canvas-space position of the element's top-left corner. */
    position: { x: number; y: number };
    /** Optional fixed size; omit to let the element size to its content. */
    size?: { w: number; h: number };
    children: Snippet;
  }

  /**
   * Marks every store mutation this component makes as host-owned: external origin, so it
   * neither creates an undo step nor is re-broadcast to the sync hub.
   */
  const HOST_ORIGIN = 'host';
</script>

<!--
  @component
  Renders its children as an HTML element embedded in the canvas coordinate space.
  The element is host-owned and transient: it is driven entirely by props, never appears
  in exported state, and never records an undo step.
  Must be used inside a `<FieldNotesCanvas>`.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { useViewport } from './context.js';

  const { position, size, children }: CanvasElementProps = $props();
  const viewport = useViewport();

  // Derived per value, so new props with equal geometry do not update the store.
  const x = $derived(position.x);
  const y = $derived(position.y);
  const w = $derived(size?.w);
  const h = $derived(size?.h);
  const geometry = () => ({
    position: { x, y },
    size: w === undefined || h === undefined ? undefined : { w, h },
  });

  let container: HTMLDivElement;
  let elementId: string | null = null;

  onMount(() => {
    const register = () => {
      // Append to domLayer immediately so the children are queryable in the document
      // before the viewport render loop fires via requestAnimationFrame.
      viewport.domLayer.appendChild(container);
      const { position: current, size: currentSize } = geometry();
      return viewport.addHtmlElement(container, current, currentSize, {
        transient: true,
        origin: HOST_ORIGIN,
      });
    };

    elementId = register();

    // A store clear detaches every canvas-owned DOM node and forgets the content registered
    // for it, so this component has to hand its container back afterwards. The decision is
    // deferred to a microtask because a remote clear is followed — synchronously, by the sync
    // client — by re-adding the transient elements: reading the store inside the event would
    // always report this element gone and add a duplicate.
    const handleStoreReplacement = () => {
      const clearedId = elementId;
      if (clearedId === null) return;
      queueMicrotask(() => {
        if (elementId !== clearedId) return;
        if (viewport.store.getById(clearedId)?.type === 'html') {
          // Survived the clear (the sync client re-adds transient elements after a remote
          // clear): restore the container as that element's content instead of adding a second.
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

    return () => {
      unsubscribeClear();
      unsubscribeBatch();
      if (elementId) {
        viewport.store.remove(elementId, { origin: HOST_ORIGIN });
        viewport.requestRender();
        elementId = null;
      }
      // Removing the element usually detaches the container; never leave it orphaned in the layer.
      if (container.parentNode === viewport.domLayer) container.remove();
    };
  });

  let registered = false;
  $effect(() => {
    const next = geometry();
    // The first run sees the geometry onMount just registered.
    if (!registered) {
      registered = true;
      return;
    }
    if (!elementId) return;
    const { position: nextPosition, size: nextSize } = next;
    viewport.store.update(
      elementId,
      { position: nextPosition, ...(nextSize ? { size: nextSize } : {}) },
      { origin: HOST_ORIGIN },
    );
    viewport.requestRender();
  });
</script>

<!-- Only the inner div moves into the canvas: Svelte moves its own root on keyed reorders. -->
<div style="display: contents">
  <div bind:this={container} style="width: 100%; height: 100%">{@render children()}</div>
</div>
