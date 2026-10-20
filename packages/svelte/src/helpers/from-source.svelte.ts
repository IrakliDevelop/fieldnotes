import { readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { ViewportSource } from '@fieldnotes/core';

/** A store over `source`, live while subscribed; each `input` value resubscribes the source. */
export function fromSource<T>(
  source: ViewportSource<T>,
  input: Readable<unknown> = readable(null),
): Readable<T> {
  let current = source.getSnapshot();
  return readable(current, (set) => {
    // Svelte's store equality treats every object as changed, so compare references here.
    const update = () => {
      const next = source.getSnapshot();
      if (next === current) return;
      current = next;
      set(next);
    };
    let off: (() => void) | undefined;
    const offInput = input.subscribe(() => {
      off?.();
      off = source.subscribe(update);
      update();
    });
    return () => {
      offInput();
      off?.();
    };
  });
}
