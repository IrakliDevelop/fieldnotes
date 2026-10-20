<script lang="ts">
  const { tool, onselect }: { tool: string; onselect: (name: string) => void } = $props();

  const TOOL_LABELS: readonly (readonly [string, string])[] = [
    ['select', 'Select (V)'],
    ['hand', 'Hand (H)'],
    ['pencil', 'Pencil (P)'],
    ['eraser', 'Eraser (E)'],
    ['note', 'Note (N)'],
    ['shape', 'Shape (S)'],
    ['stamp', 'Stamp'],
  ];
</script>

<div class="toolbar">
  {#each TOOL_LABELS as [name, label] (name)}
    <button class={tool === name ? 'active' : ''} onclick={() => onselect(name)}>{label}</button>
  {/each}
</div>
