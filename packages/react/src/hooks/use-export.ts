import { useCallback, useMemo } from 'react';
import type { CanvasState, ExportImageOptions, ExportSvgOptions } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Export operations returned by useExport. */
export interface UseExportResult {
  exportState(): CanvasState;
  exportJSON(): string;
  exportImage(options?: ExportImageOptions): Promise<Blob | null>;
  exportSVG(options?: ExportSvgOptions): Promise<string>;
}

/** Viewport export functions with stable identities. */
export function useExport(): UseExportResult {
  const viewport = useViewport();
  const exportState = useCallback(() => viewport.exportState(), [viewport]);
  const exportJSON = useCallback(() => viewport.exportJSON(), [viewport]);
  const exportImage = useCallback(
    (options?: ExportImageOptions) => viewport.exportImage(options),
    [viewport],
  );
  const exportSVG = useCallback(
    (options?: ExportSvgOptions) => viewport.exportSVG(options),
    [viewport],
  );
  return useMemo(
    () => ({ exportState, exportJSON, exportImage, exportSVG }),
    [exportState, exportJSON, exportImage, exportSVG],
  );
}
