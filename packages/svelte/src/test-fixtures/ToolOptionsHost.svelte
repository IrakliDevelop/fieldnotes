<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { setViewportContext, useToolOptions } from '../index.js';

  const props: {
    viewport: Viewport;
    name: string;
    onresult: (result: ReturnType<typeof useToolOptions>) => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  setViewportContext(props.viewport);
  // svelte-ignore state_referenced_locally
  props.onresult(useToolOptions(() => props.name));
</script>
