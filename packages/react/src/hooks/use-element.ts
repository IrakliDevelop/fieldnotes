import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createElementSource } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** The element with this id, or null when it is absent. */
export function useElement(id: string | null): CanvasElement | null {
  const viewport = useViewport();
  const idRef = useRef(id);
  idRef.current = id;
  const source = useMemo(() => createElementSource(viewport, () => idRef.current), [viewport]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, () => null);
}
