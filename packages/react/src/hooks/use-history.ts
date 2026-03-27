import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

interface HistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
}

export interface UseHistoryResult {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useHistory(): UseHistoryResult {
  const viewport = useViewport();
  const cachedRef = useRef<HistorySnapshot>({ canUndo: false, canRedo: false });

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.history.onChange(onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): HistorySnapshot => {
    const canUndo = viewport.history.canUndo;
    const canRedo = viewport.history.canRedo;
    const cached = cachedRef.current;
    if (cached.canUndo === canUndo && cached.canRedo === canRedo) {
      return cached;
    }
    const next = { canUndo, canRedo };
    cachedRef.current = next;
    return next;
  }, [viewport]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const undo = useCallback(() => viewport.undo(), [viewport]);
  const redo = useCallback(() => viewport.redo(), [viewport]);

  return {
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    undo,
    redo,
  };
}
