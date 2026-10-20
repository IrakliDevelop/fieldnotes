<script setup lang="ts">
import { useElements, useHistory } from '@fieldnotes/vue';
import type { CanvasElement } from '@fieldnotes/core';

const count = useElements((els: CanvasElement[]) => els.length);
const notes = useElements('note');
const { canUndo, canRedo, undo, redo } = useHistory();
</script>

<template>
  <div class="sidebar">
    <h3>Board</h3>
    <p>{{ count }} elements</p>
    <button :disabled="!canUndo" @click="undo">Undo</button>
    {{ ' ' }}
    <button :disabled="!canRedo" @click="redo">Redo</button>
    <h4>Notes</h4>
    <ul>
      <li v-for="n in notes" :key="n.id">
        {{ n.text ? n.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)' }}
      </li>
    </ul>
  </div>
</template>
