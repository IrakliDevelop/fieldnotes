import { useCallback, useMemo } from 'react';
import {
  exportImage as exportImageFn,
  exportPdf as exportPdfFn,
  exportSvg as exportSvgFn,
} from '@fieldnotes/core';
import type {
  CanvasState,
  ExportImageOptions,
  ExportPdfOptions,
  ExportSvgOptions,
} from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Export operations returned by useExport. */
export interface UseExportResult {
  exportState(): CanvasState;
  exportJSON(): string;
  exportImage(options?: ExportImageOptions): Promise<Blob | null>;
  exportSVG(options?: ExportSvgOptions): Promise<string>;
  exportPDF(options?: ExportPdfOptions): Promise<Blob | null>;
}

/** Viewport export functions with stable identities. */
export function useExport(): UseExportResult {
  const viewport = useViewport();
  const exportState = useCallback(() => viewport.exportState(), [viewport]);
  const exportJSON = useCallback(() => viewport.exportJSON(), [viewport]);
  const exportImage = useCallback(
    (options?: ExportImageOptions) => exportImageFn(viewport, options),
    [viewport],
  );
  const exportSVG = useCallback(
    (options?: ExportSvgOptions) => exportSvgFn(viewport, options),
    [viewport],
  );
  const exportPDF = useCallback(
    (options?: ExportPdfOptions) => exportPdfFn(viewport, options),
    [viewport],
  );
  return useMemo(
    () => ({ exportState, exportJSON, exportImage, exportSVG, exportPDF }),
    [exportState, exportJSON, exportImage, exportSVG, exportPDF],
  );
}
