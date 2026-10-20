<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { FieldNotesCanvas } from '../index.js';
  import AllHelpers from './AllHelpers.svelte';

  const { onready, helpers = true }: { onready?: (viewport: Viewport) => void; helpers?: boolean } =
    $props();
</script>

<FieldNotesCanvas {onready}>
  {#if helpers}
    <AllHelpers />
  {/if}
</FieldNotesCanvas>
