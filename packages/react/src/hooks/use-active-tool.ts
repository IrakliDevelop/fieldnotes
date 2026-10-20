import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createActiveToolSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** `[activeToolName, setTool]` — re-renders on tool switches. */
export function useActiveTool(): [toolName: string, setTool: (name: string) => void] {
  const viewport = useViewport();
  const source = useMemo(() => createActiveToolSource(viewport), [viewport]);

  const toolName = useSyncExternalStore(source.subscribe, source.getSnapshot);

  const setTool = useCallback((name: string) => viewport.setTool(name), [viewport]);

  return [toolName, setTool];
}
