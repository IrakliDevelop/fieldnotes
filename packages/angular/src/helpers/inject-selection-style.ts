import type { Signal } from '@angular/core';
import { createSelectionStyleSource } from '@fieldnotes/core';
import type { ElementStyle } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/**
 * Normalized style of the current selection.
 * Returns `[style, applyPatch]` — `style` is `null` when nothing is selected.
 * `applyPatch` applies an `ElementStyle` patch to every selected element.
 */
export function injectSelectionStyle(): [
  Signal<ElementStyle | null>,
  (style: ElementStyle) => void,
] {
  const viewport = injectViewport();
  return [
    injectSource(createSelectionStyleSource, null),
    (style) => requireViewport(viewport, 'applySelectionStyle').applyStyleToSelection(style),
  ];
}
