import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { createHistorySource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** Result of {@link useHistory}. */
export interface UseHistoryResult {
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  undo: () => void;
  redo: () => void;
}

/** `{ canUndo, canRedo, undo, redo }` — the flags update when undo/redo availability changes. */
export function useHistory(): UseHistoryResult {
  const viewport = useViewport();
  const state = useSource(createHistorySource(viewport));
  return {
    canUndo: computed(() => state.value.canUndo),
    canRedo: computed(() => state.value.canRedo),
    undo: () => viewport.undo(),
    redo: () => viewport.redo(),
  };
}
