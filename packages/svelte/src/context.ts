import { getContext, setContext } from 'svelte';
import type { Viewport } from '@fieldnotes/core';

const key = Symbol('fieldnotes.viewport');

/** Provides `viewport` to descendants' `useViewport()`; call during component init. */
export function setViewportContext(viewport: Viewport): void {
  setContext(key, viewport);
}

/** The Viewport from the nearest `<FieldNotesCanvas>`. Throws outside one. */
export function useViewport(): Viewport {
  const viewport = getContext<Viewport | undefined>(key);
  if (!viewport) {
    throw new Error('useViewport must be used inside <FieldNotesCanvas>');
  }
  return viewport;
}
