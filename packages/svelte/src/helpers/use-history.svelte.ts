import type { Readable } from 'svelte/store';
import { createHistorySource } from '@fieldnotes/core';
import type { HistoryState } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** `$history` is `{ canUndo, canRedo }`; `history.undo()` / `history.redo()` act on the viewport. */
export function useHistory(): Readable<HistoryState> & { undo(): void; redo(): void } {
  const viewport = useViewport();
  const { subscribe } = fromSource(createHistorySource(viewport));
  return {
    subscribe,
    undo: () => viewport.undo(),
    redo: () => viewport.redo(),
  };
}
