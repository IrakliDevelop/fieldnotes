import { onScopeDispose, shallowRef, unref, watch } from 'vue';
import type { MaybeRef, ShallowRef } from 'vue';
import { ElementRectTracker } from '@fieldnotes/core';
import type { ElementRect, ElementRectMatch } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/**
 * World rects of the elements a host matcher selects, updating only when a
 * tracked field changes. Camera motion never updates: position content under
 * one camera transform and let the browser composite it. A ref `match` is followed.
 */
export function useElementRects(
  match: MaybeRef<ElementRectMatch>,
): Readonly<ShallowRef<readonly ElementRect[]>> {
  const tracker = new ElementRectTracker(useViewport(), { match: unref(match) });
  const rects = shallowRef(tracker.getRects());
  tracker.onChange((next) => {
    rects.value = next;
  });
  watch(
    () => unref(match),
    (next) => tracker.setMatch(next),
  );
  onScopeDispose(() => tracker.dispose());
  return rects;
}
