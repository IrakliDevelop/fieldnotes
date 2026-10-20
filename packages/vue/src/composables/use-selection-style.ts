import type { ShallowRef } from 'vue';
import { createSelectionStyleSource } from '@fieldnotes/core';
import type { ElementStyle } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/**
 * Reactive normalized style of the current selection.
 * Returns `[style, applyPatch]` — `style` is `null` when nothing is selected.
 * `applyPatch` applies an `ElementStyle` patch to every selected element.
 */
export function useSelectionStyle(): [
  Readonly<ShallowRef<ElementStyle | null>>,
  (style: ElementStyle) => void,
] {
  const viewport = useViewport();
  return [
    useSource(createSelectionStyleSource(viewport)),
    (style) => viewport.applyStyleToSelection(style),
  ];
}
