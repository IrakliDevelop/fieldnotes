import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** All elements; re-renders on every store mutation (use a selector for hot paths). */
export function useElements(): CanvasElement[];
/** Elements of one type; re-renders on every store mutation. */
export function useElements<T extends ElementType>(type: T): Extract<CanvasElement, { type: T }>[];
/**
 * Derived value; re-renders only when the selected value changes (per `isEqual`,
 * default Object.is). Keep the selector referentially stable (useCallback or module scope).
 */
export function useElements<R>(
  selector: (elements: CanvasElement[]) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;
export function useElements<R>(
  arg?: ElementType | ((elements: CanvasElement[]) => R),
  isEqual?: (a: R, b: R) => boolean,
): CanvasElement[] | R {
  const viewport = useViewport();
  const cachedRef = useRef<CanvasElement[]>([]);
  const selectedRef = useRef<{ value: R } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.store.onChange(onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): CanvasElement[] | R => {
    if (typeof arg === 'function') {
      const next = arg(viewport.store.getAll());
      const prev = selectedRef.current;
      const equal: (a: R, b: R) => boolean = isEqual ?? Object.is;
      if (prev !== null && equal(prev.value, next)) {
        return prev.value;
      }
      selectedRef.current = { value: next };
      return next;
    }

    const next = arg ? viewport.store.getElementsByType(arg) : viewport.store.getAll();
    const cached = cachedRef.current;
    if (cached.length === next.length && cached.every((el, i) => el === next[i])) {
      return cached;
    }
    cachedRef.current = next;
    return next;
  }, [viewport, arg, isEqual]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
