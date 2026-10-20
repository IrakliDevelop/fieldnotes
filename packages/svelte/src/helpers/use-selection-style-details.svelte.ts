import type { Readable } from 'svelte/store';
import { createSelectionStyleDetailsSource } from '@fieldnotes/core';
import type { ElementStyle, SelectionStyleDetails } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/**
 * Style details of the current selection: per-field applicability and
 * mixed-state, plus the common style. `null` when nothing valid is selected.
 * The apply function delegates to `applyStyleToSelection` (one undo step).
 */
export function useSelectionStyleDetails(): [
  Readable<SelectionStyleDetails | null>,
  (style: ElementStyle) => void,
] {
  const viewport = useViewport();
  return [
    fromSource(createSelectionStyleDetailsSource(viewport)),
    (style) => viewport.applyStyleToSelection(style),
  ];
}
