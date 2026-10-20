import type { Readable } from 'svelte/store';
import { createElementsSelectorSource, createElementsSource } from '@fieldnotes/core';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** All elements; updates on every store mutation (use a selector for hot paths). */
export function useElements(): Readable<CanvasElement[]>;
/** Elements of one type; updates on every store mutation. */
export function useElements<T extends ElementType>(
  type: T,
): Readable<Extract<CanvasElement, { type: T }>[]>;
/**
 * Derived value; updates only when the selected value changes (per `isEqual`,
 * default: one-level shallow compare — arrays by index, plain objects by key, primitives by
 * Object.is). Supply `isEqual` for deeper structures: selectors returning nested fresh objects
 * still need a custom comparator because the default only compares one level deep.
 */
export function useElements<R>(
  selector: (elements: CanvasElement[]) => R,
  isEqual?: (a: R, b: R) => boolean,
): Readable<R>;
export function useElements<R>(
  arg?: ElementType | ((elements: CanvasElement[]) => R),
  isEqual?: (a: R, b: R) => boolean,
): Readable<CanvasElement[] | R> {
  const viewport = useViewport();
  if (typeof arg === 'function') {
    return fromSource(
      createElementsSelectorSource(
        viewport,
        () => arg,
        () => isEqual,
      ),
    );
  }
  return fromSource(createElementsSource(viewport, () => arg));
}
