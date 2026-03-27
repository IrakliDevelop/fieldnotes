import { useCallback, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

export function useActiveTool(): [toolName: string, setTool: (name: string) => void] {
  const viewport = useViewport();

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.toolManager.onChange(() => onStoreChange()),
    [viewport],
  );

  const getSnapshot = useCallback(() => viewport.toolManager.activeTool?.name ?? '', [viewport]);

  const toolName = useSyncExternalStore(subscribe, getSnapshot);

  const setTool = useCallback(
    (name: string) => viewport.toolManager.setTool(name, viewport.toolContext),
    [viewport],
  );

  return [toolName, setTool];
}
