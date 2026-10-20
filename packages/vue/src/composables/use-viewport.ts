import { inject } from 'vue';
import type { Viewport } from '@fieldnotes/core';
import { ViewportKey } from '../context';

/** The Viewport from the nearest `<FieldNotesCanvas>`. Throws outside one. */
export function useViewport(): Viewport {
  const viewport = inject(ViewportKey, null);
  if (!viewport) {
    throw new Error('useViewport must be used inside <FieldNotesCanvas>');
  }
  return viewport;
}
