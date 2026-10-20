<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Viewport } from '@fieldnotes/core';
  import { setViewportContext } from './context.js';

  // Sets the context in its own init so children only render once the viewport exists.
  const props: { viewport: Viewport; children: Snippet } = $props();
  // The canvas mounts this provider once per viewport, so the initial value is the only one.
  // svelte-ignore state_referenced_locally
  setViewportContext(props.viewport);
</script>

{@render props.children()}
