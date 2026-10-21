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
  import { attachHostElement } from '@fieldnotes/core';
  import type { HostElementHandle } from '@fieldnotes/core';
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
  let host: HostElementHandle | undefined;

  onMount(() => {
    const handle = attachHostElement(viewport, container, geometry());
    host = handle;
    return () => handle.destroy();
  });

  $effect(() => {
    // Read before the optional call so the effect tracks the geometry before the host exists.
    const next = geometry();
    host?.setGeometry(next);
  });
</script>

<!-- Only the inner div moves into the canvas: Svelte moves its own root on keyed reorders. -->
<div style="display: contents">
  <div bind:this={container} style="width: 100%; height: 100%">{@render children()}</div>
</div>
