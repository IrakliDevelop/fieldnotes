import { useCallback } from 'react';
import type { ImportableCanvasState } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Loads a state object or JSON string into the viewport. */
export function useLoad(): (data: ImportableCanvasState | string) => void {
  const viewport = useViewport();
  return useCallback(
    (data) => {
      if (typeof data === 'string') viewport.loadJSON(data);
      else viewport.loadState(data);
    },
    [viewport],
  );
}
