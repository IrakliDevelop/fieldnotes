<script lang="ts">
  const props: { run: () => void } = $props();
  // svelte-ignore state_referenced_locally
  props.run();
</script>
