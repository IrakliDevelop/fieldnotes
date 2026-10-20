import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createSelectionStyleSource } from '@fieldnotes/core';
import type { ElementStyle } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/**
 * Reactive normalized style of the current selection.
 * Returns `[style, applyPatch]` — `style` is `null` when nothing is selected.
 * `applyPatch` applies an `ElementStyle` patch to every selected element.
 */
export function useSelectionStyle(): [ElementStyle | null, (style: ElementStyle) => void] {
  const viewport = useViewport();
  const source = useMemo(() => createSelectionStyleSource(viewport), [viewport]);

  const style = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);

  const apply = useCallback((s: ElementStyle) => viewport.applyStyleToSelection(s), [viewport]);

  return [style, apply];
}
