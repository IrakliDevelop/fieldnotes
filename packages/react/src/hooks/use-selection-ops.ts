import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createSelectionOpsSource } from '@fieldnotes/core';
import type { AlignEdge, DistributeAxis } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

export interface UseSelectionOpsResult {
  selectedIds: string[];
  selectedCount: number;
  canGroup: boolean;
  canUngroup: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  isLocked: boolean | null;
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
  const source = useMemo(() => createSelectionOpsSource(viewport), [viewport]);

  const snap = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);

  const group = useCallback(() => viewport.groupSelection(), [viewport]);
  const ungroup = useCallback(() => viewport.ungroupSelection(), [viewport]);
  const toggleLock = useCallback(() => viewport.toggleLockSelection(), [viewport]);
  const align = useCallback((edge: AlignEdge) => viewport.alignSelection(edge), [viewport]);
  const distribute = useCallback(
    (axis: DistributeAxis) => viewport.distributeSelection(axis),
    [viewport],
  );
  const rotateCW = useCallback(() => viewport.rotateSelection('cw'), [viewport]);
  const rotateCCW = useCallback(() => viewport.rotateSelection('ccw'), [viewport]);

  return {
    selectedIds: snap.selectedIds,
    selectedCount: snap.selectedIds.length,
    canGroup: snap.canGroup,
    canUngroup: snap.canUngroup,
    canAlign: snap.canAlign,
    canDistribute: snap.canDistribute,
    isLocked: snap.isLocked,
    group,
    ungroup,
    toggleLock,
    align,
    distribute,
    rotateCW,
    rotateCCW,
  };
}
