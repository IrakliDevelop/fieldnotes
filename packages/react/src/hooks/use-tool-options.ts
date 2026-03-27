import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

function noop() {
  /* unsubscribe placeholder */
}

export function useToolOptions<T extends Record<string, unknown>>(
  toolName: string,
): [options: T | null, setOptions: (partial: Partial<T>) => void] {
  const viewport = useViewport();
  const cachedRef = useRef<T | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const tool = viewport.toolManager.getTool(toolName);
      if (!tool?.onOptionsChange) return noop;
      return tool.onOptionsChange(onStoreChange);
    },
    [viewport, toolName],
  );

  const getSnapshot = useCallback((): T | null => {
    const tool = viewport.toolManager.getTool(toolName);
    if (!tool?.getOptions) return null;
    const next = tool.getOptions() as T;
    const cached = cachedRef.current;
    if (cached && shallowEqual(cached, next)) return cached;
    cachedRef.current = next;
    return next;
  }, [viewport, toolName]);

  const options = useSyncExternalStore(subscribe, getSnapshot);

  const setOptions = useCallback(
    (partial: Partial<T>) => {
      const tool = viewport.toolManager.getTool(toolName);
      tool?.setOptions?.(partial as Record<string, unknown>);
    },
    [viewport, toolName],
  );

  return [options, setOptions];
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const valA = a[key];
    const valB = b[key];
    if (valA === valB) continue;
    if (
      typeof valA === 'object' &&
      valA !== null &&
      typeof valB === 'object' &&
      valB !== null &&
      !Array.isArray(valA) &&
      !Array.isArray(valB)
    ) {
      const objA = valA as Record<string, unknown>;
      const objB = valB as Record<string, unknown>;
      const innerKeys = Object.keys(objA);
      if (
        innerKeys.length === Object.keys(objB).length &&
        innerKeys.every((k) => objA[k] === objB[k])
      ) {
        continue;
      }
    }
    return false;
  }
  return true;
}
