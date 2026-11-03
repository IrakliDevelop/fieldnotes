import { useMemo, useSyncExternalStore } from 'react';
import { createCanvasSizeSource } from '@fieldnotes/core';
import type { CanvasSize } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

const SERVER_SIZE: CanvasSize = Object.freeze({ w: 0, h: 0 });

/** Canvas dimensions in CSS pixels. */
export function useCanvasSize(): CanvasSize {
  const viewport = useViewport();
  const source = useMemo(() => createCanvasSizeSource(viewport), [viewport]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, () => SERVER_SIZE);
}
