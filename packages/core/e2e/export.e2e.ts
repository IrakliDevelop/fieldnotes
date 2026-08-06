import { test, expect } from './fixtures/canvas-page';

test.describe('export', () => {
  test('exports non-null image blob after drawing', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;
    await canvasPage.page.mouse.move(cx - 50, cy - 50);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 50, cy + 50, { steps: 5 });
    await canvasPage.page.mouse.up();

    const hasBlob = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        exportImage: () => Promise<Blob | null>;
      };
      const blob = await vp.exportImage();
      return blob !== null && blob.size > 0;
    });
    expect(hasBlob).toBe(true);
  });

  test('rasterizes an HTML embed through the export hook', async ({ canvasPage }) => {
    const pixel = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
      };
      const dom = document.createElement('div');
      vp.addHtmlElement(dom, { x: 0, y: 0 }, { w: 20, h: 20 });
      const blob = await vp.exportImage({
        scale: 1,
        renderHtml: () => {
          const source = document.createElement('canvas');
          source.width = 20;
          source.height = 20;
          const sourceCtx = source.getContext('2d');
          if (!sourceCtx) return null;
          sourceCtx.fillStyle = '#ff0000';
          sourceCtx.fillRect(0, 0, 20, 20);
          return source;
        },
      });
      if (!blob) return null;

      const bitmap = await createImageBitmap(blob);
      const sample = document.createElement('canvas');
      sample.width = bitmap.width;
      sample.height = bitmap.height;
      const sampleCtx = sample.getContext('2d');
      if (!sampleCtx) return null;
      sampleCtx.drawImage(bitmap, 0, 0);
      return [...sampleCtx.getImageData(10, 10, 1, 1).data];
    });

    expect(pixel).toEqual([255, 0, 0, 255]);
  });

  test('crops to a world-space region', async ({ canvasPage }) => {
    const result = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
      };
      const insideId = vp.addHtmlElement(
        document.createElement('div'),
        { x: 0, y: 0 },
        { w: 20, h: 20 },
      );
      vp.addHtmlElement(document.createElement('div'), { x: 100, y: 0 }, { w: 20, h: 20 });
      const paint = (color: string) => {
        const c = document.createElement('canvas');
        c.width = 20;
        c.height = 20;
        const cx = c.getContext('2d');
        if (!cx) return null;
        cx.fillStyle = color;
        cx.fillRect(0, 0, 20, 20);
        return c;
      };
      const blob = await vp.exportImage({
        scale: 1,
        region: { x: 0, y: 0, w: 40, h: 40 },
        renderHtml: (el: { id: string }) => paint(el.id === insideId ? '#ff0000' : '#0000ff'),
      });
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      const sample = document.createElement('canvas');
      sample.width = bitmap.width;
      sample.height = bitmap.height;
      const sampleCtx = sample.getContext('2d');
      if (!sampleCtx) return null;
      sampleCtx.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        inside: [...sampleCtx.getImageData(10, 10, 1, 1).data],
        outside: [...sampleCtx.getImageData(35, 10, 1, 1).data],
      };
    });
    expect(result).not.toBeNull();
    expect(result?.width).toBe(40);
    expect(result?.height).toBe(40);
    expect(result?.inside).toEqual([255, 0, 0, 255]);
    expect(result?.outside).toEqual([255, 255, 255, 255]); // background — the blue element at x:100 is cropped out
  });

  test('encodes jpeg when requested', async ({ canvasPage }) => {
    const type = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
      };
      vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, { w: 20, h: 20 });
      const blob = await vp.exportImage({ scale: 1, format: 'jpeg', quality: 0.9 });
      return blob?.type ?? null;
    });
    expect(type).toBe('image/jpeg');
  });

  test('fit scale mode keeps a huge export under the caps', async ({ canvasPage }) => {
    const dims = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
      };
      vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, { w: 3000, h: 1000 });
      const blob = await vp.exportImage({ scale: 4, scaleMode: 'fit', maxDimension: 2000 });
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      return { w: bitmap.width, h: bitmap.height };
    });
    expect(dims).not.toBeNull();
    expect(dims && dims.w).toBeLessThanOrEqual(2000);
    expect(dims && dims.h).toBeLessThanOrEqual(2000);
    expect(dims && dims.w).toBeGreaterThan(1900);
  });
});
