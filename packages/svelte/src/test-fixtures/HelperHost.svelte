<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { setViewportContext } from '../index.js';
  import RunHelper from './RunHelper.svelte';

  const props: { viewport: Viewport; run: () => void } = $props();
  // svelte-ignore state_referenced_locally
  setViewportContext(props.viewport);
</script>

<RunHelper run={props.run} />
