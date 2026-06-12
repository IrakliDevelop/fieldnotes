import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (k) =>
          k in (b as Record<string, unknown>) &&
          Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/** All elements; re-renders on every store mutation (use a selector for hot paths). */
export function useElements(): CanvasElement[];
/** Elements of one type; re-renders on every store mutation. */
export function useElements<T extends ElementType>(type: T): Extract<CanvasElement, { type: T }>[];
/**
 * Derived value; re-renders only when the selected value changes (per `isEqual`,
 * default: one-level shallow compare — arrays by index, plain objects by key, primitives by
 * Object.is). Keep the selector referentially stable (useCallback or module scope).
 *
 * Supply `isEqual` for deeper structures. Note: selectors returning nested fresh objects
 * (e.g. `els => els.map(e => ({ ...e.position }))`) still need a custom comparator because
 * the default only compares one level deep.
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
      const equal: (a: R, b: R) => boolean = isEqual ?? (shallowEqual as (a: R, b: R) => boolean);
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
