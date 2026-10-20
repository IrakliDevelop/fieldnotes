import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { createToolOptionsSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/**
 * `[options, setOptions]` for the named tool — re-renders when the tool's options change.
 * Returns `null` for options if the tool is not registered or does not expose options.
 */
export function useToolOptions<T extends Record<string, unknown>>(
  toolName: string,
): [options: T | null, setOptions: (partial: Partial<T>) => void] {
  const viewport = useViewport();
  const nameRef = useRef(toolName);
  nameRef.current = toolName;
  const source = useMemo(
    () => createToolOptionsSource<T>(viewport, () => nameRef.current),
    [viewport],
  );

  // A new identity per name makes React resubscribe to the new tool; the source's cache survives.
  const subscribe = useCallback(
    (onStoreChange: () => void) => source.subscribe(onStoreChange),
    [source, toolName],
  );

  const options = useSyncExternalStore(subscribe, source.getSnapshot);

  const setOptions = useCallback(
    (partial: Partial<T>) => {
      const tool = viewport.toolManager.getTool(toolName);
      tool?.setOptions?.(partial as Record<string, unknown>);
    },
    [viewport, toolName],
  );

  return [options, setOptions];
}
