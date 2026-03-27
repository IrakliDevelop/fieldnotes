import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

export function useElements(): CanvasElement[];
export function useElements<T extends ElementType>(type: T): Extract<CanvasElement, { type: T }>[];
export function useElements(type?: ElementType): CanvasElement[] {
  const viewport = useViewport();
  const cachedRef = useRef<CanvasElement[]>([]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.store.onChange(onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): CanvasElement[] => {
    const next = type ? viewport.store.getElementsByType(type) : viewport.store.getAll();
    const cached = cachedRef.current;
    if (cached.length === next.length && cached.every((el, i) => el === next[i])) {
      return cached;
    }
    cachedRef.current = next;
    return next;
  }, [viewport, type]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
