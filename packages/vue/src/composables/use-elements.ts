import { unref } from 'vue';
import type { MaybeRef, ShallowRef } from 'vue';
import { createElementsSelectorSource, createElementsSource } from '@fieldnotes/core';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** Elements of one type; a ref type is followed. Updates on every store mutation. */
export function useElements<T extends ElementType>(
  type: MaybeRef<T>,
): Readonly<ShallowRef<Extract<CanvasElement, { type: T }>[]>>;
/**
 * All elements, or those of the type a ref holds (followed); updates on every store mutation
 * (use a selector for hot paths).
 */
export function useElements(
  type?: MaybeRef<ElementType | undefined>,
): Readonly<ShallowRef<CanvasElement[]>>;
/**
 * Derived value; updates only when the selected value changes (per `isEqual`,
 * default: one-level shallow compare — arrays by index, plain objects by key, primitives by
 * Object.is). Supply `isEqual` for deeper structures: selectors returning nested fresh objects
 * still need a custom comparator because the default only compares one level deep.
 */
export function useElements<R>(
  selector: (elements: CanvasElement[]) => R,
  isEqual?: (a: R, b: R) => boolean,
): Readonly<ShallowRef<R>>;
export function useElements<R>(
  arg?: MaybeRef<ElementType | undefined> | ((elements: CanvasElement[]) => R),
  isEqual?: (a: R, b: R) => boolean,
): Readonly<ShallowRef<CanvasElement[] | R>> {
  const viewport = useViewport();
  if (typeof arg === 'function') {
    return useSource(
      createElementsSelectorSource(
        viewport,
        () => arg,
        () => isEqual,
      ),
    );
  }
  const type = () => unref(arg);
  return useSource(createElementsSource(viewport, type), type);
}
