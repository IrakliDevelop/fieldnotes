import { useCallback, useRef, useSyncExternalStore } from 'react';
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
}

interface Snapshot {
  selectedIds: string[];
  canGroup: boolean;
  canUngroup: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  isLocked: boolean | null;
}

function snapshotEqual(a: Snapshot, b: Snapshot): boolean {
  return (
    a.selectedIds === b.selectedIds &&
    a.canGroup === b.canGroup &&
    a.canUngroup === b.canUngroup &&
    a.canAlign === b.canAlign &&
    a.canDistribute === b.canDistribute &&
    a.isLocked === b.isLocked
  );
}

/**
 * Reactive selection operations + derived predicates for the current selection.
 * Predicates (`canGroup`/`canAlign`/…) reflect whether each action is meaningful;
 * `isLocked` is `true`/`false` when the selection is uniformly locked/unlocked,
 * and `null` when empty or mixed. Actions delegate to the core Viewport.
 */
export function useSelectionOps(): UseSelectionOpsResult {
  const viewport = useViewport();
  const cacheRef = useRef<Snapshot | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const offSel = viewport.onSelectionChange(onChange);
      const offStore = viewport.store.onChange(onChange);
      return () => {
        offSel();
        offStore();
      };
    },
    [viewport],
  );

  const getSnapshot = useCallback((): Snapshot => {
    const ids = viewport.getSelectedIds();
    const n = ids.length;
    let canUngroup = false;
    let lockedCount = 0;
    for (const id of ids) {
      const el = viewport.store.getById(id);
      if (!el) continue;
      if (el.groupId !== undefined) canUngroup = true;
      if (el.locked) lockedCount++;
    }
    const isLocked: boolean | null =
      n === 0 ? null : lockedCount === n ? true : lockedCount === 0 ? false : null;
    const next: Snapshot = {
      selectedIds: ids,
      canGroup: n >= 2,
      canUngroup,
      canAlign: n >= 2,
      canDistribute: n >= 3,
      isLocked,
    };
    const prev = cacheRef.current;
    if (prev && snapshotEqual(prev, next)) return prev;
    cacheRef.current = next;
    return next;
  }, [viewport]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const group = useCallback(() => viewport.groupSelection(), [viewport]);
  const ungroup = useCallback(() => viewport.ungroupSelection(), [viewport]);
  const toggleLock = useCallback(() => viewport.toggleLockSelection(), [viewport]);
  const align = useCallback((edge: AlignEdge) => viewport.alignSelection(edge), [viewport]);
  const distribute = useCallback(
    (axis: DistributeAxis) => viewport.distributeSelection(axis),
    [viewport],
  );

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
  };
}
