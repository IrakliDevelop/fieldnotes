import { inject } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from './context';

/** The enclosing `<fn-canvas>` viewport signal; `null` until it mounts. */
export function injectViewport(): Signal<Viewport | null> {
  const viewport = inject(FIELDNOTES_VIEWPORT, { optional: true });
  if (!viewport) throw new Error('injectViewport must be used inside <fn-canvas>');
  return viewport;
}
