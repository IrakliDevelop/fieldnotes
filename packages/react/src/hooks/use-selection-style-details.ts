import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ElementStyle, SelectionStyleDetails } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { STYLE_KEYS } from './style-keys';

function keysEqual(
  a: readonly (keyof ElementStyle)[],
  b: readonly (keyof ElementStyle)[],
): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

function detailsEqual(a: SelectionStyleDetails | null, b: SelectionStyleDetails | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    keysEqual(a.applicable, b.applicable) &&
    keysEqual(a.mixed, b.mixed) &&
    STYLE_KEYS.every((k) => a.common[k] === b.common[k])
  );
}

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
  const cacheRef = useRef<SelectionStyleDetails | null>(null);

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

  const getSnapshot = useCallback(() => {
    const next = viewport.getSelectionStyleDetails();
    if (detailsEqual(cacheRef.current, next)) return cacheRef.current;
    cacheRef.current = next;
    return next;
  }, [viewport]);

  const details = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const apply = useCallback((s: ElementStyle) => viewport.applyStyleToSelection(s), [viewport]);

  return [details, apply];
}
