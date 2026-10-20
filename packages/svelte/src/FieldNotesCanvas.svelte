<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ViewportOptions, Tool, CanvasState, ImportableCanvasState } from '@fieldnotes/core';
  import { Viewport, createDefaultTools } from '@fieldnotes/core';

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

  // Props are read inside callbacks, so the debounce and handlers always see the latest values.
  onMount(() => {
    const vp = new Viewport(root, options);

    const activate = (fallback?: string) => {
      const name = tool ?? defaultTool ?? fallback;
      if (name) vp.setTool(name);
    };
    // An explicit `options.tools` is the host's choice; core registers it and activates select.
    const deferDefaults = tools === undefined && options?.tools === undefined;
    for (const t of tools === 'default' ? createDefaultTools() : (tools ?? [])) {
      vp.toolManager.register(t);
    }
    if (!deferDefaults) activate(tools === 'default' ? 'select' : undefined);

    try {
      if (typeof initialData === 'string') vp.loadJSON(initialData);
      else if (initialData) vp.loadState(initialData);
    } catch (error) {
      vp.destroy();
      throw error;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const emitChange = () => {
      timer = undefined;
      onchange?.(vp.exportState());
    };
    // Subscribed after initialData so the initial load is not reported as a change.
    const unsubscribe = vp.onStateChange(() => {
      clearTimeout(timer);
      timer = setTimeout(emitChange, changeDebounceMs);
    });

    try {
      onready?.(vp);

      // Hosts that register their own tools in onready keep exactly those.
      if (deferDefaults) {
        const registerDefaults = vp.toolManager.toolNames.length === 0;
        if (registerDefaults) {
          for (const t of createDefaultTools()) vp.toolManager.register(t);
        }
        activate(registerDefaults ? 'select' : undefined);
      }
    } catch (error) {
      clearTimeout(timer);
      unsubscribe();
      vp.destroy();
      throw error;
    }

    const unsubscribeTool = vp.toolManager.onChange((name) => ontoolchange?.(name));
    viewport = vp;

    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        try {
          emitChange();
        } catch (error) {
          // A failing host save must not leak the viewport or throw out of unmount.
          if (typeof reportError === 'function') reportError(error);
          else console.error('[fieldnotes] onChange failed during unmount', error);
        }
      }
      unsubscribeTool();
      unsubscribe();
      vp.destroy();
      viewport = null;
    };
  });

  $effect(() => {
    if (!viewport || tool === undefined) return;
    if (viewport.toolManager.activeTool?.name !== tool) viewport.setTool(tool);
  });

  $effect(() => {
    if (!viewport || snapToGrid === undefined) return;
    viewport.setSnapToGrid(snapToGrid);
  });

  $effect(() => {
    if (!viewport || !Array.isArray(tools)) return;
    for (const t of tools) {
      if (!viewport.toolManager.getTool(t.name)) viewport.toolManager.register(t);
    }
  });
</script>

<div bind:this={root} class={className} {style}>
  {#if viewport}
    <ViewportProvider {viewport}>{@render children?.()}</ViewportProvider>
  {/if}
</div>
