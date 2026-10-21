import { computed } from '@angular/core';
import type { Signal } from '@angular/core';
import { createSelectionOpsSource } from '@fieldnotes/core';
import type { AlignEdge, DistributeAxis } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/** Result of {@link injectSelectionOps}. */
export interface InjectSelectionOpsResult {
  selectedIds: Signal<string[]>;
  selectedCount: Signal<number>;
  canGroup: Signal<boolean>;
  canUngroup: Signal<boolean>;
  canAlign: Signal<boolean>;
  canDistribute: Signal<boolean>;
  isLocked: Signal<boolean | null>;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
  rotateCW: () => void;
  rotateCCW: () => void;
}

/**
 * Selection operations + derived predicates for the current selection.
 * Predicates (`canGroup`/`canAlign`/…) reflect whether each action is meaningful;
 * `isLocked` is `true`/`false` when the selection is uniformly locked/unlocked,
 * and `null` when empty or mixed. Actions delegate to the core Viewport.
 */
export function injectSelectionOps(): InjectSelectionOpsResult {
  const viewport = injectViewport();
  const state = injectSource(createSelectionOpsSource, {
    selectedIds: [],
    canGroup: false,
    canUngroup: false,
    canAlign: false,
    canDistribute: false,
    isLocked: null,
  });
  const vp = (name: string) => requireViewport(viewport, name);
  return {
    selectedIds: computed(() => state().selectedIds),
    selectedCount: computed(() => state().selectedIds.length),
    canGroup: computed(() => state().canGroup),
    canUngroup: computed(() => state().canUngroup),
    canAlign: computed(() => state().canAlign),
    canDistribute: computed(() => state().canDistribute),
    isLocked: computed(() => state().isLocked),
    group: () => vp('group').groupSelection(),
    ungroup: () => vp('ungroup').ungroupSelection(),
    toggleLock: () => vp('toggleLock').toggleLockSelection(),
    align: (edge) => vp('align').alignSelection(edge),
    distribute: (axis) => vp('distribute').distributeSelection(axis),
    rotateCW: () => vp('rotateCW').rotateSelection('cw'),
    rotateCCW: () => vp('rotateCCW').rotateSelection('ccw'),
  };
}
