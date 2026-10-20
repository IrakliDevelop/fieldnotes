<script module lang="ts">
  import { createDefaultTools } from '@fieldnotes/core';
  import { StampTool } from './StampTool';

  const TOOLS = [...createDefaultTools(), new StampTool()];
</script>

<script lang="ts">
  import { FieldNotesCanvas } from '@fieldnotes/svelte';
  import Toolbar from './Toolbar.svelte';
  import Sidebar from './Sidebar.svelte';
  import SaveControls from './SaveControls.svelte';

  let tool = $state('select');
  const setTool = (name: string) => (tool = name);
</script>

<div class="canvas-wrap">
  <FieldNotesCanvas
    tools={TOOLS}
    {tool}
    ontoolchange={setTool}
    snapToGrid={false}
    style="width: 100%; height: 100%"
    options={{ onImageError: ({ src }) => window.alert(`Image failed to load: ${src}`) }}
  >
    <Toolbar {tool} onselect={setTool} />
    <SaveControls />
    <Sidebar />
  </FieldNotesCanvas>
</div>
