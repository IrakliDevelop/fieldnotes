<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { FieldNotesCanvas, type FieldNotesCanvasProps } from '../index.js';
  import ViewportConsumer from './ViewportConsumer.svelte';

  const {
    onviewport,
    ...rest
  }: FieldNotesCanvasProps & { onviewport?: (viewport: Viewport) => void } = $props();
</script>

<FieldNotesCanvas {...rest}>
  <ViewportConsumer {onviewport} />
</FieldNotesCanvas>
