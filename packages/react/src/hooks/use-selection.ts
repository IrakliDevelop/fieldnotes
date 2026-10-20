import { useMemo, useSyncExternalStore } from 'react';
import { createSelectionSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Reactive selected element ids. Stable array reference — only changes when the selection changes. */
export function useSelection(): string[] {
  const viewport = useViewport();
  const source = useMemo(() => createSelectionSource(viewport), [viewport]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}
