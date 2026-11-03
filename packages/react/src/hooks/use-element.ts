import { useMemo, useSyncExternalStore } from 'react';
import type { CanvasElement } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** The element with this id, or null when it is absent. */
export function useElement(id: string | null): CanvasElement | null {
  const viewport = useViewport();
  const subscribe = useMemo(
    () => (onChange: () => void) => viewport.store.onChange(onChange),
    [viewport],
  );
  const getSnapshot = useMemo(
    () => () => (id === null ? null : (viewport.store.getById(id) ?? null)),
    [viewport, id],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
