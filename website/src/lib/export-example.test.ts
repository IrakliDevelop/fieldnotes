import { createFrame, exportPdf as exportPdfBlob, type Viewport } from '@fieldnotes/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Core from '@fieldnotes/core';
import { exportPdf } from '../examples/export';

vi.mock('@fieldnotes/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  exportPdf: vi.fn(async () => null),
}));

type PdfViewport = Pick<Viewport, 'exportDefaults'> & {
  store: Pick<Viewport['store'], 'getAll'>;
};

function pdfViewport(elements: ReturnType<Viewport['store']['getAll']>): PdfViewport {
  return {
    store: { getAll: () => elements },
    exportDefaults: () => {
      throw new Error('exportPdf is mocked');
    },
  };
}

describe('exportPdf', () => {
  beforeEach(() => vi.mocked(exportPdfBlob).mockClear());

  it('exports only root frames', async () => {
    const root = createFrame({ position: { x: 0, y: 0 }, size: { w: 120, h: 90 } });
    const nested = {
      ...createFrame({ position: { x: 10, y: 10 }, size: { w: 100, h: 80 } }),
      parentId: root.id,
    };
    const viewport = pdfViewport([root, nested]);

    await exportPdf(viewport);

    expect(exportPdfBlob).toHaveBeenCalledWith(viewport, { frameIds: [root.id], pageSize: 'a4' });
  });

  it('exports the board without frameIds when no frames exist', async () => {
    const viewport = pdfViewport([]);

    await exportPdf(viewport);

    expect(exportPdfBlob).toHaveBeenCalledWith(viewport, { pageSize: 'a4' });
    expect(vi.mocked(exportPdfBlob).mock.calls[0]?.[1]).not.toHaveProperty('frameIds');
  });
});
