import type { Readable } from 'svelte/store';
import { createSelectionSource } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** Selected element ids. Stable array reference — only changes when the selection changes. */
export function useSelection(): Readable<string[]> {
  return fromSource(createSelectionSource(useViewport()));
}
