import type { Readable } from 'svelte/store';
import { createHistorySource } from '@fieldnotes/core';
import type { HistoryState } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** Result of {@link useHistory}. */
export type UseHistoryResult = Readable<HistoryState> & { undo(): void; redo(): void };

/** `$history` is `{ canUndo, canRedo }`; `history.undo()` / `history.redo()` act on the viewport. */
export function useHistory(): UseHistoryResult {
  const viewport = useViewport();
  const { subscribe } = fromSource(createHistorySource(viewport));
  return {
    subscribe,
    undo: () => viewport.undo(),
    redo: () => viewport.redo(),
  };
}
