<script lang="ts">
  import { useViewport } from '@fieldnotes/svelte';

  const viewport = useViewport();

  const save = () => {
    localStorage.setItem('fieldnotes-example', viewport.exportJSON());
  };
  const load = () => {
    const json = localStorage.getItem('fieldnotes-example');
    if (json) viewport.loadJSON(json);
  };
</script>

<div class="toolbar" style="top: 64px">
  <button onclick={save}>Save</button>
  <button onclick={load}>Load</button>
</div>
