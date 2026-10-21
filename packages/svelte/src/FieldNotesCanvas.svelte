<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type {
    ViewportOptions,
    Tool,
    CanvasState,
    ImportableCanvasState,
    Viewport,
  } from '@fieldnotes/core';

  export interface FieldNotesCanvasProps {
    /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
    options?: ViewportOptions;
    /**
     * `'default'` (mount-only): `createDefaultTools()` registered before `onready`, `select` active.
     * Omitted: the same bundle after `onready`, only if no tools are registered by then.
     * An array is reactive (append-only): tools present here are registered; removal is not
     * supported, and `[]` registers nothing.
     */
    tools?: Tool[] | 'default';
    /** Mount-only: a saved state (object or JSON string) loaded before `onready`. */
    initialData?: ImportableCanvasState | string;
    /** Debounce window for `onchange` in milliseconds (default 250). */
    changeDebounceMs?: number;
    /** Uncontrolled initial tool. Ignored when `tool` is set. */
    defaultTool?: string;
    /** Controlled active tool. Pair with `ontoolchange`. */
    tool?: string;
    /**
     * Reactive compatibility toggle for the core snap flag.
     * @deprecated Grid snapping is domain behavior. Configure it through the
     * VTT grid/constraint service instead.
     */
    snapToGrid?: boolean;
    /** Called once the viewport exists; a throw destroys the viewport and is rethrown. */
    onready?: (viewport: Viewport) => void;
    /** Trailing-debounced with the exported state after any change; flushed on unmount. */
    onchange?: (state: CanvasState) => void;
    /** Fires whenever the active tool changes (keyboard, API, or `tool` prop). */
    ontoolchange?: (name: string) => void;
    class?: string;
    style?: string;
    /** Rendered inside the canvas once the viewport exists; `useViewport()` works there. */
    children?: Snippet;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { mountViewport } from '@fieldnotes/core';
  import type { MountedViewport } from '@fieldnotes/core';
  import ViewportProvider from './ViewportProvider.svelte';

  const {
    options,
    tools,
    initialData,
    changeDebounceMs = 250,
    defaultTool,
    tool,
    snapToGrid,
    onready,
    onchange,
    ontoolchange,
    class: className,
    style,
    children,
  }: FieldNotesCanvasProps = $props();

  let root: HTMLDivElement;
  let viewport = $state.raw<Viewport | null>(null);

  let mounted: MountedViewport | undefined;

  // Getters keep the destructured props live for the helper's deferred reads.
  onMount(() => {
    const handle = mountViewport(root, {
      options,
      tools,
      initialData,
      get tool() {
        return tool;
      },
      get defaultTool() {
        return defaultTool;
      },
      onReady: onready,
      get onChange() {
        return onchange;
      },
      get changeDebounceMs() {
        return changeDebounceMs;
      },
      get onToolChange() {
        return ontoolchange;
      },
    });
    mounted = handle;
    viewport = handle.viewport;

    return () => {
      handle.destroy();
      mounted = undefined;
      viewport = null;
    };
  });

  $effect(() => {
    if (!viewport || tool === undefined) return;
    mounted?.setTool(tool);
  });

  $effect(() => {
    if (!viewport || snapToGrid === undefined) return;
    viewport.setSnapToGrid(snapToGrid);
  });

  $effect(() => {
    if (!viewport || !Array.isArray(tools)) return;
    mounted?.addTools(tools);
  });
</script>

<div bind:this={root} class={className} {style}>
  {#if viewport}
    <ViewportProvider {viewport}>{@render children?.()}</ViewportProvider>
  {/if}
</div>
