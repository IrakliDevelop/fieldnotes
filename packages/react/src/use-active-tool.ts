import { useCallback, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

export function useActiveTool(): string {
  const viewport = useViewport();

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.toolManager.onChange(() => onStoreChange()),
    [viewport],
  );

  const getSnapshot = useCallback(() => viewport.toolManager.activeTool?.name ?? '', [viewport]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
