import { NgZone, effect, inject, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Viewport, ViewportSource } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';

/** A signal mirroring the source `create` builds for the current viewport; `fallback` without one. */
export function injectSource<T>(
  create: (viewport: Viewport) => ViewportSource<T>,
  fallback: T,
  input?: () => unknown,
): Signal<T> {
  const viewport = injectViewport();
  const zone = inject(NgZone);
  const value = signal(fallback);
  effect((onCleanup) => {
    const current = viewport();
    input?.();
    untracked(() => {
      if (!current) {
        value.set(fallback);
        return;
      }
      const source = create(current);
      // getSnapshot keeps the previous reference when nothing changed, so the signal skips no-op writes.
      const read = () => value.set(source.getSnapshot());
      read();
      onCleanup(zone.runOutsideAngular(() => source.subscribe(read)));
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
