import { useCallback, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

/** Reactive selected element ids. Stable array reference — only changes when the selection changes. */
export function useSelection(): string[] {
  const viewport = useViewport();

  const subscribe = useCallback(
    (onChange: () => void) => viewport.onSelectionChange(onChange),
    [viewport],
  );

  const getSnapshot = useCallback(() => viewport.getSelectedIds(), [viewport]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
