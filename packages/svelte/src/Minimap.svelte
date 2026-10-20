<script module lang="ts">
  /** Props for {@link Minimap}. */
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
    class?: string;
    style?: string;
  }

  const toggleStyle =
    'position: absolute; top: 2px; right: 2px; width: 24px; height: 24px; padding: 0; ' +
    'border: none; border-radius: 4px; background: rgba(0,0,0,0.35); color: #fff; ' +
    'font: 14px/1 system-ui, sans-serif; cursor: pointer;';

  const collapsedStyle =
    'min-width: 44px; min-height: 44px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; ' +
    'background: rgba(255,255,255,0.85); cursor: pointer; font: 18px/1 system-ui, sans-serif;';
</script>

<!--
  @component
  Collapsible thumbnail overview navigator. Renders inside `<FieldNotesCanvas>`
  (or under `setViewportContext`). Positioning is host-owned — place and
  style the component via `class`/`style`. While collapsed, no controller
  exists: zero listeners, zero rendering.
-->
<script lang="ts">
  import { MinimapController } from '@fieldnotes/core';
  import { useViewport } from './context.js';

  const {
    width = 200,
    height = 140,
    defaultCollapsed = false,
    background,
    viewportStroke,
    class: className,
    style = '',
  }: MinimapProps = $props();
  const viewport = useViewport();
  // Uncontrolled: only the initial value is read.
  // svelte-ignore state_referenced_locally
  let collapsed = $state(defaultCollapsed);
  let canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    if (collapsed || !canvas) return;
    const controller = new MinimapController(viewport, canvas, {
      width,
      height,
      background,
      viewportStroke,
    });
    return () => controller.dispose();
  });
</script>

{#if collapsed}
  <button
    type="button"
    aria-label="Expand minimap"
    onclick={() => (collapsed = false)}
    class={className}
    style="{collapsedStyle} {style}">▣</button
  >
{:else}
  <div class={className} style="position: relative; {style}">
    <canvas bind:this={canvas} style="width: {width}px; height: {height}px; display: block"
    ></canvas>
    <button
      type="button"
      aria-label="Collapse minimap"
      onclick={() => (collapsed = true)}
      style={toggleStyle}>–</button
    >
  </div>
{/if}
