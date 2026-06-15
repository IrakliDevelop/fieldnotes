import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ElementStyle } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

function styleEqual(a: ElementStyle | null, b: ElementStyle | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keys: (keyof ElementStyle)[] = ['color', 'fillColor', 'strokeWidth', 'opacity', 'fontSize'];
  return keys.every((k) => a[k] === b[k]);
}

/**
 * Reactive normalized style of the current selection.
 * Returns `[style, applyPatch]` — `style` is `null` when nothing is selected.
 * `applyPatch` applies an `ElementStyle` patch to every selected element.
 */
export function useSelectionStyle(): [ElementStyle | null, (style: ElementStyle) => void] {
  const viewport = useViewport();
  const cacheRef = useRef<ElementStyle | null>(null);

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
    const next = viewport.getSelectionStyle();
    if (styleEqual(cacheRef.current, next)) return cacheRef.current;
    cacheRef.current = next;
    return next;
  }, [viewport]);

  const style = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const apply = useCallback((s: ElementStyle) => viewport.applyStyleToSelection(s), [viewport]);

  return [style, apply];
}
