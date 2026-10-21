import { isSignal } from '@angular/core';
import type { Signal } from '@angular/core';
import { createElementsSelectorSource, createElementsSource } from '@fieldnotes/core';
import type { CanvasElement, ElementType } from '@fieldnotes/core';
import { injectSource } from './inject-source';

/** Elements of one type; a `Signal` type is followed. Updates on every store mutation. */
export function injectElements<T extends ElementType>(
  type: T | Signal<T>,
): Signal<Extract<CanvasElement, { type: T }>[]>;
/**
 * All elements, or those of the type a `Signal` holds (followed); updates on every store mutation
 * (use a selector for hot paths).
 */
export function injectElements(
  type?: ElementType | Signal<ElementType | undefined>,
): Signal<CanvasElement[]>;
/**
 * Derived value; updates only when the selected value changes (per `isEqual`,
 * default: one-level shallow compare — arrays by index, plain objects by key, primitives by
 * Object.is). Supply `isEqual` for deeper structures: selectors returning nested fresh objects
 * still need a custom comparator because the default only compares one level deep.
 */
export function injectElements<R>(
  selector: (elements: CanvasElement[]) => R,
  isEqual?: (a: R, b: R) => boolean,
): Signal<R>;
export function injectElements<R>(
  arg?: ElementType | Signal<ElementType | undefined> | ((elements: CanvasElement[]) => R),
  isEqual?: (a: R, b: R) => boolean,
): Signal<CanvasElement[] | R> {
  if (isSignal(arg)) return injectSource((vp) => createElementsSource(vp, arg), [], arg);
  if (typeof arg === 'function') {
    return injectSource(
      (vp) =>
        createElementsSelectorSource(
          vp,
          () => arg,
          () => isEqual,
        ),
      arg([]),
    );
  }
  return injectSource((vp) => createElementsSource(vp, () => arg), []);
}
