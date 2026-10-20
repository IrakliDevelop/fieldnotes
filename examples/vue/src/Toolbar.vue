<script setup lang="ts">
defineProps<{ tool: string }>();
defineEmits<{ select: [name: string] }>();

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

<template>
  <div class="toolbar">
    <button
      v-for="[name, label] in TOOL_LABELS"
      :key="name"
      :class="tool === name ? 'active' : ''"
      @click="$emit('select', name)"
    >
      {{ label }}
    </button>
  </div>
</template>
