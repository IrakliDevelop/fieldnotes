import type { Readable } from 'svelte/store';
import { createSelectionStyleSource } from '@fieldnotes/core';
import type { ElementStyle } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/**
 * Normalized style of the current selection.
 * Returns `[style, applyPatch]` — `style` is `null` when nothing is selected.
 * `applyPatch` applies an `ElementStyle` patch to every selected element.
 */
export function useSelectionStyle(): [
  Readable<ElementStyle | null>,
  (style: ElementStyle) => void,
] {
  const viewport = useViewport();
  return [
    fromSource(createSelectionStyleSource(viewport)),
    (style) => viewport.applyStyleToSelection(style),
  ];
}
