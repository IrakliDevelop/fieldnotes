import { NgZone, effect, inject, isSignal, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import { ElementRectTracker } from '@fieldnotes/core';
import type { ElementRect, ElementRectMatch } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';

/**
 * World rects of the elements a host matcher selects, updating only when a
 * tracked field changes. Camera motion never updates: position content under
 * one camera transform and let the browser composite it. A `Signal` `match` is followed.
 */
export function injectElementRects(
  match: ElementRectMatch | Signal<ElementRectMatch>,
): Signal<readonly ElementRect[]> {
  const viewport = injectViewport();
  const zone = inject(NgZone);
  const rects = signal<readonly ElementRect[]>([]);
  const read = isSignal(match) ? match : () => match;
  let tracker: ElementRectTracker | undefined;
  let applied: ElementRectMatch | undefined;
  effect((onCleanup) => {
    const current = viewport();
    untracked(() => {
      if (!current) {
        rects.set([]);
        return;
      }
      const initial = read();
      applied = initial;
      const created = zone.runOutsideAngular(
        () => new ElementRectTracker(current, { match: initial }),
      );
      tracker = created;
      rects.set(created.getRects());
      created.onChange((next) => rects.set(next));
      onCleanup(() => created.dispose());
    });
  });
  if (isSignal(match)) {
    effect(() => {
      const next = match();
      untracked(() => {
        // setMatch forces a rescan, so skip the value the tracker was built with.
        if (next === applied) return;
        applied = next;
        tracker?.setMatch(next);
      });
    });
  }
  return rects.asReadonly();
}
