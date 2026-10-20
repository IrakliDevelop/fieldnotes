import { derived } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { createSelectionOpsSource } from '@fieldnotes/core';
import type { AlignEdge, DistributeAxis, SelectionOpsState } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/**
 * Selection operations + derived predicates for the current selection.
 * Predicates (`canGroup`/`canAlign`/…) reflect whether each action is meaningful;
 * `isLocked` is `true`/`false` when the selection is uniformly locked/unlocked,
 * and `null` when empty or mixed. Actions delegate to the core Viewport.
 */
export function useSelectionOps(): Readable<SelectionOpsState & { selectedCount: number }> & {
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
  rotateCW: () => void;
  rotateCCW: () => void;
} {
  const viewport = useViewport();
  const { subscribe } = derived(fromSource(createSelectionOpsSource(viewport)), (state) => ({
    ...state,
    selectedCount: state.selectedIds.length,
  }));
  return {
    subscribe,
    group: () => viewport.groupSelection(),
    ungroup: () => viewport.ungroupSelection(),
    toggleLock: () => viewport.toggleLockSelection(),
    align: (edge) => viewport.alignSelection(edge),
    distribute: (axis) => viewport.distributeSelection(axis),
    rotateCW: () => viewport.rotateSelection('cw'),
    rotateCCW: () => viewport.rotateSelection('ccw'),
  };
}
