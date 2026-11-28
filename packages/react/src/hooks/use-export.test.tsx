import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createShape, exportPdf as exportPdfFn, exportSvg as exportSvgFn } from '@fieldnotes/core';
import type { ReactNode } from 'react';
import type * as Core from '@fieldnotes/core';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useExport } from './use-export';

vi.mock('@fieldnotes/core', async (importOriginal) => {
  const core = await importOriginal<typeof Core>();
  return { ...core, exportSvg: vi.fn(core.exportSvg), exportPdf: vi.fn(async () => null) };
});

describe('useExport', () => {
  afterEach(destroyTestViewports);

  it('exports the viewport state and keeps bound callbacks stable', () => {
    const viewport = createTestViewport();
    const shape = {
      ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 } }),
      id: 'shape-a',
    };
    viewport.store.add(shape);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result, rerender } = renderHook(useExport, { wrapper });

    expect(result.current.exportState().elements).toHaveLength(1);
    expect(JSON.parse(result.current.exportJSON()).elements[0].id).toBe('shape-a');
    expect(result.current.exportImage).toEqual(expect.any(Function));
    expect(result.current.exportSVG).toEqual(expect.any(Function));
    expect(result.current.exportPDF).toEqual(expect.any(Function));
    result.current.exportSVG({ padding: 3 });
    expect(exportSvgFn).toHaveBeenCalledWith(viewport, { padding: 3 });
    void result.current.exportPDF({ frameIds: ['f'] });
    expect(exportPdfFn).toHaveBeenCalledWith(viewport, { frameIds: ['f'] });

    const exportImage = result.current.exportImage;
    const exportPdf = result.current.exportPDF;
    rerender();
    expect(result.current.exportImage).toBe(exportImage);
    expect(result.current.exportPDF).toBe(exportPdf);
  });
});
