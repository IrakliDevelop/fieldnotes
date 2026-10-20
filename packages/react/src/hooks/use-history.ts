import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createHistorySource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

export interface UseHistoryResult {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** `{ canUndo, canRedo, undo, redo }` — re-renders when undo/redo availability changes. */
export function useHistory(): UseHistoryResult {
  const viewport = useViewport();
  const source = useMemo(() => createHistorySource(viewport), [viewport]);

  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);

  const undo = useCallback(() => viewport.undo(), [viewport]);
  const redo = useCallback(() => viewport.redo(), [viewport]);

  return {
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    undo,
    redo,
  };
}
