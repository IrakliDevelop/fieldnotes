import { useCallback } from 'react';
import { useViewport } from './use-viewport';

/** Runs synchronous viewport mutations as one undo step. */
export function useTransaction(): <T>(operation: () => T) => T {
  const viewport = useViewport();
  return useCallback(<T>(operation: () => T) => viewport.transaction(operation), [viewport]);
}
