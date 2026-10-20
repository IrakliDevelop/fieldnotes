import { readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { ElementRectTracker } from '@fieldnotes/core';
import type { ElementRect, ElementRectMatch } from '@fieldnotes/core';
import { useViewport } from '../context.js';

/**
 * World rects of the elements a host matcher selects, updating only when a
 * tracked field changes. Camera motion never updates: position content under
 * one camera transform and let the browser composite it. `match` is fixed at init.
 */
export function useElementRects(match: ElementRectMatch): Readable<readonly ElementRect[]> {
  const viewport = useViewport();
  return readable<readonly ElementRect[]>([], (set) => {
    const tracker = new ElementRectTracker(viewport, { match });
    set(tracker.getRects());
    tracker.onChange(set);
    return () => tracker.dispose();
  });
}
