import type { ShallowRef } from 'vue';
import { createSelectionSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** Reactive selected element ids. Stable array reference — only changes when the selection changes. */
export function useSelection(): Readonly<ShallowRef<string[]>> {
  return useSource(createSelectionSource(useViewport()));
}
