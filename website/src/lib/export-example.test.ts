import { createFrame, type ExportPdfOptions, type Viewport } from '@fieldnotes/core';
import { describe, expect, it, vi } from 'vitest';
import { exportPdf } from '../examples/export';

type PdfViewport = Pick<Viewport, 'exportPDF'> & {
  store: Pick<Viewport['store'], 'getAll'>;
};

function pdfViewport(elements: ReturnType<Viewport['store']['getAll']>) {
  const exportPDF = vi.fn(async (_options?: ExportPdfOptions) => null);
  const viewport: PdfViewport = {
    store: { getAll: () => elements },
    exportPDF,
  };
  return { exportPDF, viewport };
}

describe('exportPdf', () => {
  it('exports only root frames', async () => {
    const root = createFrame({ position: { x: 0, y: 0 }, size: { w: 120, h: 90 } });
    const nested = {
      ...createFrame({ position: { x: 10, y: 10 }, size: { w: 100, h: 80 } }),
      parentId: root.id,
    };
    const { exportPDF, viewport } = pdfViewport([root, nested]);

    await exportPdf(viewport);

    expect(exportPDF).toHaveBeenCalledWith({ frameIds: [root.id], pageSize: 'a4' });
  });

  it('exports the board without frameIds when no frames exist', async () => {
    const { exportPDF, viewport } = pdfViewport([]);

    await exportPdf(viewport);

    expect(exportPDF).toHaveBeenCalledWith({ pageSize: 'a4' });
    expect(exportPDF.mock.calls[0]?.[0]).not.toHaveProperty('frameIds');
  });
});
