import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { ElementRectTracker, computeElementRects, elementRectsEqual } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

import type { CanvasElement, ElementRect, ElementRectMatch } from '@fieldnotes/core';

/**
 * World rects of the elements a host matcher selects, re-rendering only when a
 * tracked field changes. Camera motion never re-renders: position content under
 * one camera transform and let the browser composite it.
 *
 * `match` may be an inline arrow — it is read through a ref, so it never
 * re-subscribes; a semantic change is picked up via `setMatch`.
 */
export function useElementRects(match: ElementRectMatch): readonly ElementRect[] {
  const viewport = useViewport();

  const matchRef = useRef<ElementRectMatch>(match);
  matchRef.current = match;
  const stableMatch = useCallback((el: CanvasElement) => matchRef.current(el), []);

  const cacheRef = useRef<readonly ElementRect[] | null>(null);
  const trackerRef = useRef<ElementRectTracker | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Constructed HERE, not in a memo: Strict Mode rehearses
      // setup -> cleanup -> setup without re-creating memoized state, so a
      // memo-created tracker disposed by the first cleanup would be reused
      // already disposed and would never emit again.
      const tracker = new ElementRectTracker(viewport, { match: stableMatch });
      trackerRef.current = tracker;

      const next = tracker.getRects();
      const previous = cacheRef.current;
      if (previous === null || !elementRectsEqual(previous, next)) {
        cacheRef.current = next;
        onStoreChange();
      }

      const off = tracker.onChange((rects) => {
        cacheRef.current = rects;
        onStoreChange();
      });

      return () => {
        off();
        tracker.dispose();
        if (trackerRef.current === tracker) trackerRef.current = null;
      };
    },
    [viewport, stableMatch],
  );

  const getSnapshot = useCallback((): readonly ElementRect[] => {
    if (cacheRef.current === null) {
      cacheRef.current = computeElementRects(viewport.store, stableMatch);
    }
    return cacheRef.current;
  }, [viewport, stableMatch]);

  const rects = useSyncExternalStore(subscribe, getSnapshot);

  // `stableMatch` never changes identity while its behavior does, so the
  // tracker needs an explicit nudge whenever the caller's matcher changes.
  useEffect(() => {
    trackerRef.current?.setMatch(stableMatch);
  }, [match, stableMatch]);

  return rects;
}
