<script lang="ts">
  import type { Viewport } from '@fieldnotes/core';
  import { CanvasElement, FieldNotesCanvas } from '../index.js';

  const {
    onready,
    items = [],
    toggled,
  }: {
    onready?: (viewport: Viewport) => void;
    items?: number[];
    toggled?: boolean;
  } = $props();
</script>

<FieldNotesCanvas {onready}>
  {#each items as i (i)}
    <CanvasElement position={{ x: i, y: 0 }}><span data-testid="item">{i}</span></CanvasElement>
  {/each}
  {#if toggled !== undefined}
    <CanvasElement position={{ x: 0, y: 0 }}><span data-testid="item">before</span></CanvasElement>
    {#if toggled}
      <CanvasElement position={{ x: 0, y: 0 }}><span data-testid="item">toggled</span></CanvasElement>
    {/if}
    <CanvasElement position={{ x: 0, y: 0 }}><span data-testid="item">after</span></CanvasElement>
  {/if}
</FieldNotesCanvas>
