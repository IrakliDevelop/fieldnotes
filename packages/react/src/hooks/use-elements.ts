import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createElementsSelectorSource, createElementsSource } from '@fieldnotes/core';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

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
  const latest = useRef({ arg, isEqual });
  latest.current = { arg, isEqual };

  const elementsSource = useMemo(
    () =>
      createElementsSource(viewport, () => {
        const a = latest.current.arg;
        return typeof a === 'function' ? undefined : a;
      }),
    [viewport],
  );
  const selectorSource = useMemo(
    () =>
      createElementsSelectorSource(
        viewport,
        // Only read while `arg` is a selector: the source is picked below by `typeof arg`.
        () => latest.current.arg as (elements: CanvasElement[]) => R,
        () => latest.current.isEqual,
      ),
    [viewport],
  );

  const source = typeof arg === 'function' ? selectorSource : elementsSource;
  return useSyncExternalStore<CanvasElement[] | R>(source.subscribe, source.getSnapshot);
}
