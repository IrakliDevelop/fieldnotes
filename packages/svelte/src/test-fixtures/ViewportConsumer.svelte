<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { useViewport } from '../index.js';

  const props: { onviewport?: (viewport: Viewport) => void } = $props();
  const viewport = useViewport();
  // svelte-ignore state_referenced_locally
  props.onviewport?.(viewport);
</script>

<span class="child"></span>
