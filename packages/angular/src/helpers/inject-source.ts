import { NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Viewport, ViewportSource } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';

/**
 * A signal mirroring the source `create` builds for the current viewport; `fallback` without one.
 * It holds the fallback until the consumer's first change detection.
 */
export function injectSource<T>(
  create: (viewport: Viewport) => ViewportSource<T>,
  fallback: T,
  input?: () => unknown,
): Signal<T> {
  const viewport = injectViewport();
  const zone = inject(NgZone);
  const value = signal(fallback);
  // One source per viewport: core caches survive input changes, which only resubscribe.
  const source = computed(() => {
    const current = viewport();
    return current ? untracked(() => create(current)) : null;
  });
  effect((onCleanup) => {
    const current = source();
    input?.();
    untracked(() => {
      if (!current) {
        value.set(fallback);
        return;
      }
      // getSnapshot keeps the previous reference when nothing changed, so the signal skips no-op writes.
      const read = () => value.set(current.getSnapshot());
      read();
      onCleanup(zone.runOutsideAngular(() => current.subscribe(read)));
    });
  });
  return value.asReadonly();
}

/** The mounted viewport, or a named error for an action called before `<fn-canvas>` mounted. */
export function requireViewport(viewport: Signal<Viewport | null>, name: string): Viewport {
  const current = viewport();
  if (!current) throw new Error(`[fieldnotes] ${name} called before <fn-canvas> mounted`);
  return current;
}
