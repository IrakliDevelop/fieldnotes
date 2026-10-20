<script setup lang="ts">
import { useViewport } from '@fieldnotes/vue';

const viewport = useViewport();

const save = () => {
  localStorage.setItem('fieldnotes-example', viewport.exportJSON());
};
const load = () => {
  const json = localStorage.getItem('fieldnotes-example');
  if (json) viewport.loadJSON(json);
};
</script>

<template>
  <div class="toolbar" style="top: 64px">
    <button @click="save">Save</button>
    <button @click="load">Load</button>
  </div>
</template>
