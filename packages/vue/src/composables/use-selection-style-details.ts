import type { ShallowRef } from 'vue';
import { createSelectionStyleDetailsSource } from '@fieldnotes/core';
import type { ElementStyle, SelectionStyleDetails } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/**
 * Reactive style details of the current selection: per-field applicability and
 * mixed-state, plus the common style. `null` when nothing valid is selected.
 * The apply function delegates to `applyStyleToSelection` (one undo step).
 */
export function useSelectionStyleDetails(): [
  Readonly<ShallowRef<SelectionStyleDetails | null>>,
  (style: ElementStyle) => void,
] {
  const viewport = useViewport();
  return [
    useSource(createSelectionStyleDetailsSource(viewport)),
    (style) => viewport.applyStyleToSelection(style),
  ];
}
