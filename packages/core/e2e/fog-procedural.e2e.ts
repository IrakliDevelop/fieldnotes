import { test, expect } from './fixtures/canvas-page';

test.describe('procedural fog presentation', () => {
  test('keeps player coverage opaque, visibly varied, and clear in revealed cells', async ({
    canvasPage,
  }) => {
    const result = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        fog: {
          initialize: (options: {
            bounds: { x: number; y: number; w: number; h: number };
            base: 'covered';
            cellSize: number;
          }) => void;
          setViewMode: (mode: 'player') => void;
          applyRegion: (
            region: {
              kind: 'rectangle';
              from: { x: number; y: number };
              to: { x: number; y: number };
            },
            operation: 'reveal',
          ) => void;
          getState: () => unknown;
        };
        store: { clear: () => void };
        addShape: (options: Record<string, unknown>) => string;
        requestRender: () => void;
        exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
        exportSVG: (options: Record<string, unknown>) => Promise<string>;
      };

      const nextPaint = async (): Promise<void> => {
        vp.requestRender();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      };
      const fogCanvas = (): HTMLCanvasElement => {
        const canvases = [
          ...document.querySelectorAll<HTMLCanvasElement>(
            '[data-fieldnotes-paint-stack] canvas[data-paint-order]',
          ),
        ];
        const painted = canvases.find((canvas) => {
          const ctx = canvas.getContext('2d');
          return ctx ? ctx.getImageData(8, 8, 1, 1).data[3] === 255 : false;
        });
        if (!painted) throw new Error('procedural fog canvas not found');
        return painted;
      };
      const rasterColorCount = async (source: Blob): Promise<number> => {
        const url = URL.createObjectURL(source);
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('raster probe image could not be decoded'));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('raster probe context unavailable');
        ctx.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<string>();
        for (let y = 0; y < canvas.height; y += 8) {
          for (let x = 0; x < canvas.width; x += 8) {
            const i = (y * canvas.width + x) * 4;
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
          }
        }
        return colors.size;
      };

      vp.store.clear();
      vp.addShape({
        position: { x: 0, y: 0 },
        size: { w: 512, h: 512 },
        fillColor: '#dbeafe',
        strokeColor: '#dbeafe',
      });

      vp.fog.initialize({
        bounds: { x: 0, y: 0, w: 512, h: 512 },
        base: 'covered',
        cellSize: 4,
      });
      vp.fog.setViewMode('player');
      await nextPaint();

      const beforeCtx = fogCanvas().getContext('2d');
      if (!beforeCtx) throw new Error('fog context unavailable');
      const pixels = beforeCtx.getImageData(8, 8, 192, 192).data;
      let allOpaque = true;
      const colors = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) allOpaque = false;
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }

      vp.fog.applyRegion(
        { kind: 'rectangle', from: { x: 32, y: 32 }, to: { x: 96, y: 96 } },
        'reveal',
      );
      await nextPaint();

      const afterCtx = fogCanvas().getContext('2d');
      if (!afterCtx) throw new Error('fog context unavailable');
      const dpr = window.devicePixelRatio || 1;
      const revealedAlpha = afterCtx.getImageData(64 * dpr, 64 * dpr, 1, 1).data[3];
      const coveredAlpha = afterCtx.getImageData(160 * dpr, 160 * dpr, 1, 1).data[3];
      const fogState = vp.fog.getState();
      if (!fogState) throw new Error('fog state unavailable');
      const png = await vp.exportImage({
        scale: 1,
        region: { x: 0, y: 0, w: 256, h: 256 },
        fog: { state: fogState, mode: 'player' },
      });
      if (!png) throw new Error('PNG export unavailable');
      const exportColorCount = await rasterColorCount(png);

      const svg = await vp.exportSVG({ fog: { state: fogState, mode: 'player' } });
      const svgColorCount = await rasterColorCount(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      );

      const minimap = document.querySelector<HTMLCanvasElement>('[data-fieldnotes-minimap]');
      const minimapCtx = minimap?.getContext('2d');
      if (!minimap || !minimapCtx) throw new Error('minimap unavailable');
      const minimapPixels = minimapCtx.getImageData(0, 0, minimap.width, minimap.height).data;
      const minimapColors = new Set<string>();
      for (let i = 0; i < minimapPixels.length; i += 16) {
        minimapColors.add(`${minimapPixels[i]},${minimapPixels[i + 1]},${minimapPixels[i + 2]}`);
      }

      return {
        allOpaque,
        colorCount: colors.size,
        revealedAlpha,
        coveredAlpha,
        exportColorCount,
        svgColorCount,
        minimapColorCount: minimapColors.size,
      };
    });

    expect(result.allOpaque).toBe(true);
    expect(result.colorCount).toBeGreaterThan(8);
    expect(result.revealedAlpha).toBe(0);
    expect(result.coveredAlpha).toBe(255);
    expect(result.exportColorCount).toBeGreaterThan(8);
    expect(result.svgColorCount).toBeGreaterThan(8);
    // Minimap downscaling intentionally compresses the palette, but a solid fill
    // plus the scene/reveal colors produces at most four sampled colors here.
    expect(result.minimapColorCount).toBeGreaterThan(4);
  });
});
