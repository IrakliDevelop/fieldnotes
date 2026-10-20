<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import {
    CanvasElement,
    FieldNotesCanvas,
    Minimap,
    type CanvasElementProps,
    type MinimapProps,
  } from '../index.js';

  const {
    onready,
    element,
    minimap,
  }: {
    onready?: (viewport: Viewport) => void;
    element?: Omit<CanvasElementProps, 'children'>;
    minimap?: MinimapProps;
  } = $props();
</script>

<FieldNotesCanvas {onready}>
  {#if element}
    <CanvasElement position={element.position} size={element.size}>
      <span data-testid="portal-child">Portal Content</span>
    </CanvasElement>
  {/if}
  {#if minimap}
    <Minimap {...minimap} />
  {/if}
</FieldNotesCanvas>
