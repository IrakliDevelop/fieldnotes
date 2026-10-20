import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { createSelectionOpsSource } from '@fieldnotes/core';
import type { AlignEdge, DistributeAxis } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** Result of {@link useSelectionOps}. */
export interface UseSelectionOpsResult {
  selectedIds: ComputedRef<string[]>;
  selectedCount: ComputedRef<number>;
  canGroup: ComputedRef<boolean>;
  canUngroup: ComputedRef<boolean>;
  canAlign: ComputedRef<boolean>;
  canDistribute: ComputedRef<boolean>;
  isLocked: ComputedRef<boolean | null>;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
  rotateCW: () => void;
  rotateCCW: () => void;
}

/**
 * Reactive selection operations + derived predicates for the current selection.
 * Predicates (`canGroup`/`canAlign`/…) reflect whether each action is meaningful;
 * `isLocked` is `true`/`false` when the selection is uniformly locked/unlocked,
 * and `null` when empty or mixed. Actions delegate to the core Viewport.
 */
export function useSelectionOps(): UseSelectionOpsResult {
  const viewport = useViewport();
  const state = useSource(createSelectionOpsSource(viewport));
  return {
    selectedIds: computed(() => state.value.selectedIds),
    selectedCount: computed(() => state.value.selectedIds.length),
    canGroup: computed(() => state.value.canGroup),
    canUngroup: computed(() => state.value.canUngroup),
    canAlign: computed(() => state.value.canAlign),
    canDistribute: computed(() => state.value.canDistribute),
    isLocked: computed(() => state.value.isLocked),
    group: () => viewport.groupSelection(),
    ungroup: () => viewport.ungroupSelection(),
    toggleLock: () => viewport.toggleLockSelection(),
    align: (edge) => viewport.alignSelection(edge),
    distribute: (axis) => viewport.distributeSelection(axis),
    rotateCW: () => viewport.rotateSelection('cw'),
    rotateCCW: () => viewport.rotateSelection('ccw'),
  };
}
