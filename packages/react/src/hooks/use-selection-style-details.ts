import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createSelectionStyleDetailsSource } from '@fieldnotes/core';
import type { ElementStyle, SelectionStyleDetails } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/**
 * Reactive style details of the current selection: per-field applicability and
 * mixed-state, plus the common style. `null` when nothing valid is selected.
 * The apply function delegates to `applyStyleToSelection` (one undo step).
 */
export function useSelectionStyleDetails(): [
  SelectionStyleDetails | null,
  (style: ElementStyle) => void,
] {
  const viewport = useViewport();
  const source = useMemo(() => createSelectionStyleDetailsSource(viewport), [viewport]);

  const details = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const apply = useCallback((s: ElementStyle) => viewport.applyStyleToSelection(s), [viewport]);

  return [details, apply];
}
