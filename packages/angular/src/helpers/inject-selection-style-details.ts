import type { Signal } from '@angular/core';
import { createSelectionStyleDetailsSource } from '@fieldnotes/core';
import type { ElementStyle, SelectionStyleDetails } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/**
 * Style details of the current selection: per-field applicability and
 * mixed-state, plus the common style. `null` when nothing valid is selected.
 * The apply function delegates to `applyStyleToSelection` (one undo step).
 */
export function injectSelectionStyleDetails(): [
  Signal<SelectionStyleDetails | null>,
  (style: ElementStyle) => void,
] {
  const viewport = injectViewport();
  return [
    injectSource(createSelectionStyleDetailsSource, null),
    (style) => requireViewport(viewport, 'applySelectionStyle').applyStyleToSelection(style),
  ];
}
