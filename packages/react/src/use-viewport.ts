import { useContext } from 'react';
import type { Viewport } from '@fieldnotes/core';
import { ViewportContext } from './context';

export function useViewport(): Viewport {
  const viewport = useContext(ViewportContext);
  if (!viewport) {
    throw new Error('useViewport must be used inside <FieldNotesCanvas>');
  }
  return viewport;
}
