import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createShape } from '@fieldnotes/core';
import type { ReactNode } from 'react';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useExport } from './use-export';

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
    const exportSVG = vi.spyOn(viewport, 'exportSVG');
    const exportPDF = vi.spyOn(viewport, 'exportPDF').mockResolvedValue(null);
    const { result, rerender } = renderHook(useExport, { wrapper });

    expect(result.current.exportState().elements).toHaveLength(1);
    expect(JSON.parse(result.current.exportJSON()).elements[0].id).toBe('shape-a');
    expect(result.current.exportImage).toEqual(expect.any(Function));
    expect(result.current.exportSVG).toEqual(expect.any(Function));
    expect(result.current.exportPDF).toEqual(expect.any(Function));
    result.current.exportSVG({ padding: 3 });
    expect(exportSVG).toHaveBeenCalledWith({ padding: 3 });
    void result.current.exportPDF({ frameIds: ['f'] });
    expect(exportPDF).toHaveBeenCalledWith({ frameIds: ['f'] });

    const exportImage = result.current.exportImage;
    const exportPdf = result.current.exportPDF;
    rerender();
    expect(result.current.exportImage).toBe(exportImage);
    expect(result.current.exportPDF).toBe(exportPdf);
  });
});
