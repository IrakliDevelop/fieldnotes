import { computed } from '@angular/core';
import type { Signal } from '@angular/core';
import { createHistorySource } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/** Result of {@link injectHistory}. */
export interface InjectHistoryResult {
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;
  undo: () => void;
  redo: () => void;
}

/** `{ canUndo, canRedo, undo, redo }` — the flags update when undo/redo availability changes. */
export function injectHistory(): InjectHistoryResult {
  const viewport = injectViewport();
  const state = injectSource(createHistorySource, { canUndo: false, canRedo: false });
  return {
    canUndo: computed(() => state().canUndo),
    canRedo: computed(() => state().canRedo),
    undo: () => requireViewport(viewport, 'undo').undo(),
    redo: () => requireViewport(viewport, 'redo').redo(),
  };
}
