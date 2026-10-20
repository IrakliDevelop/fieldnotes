<script lang="ts">
import { createDefaultTools } from '@fieldnotes/core';
import type { ViewportOptions } from '@fieldnotes/core';
import { StampTool } from './StampTool';

const TOOLS = [...createDefaultTools(), new StampTool()];
</script>

<script setup lang="ts">
import { ref } from 'vue';
import { FieldNotesCanvas } from '@fieldnotes/vue';
import Toolbar from './Toolbar.vue';
import Sidebar from './Sidebar.vue';
import SaveControls from './SaveControls.vue';

const tool = ref('select');
const options: ViewportOptions = {
  onImageError: ({ src }) => window.alert(`Image failed to load: ${src}`),
};
</script>

<template>
  <div class="canvas-wrap">
    <FieldNotesCanvas
      v-model:tool="tool"
      :tools="TOOLS"
      :snap-to-grid="false"
      :style="{ width: '100%', height: '100%' }"
      :options="options"
    >
      <Toolbar :tool="tool" @select="tool = $event" />
      <SaveControls />
      <Sidebar />
    </FieldNotesCanvas>
  </div>
</template>
