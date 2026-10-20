<script lang="ts">
  import { useElements, useHistory } from '@fieldnotes/svelte';
  import type { CanvasElement } from '@fieldnotes/core';

  const count = useElements((els: CanvasElement[]) => els.length);
  const notes = useElements('note');
  const history = useHistory();
</script>

<div class="sidebar">
  <h3>Board</h3>
  <p>{$count} elements</p>
  <button onclick={history.undo} disabled={!$history.canUndo}>Undo</button>
  <button onclick={history.redo} disabled={!$history.canRedo}>Redo</button>
  <h4>Notes</h4>
  <ul>
    {#each $notes as n (n.id)}
      <li>{n.text ? n.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)'}</li>
    {/each}
  </ul>
</div>
