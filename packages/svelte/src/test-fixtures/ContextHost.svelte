<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { setViewportContext } from '../index.js';
  import ViewportConsumer from './ViewportConsumer.svelte';

  const props: { viewport: Viewport; onviewport: (viewport: Viewport) => void } = $props();
  // svelte-ignore state_referenced_locally
  setViewportContext(props.viewport);
</script>

<ViewportConsumer onviewport={props.onviewport} />
