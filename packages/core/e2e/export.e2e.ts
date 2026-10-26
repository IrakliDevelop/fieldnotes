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

  test('keeps nested clips consistent in the minimap, PNG, and SVG', async ({
    canvasPage,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'ipad', 'This verifies desktop export rendering.');
    const page = canvasPage.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        elementRegistry: { register(definition: Record<string, unknown>): void };
        store: {
          add(element: Record<string, unknown>): void;
          getById(id: string): { layerId: string };
          update(id: string, patch: Record<string, unknown>): void;
        };
        addHtmlElement(
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
          options?: { htmlType?: string },
        ): string;
        setParent(childId: string, parentId: string): void;
        registerHtmlPainter(
          type: string,
          painter: (context: {
            ctx: CanvasRenderingContext2D;
            size: { w: number; h: number };
          }) => void,
        ): () => void;
        requestRender(): void;
      };
      vp.elementRegistry.register({
        type: 'e2e:export-clip',
        legacyTypes: [],
        renderMode: 'canvas',
        validateData: () => true,
        decodeLegacy: (raw: unknown) => raw,
        unwrap: (element: Record<string, unknown>) => element,
        wrap: (element: Record<string, unknown>) => element,
        bounds: (element: { data: { bounds: { x: number; y: number; w: number; h: number } } }) =>
          element.data.bounds,
        clipBounds: (element: { data: { clip: { x: number; y: number; w: number; h: number } } }) =>
          element.data.clip,
        render: (
          context: CanvasRenderingContext2D,
          element: {
            data: { bounds: { x: number; y: number; w: number; h: number }; color: string };
          },
        ) => {
          const { bounds, color } = element.data;
          context.fillStyle = color;
          context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        },
        emitSvg: (element: {
          id: string;
          data: { bounds: { x: number; y: number; w: number; h: number }; color: string };
        }) => {
          const { bounds, color } = element.data;
          const collision = element.id === 'root' ? " id = 'fieldnotes-export-clip-0'" : '';
          return `<g${collision} data-clip-node="${element.id}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${color}" /></g>`;
        },
      });
      const canvasHtml = document.createElement('div');
      const canvasHtmlId = vp.addHtmlElement(
        canvasHtml,
        { x: 145, y: 105 },
        { w: 35, h: 35 },
        {
          htmlType: 'e2e:canvas-html',
        },
      );
      const domHtml = document.createElement('div');
      const domHtmlId = vp.addHtmlElement(domHtml, { x: 20, y: 135 }, { w: 70, h: 35 });
      const layerId = vp.store.getById(canvasHtmlId).layerId;
      vp.registerHtmlPainter('e2e:canvas-html', ({ ctx, size }) => {
        ctx.fillStyle = '#f57c00';
        ctx.fillRect(0, 0, size.w, size.h);
      });
      const extension = (
        id: string,
        index: string,
        color: string,
        clip: { x: number; y: number; w: number; h: number },
      ) => ({
        id,
        type: 'extension',
        extensionType: 'e2e:export-clip',
        position: { x: 0, y: 0 },
        index,
        version: 1,
        locked: false,
        layerId,
        data: { bounds: { x: 0, y: 0, w: 320, h: 300 }, clip, color },
      });
      vp.store.add(extension('root', 'a', '#e53935', { x: 40, y: 40, w: 220, h: 180 }));
      vp.store.add(extension('child', 'b', '#43a047', { x: 120, y: 80, w: 120, h: 100 }));
      vp.store.add({
        id: 'hostile id:/#?',
        type: 'shape',
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 320, h: 300 },
        strokeColor: '#1e88e5',
        fillColor: '#1e88e5',
        strokeWidth: 1,
        index: 'c',
        version: 1,
        locked: false,
        layerId,
      });
      vp.store.update(canvasHtmlId, { index: 'd' });
      vp.store.update(domHtmlId, { index: 'e' });
      vp.store.add({
        id: 'omitted',
        type: 'shape',
        shape: 'rectangle',
        position: { x: 400, y: 200 },
        size: { w: 200, h: 150 },
        strokeColor: '#7b1fa2',
        fillColor: '#7b1fa2',
        strokeWidth: 1,
        index: 'f',
        version: 1,
        locked: false,
        layerId,
      });
      vp.setParent('child', 'root');
      vp.setParent('hostile id:/#?', 'child');
      vp.setParent(canvasHtmlId, 'child');
      vp.setParent(domHtmlId, 'root');
      vp.setParent('omitted', 'child');
      vp.store.update('root', {
        data: {
          bounds: { x: 0, y: 0, w: 320, h: 300 },
          clip: { x: 40, y: 40, w: 220, h: 180 },
          color: '#e53935',
        },
      });
      vp.requestRender();
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
          return canvas instanceof HTMLCanvasElement && canvas.width > 0;
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const context = canvas.getContext('2d');
          if (!context) return false;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          return pixels.some(
            (value, index) => index % 4 === 0 && value > 150 && (pixels[index + 1] ?? 0) < 110,
          );
        }),
      )
      .toBe(true);
    const result = await page.evaluate(async () => {
      type Pixel = [number, number, number, number];
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        getVisibleRect(): { x: number; y: number; w: number; h: number };
        exportImage(options: {
          scale: number;
          background: string;
          renderHtml: (element: { id: string }) => HTMLCanvasElement;
        }): Promise<Blob | null>;
        exportSVG(options: {
          background: string;
          renderHtml: (element: { id: string }) => HTMLCanvasElement;
        }): Promise<string>;
        renderHooks: {
          svgExport: {
            register(hooks: {
              afterElements(mapping: { appendSvg(fragment: string): void }): void;
            }): () => void;
          };
        };
      };
      const paint = (color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 70;
        canvas.height = 35;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2d context unavailable');
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
      };
      const readBlob = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2d context unavailable');
        context.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          pixel: (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data] as Pixel,
        };
      };
      const image = await vp.exportImage({
        scale: 1,
        background: '#fff',
        renderHtml: (element) => paint(element.id === 'hostile id:/#?' ? '#000000' : '#8e24aa'),
      });
      if (!image) throw new Error('PNG export missing');
      const png = await readBlob(image);
      const release = vp.renderHooks.svgExport.register({
        afterElements: ({ appendSvg }) =>
          appendSvg("<g\t id = 'fieldnotes-export-clip-1-1' data-hook='temporary' />"),
      });
      const svg = await (async () => {
        try {
          return await vp.exportSVG({
            background: '#fff',
            renderHtml: () => paint('#8e24aa'),
          });
        } finally {
          release();
        }
      })();
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const images = [...doc.querySelectorAll('image')];
      const imageInfo = await Promise.all(
        images.map(async (image) => {
          const href = image.getAttribute('href');
          if (!href) throw new Error('Embedded HTML image has no href');
          const source = new Image();
          source.src = href;
          await source.decode();
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('2d context unavailable');
          context.drawImage(source, 0, 0);
          return {
            x: image.getAttribute('x'),
            y: image.getAttribute('y'),
            width: image.getAttribute('width'),
            height: image.getAttribute('height'),
            wrapper: image.parentElement?.getAttribute('clip-path') ?? null,
            pixel: [
              ...context.getImageData(
                Math.floor(canvas.width / 2),
                Math.floor(canvas.height / 2),
                1,
                1,
              ).data,
            ] as Pixel,
          };
        }),
      );
      const clips = [...doc.querySelectorAll('clipPath')].map((clip) => {
        const rect = clip.querySelector('rect');
        return {
          id: clip.id,
          rect: [
            rect?.getAttribute('x'),
            rect?.getAttribute('y'),
            rect?.getAttribute('width'),
            rect?.getAttribute('height'),
          ],
        };
      });
      const minimap = document.querySelector('canvas[data-fieldnotes-minimap]');
      if (!(minimap instanceof HTMLCanvasElement)) throw new Error('minimap missing');
      const minimapContext = minimap.getContext('2d');
      if (!minimapContext) throw new Error('minimap context unavailable');
      const visible = vp.getVisibleRect();
      const raw = { x: 0, y: 0, w: 600, h: 350 };
      const x = Math.min(raw.x, visible.x);
      const y = Math.min(raw.y, visible.y);
      const right = Math.max(raw.x + raw.w, visible.x + visible.w);
      const bottom = Math.max(raw.y + raw.h, visible.y + visible.h);
      const dpr = window.devicePixelRatio;
      const cssWidth = minimap.width / dpr;
      const cssHeight = minimap.height / dpr;
      const scale = Math.min((cssWidth - 16) / (right - x), (cssHeight - 16) / (bottom - y));
      const offsetX = (cssWidth - (right - x) * scale) / 2 - x * scale;
      const offsetY = (cssHeight - (bottom - y) * scale) / 2 - y * scale;
      const miniPixel = (worldX: number, worldY: number) => {
        const sampleX = Math.round((worldX * scale + offsetX) * dpr);
        const sampleY = Math.round((worldY * scale + offsetY) * dpr);
        return [...minimapContext.getImageData(sampleX, sampleY, 1, 1).data] as Pixel;
      };
      return {
        png: {
          width: png.width,
          height: png.height,
          root: png.pixel(20, 20),
          child: png.pixel(80, 60),
          grandchild: png.pixel(130, 90),
          canvasHtml: png.pixel(155, 115),
          domHtml: png.pixel(60, 150),
          domOutside: png.pixel(30, 150),
          omitted: png.pixel(500, 250),
        },
        minimap: {
          root: miniPixel(20, 20),
          child: miniPixel(80, 60),
          grandchild: miniPixel(130, 90),
          canvasHtml: miniPixel(155, 115),
          omitted: miniPixel(500, 250),
        },
        svg: {
          width: doc.documentElement.getAttribute('width'),
          height: doc.documentElement.getAttribute('height'),
          viewBox: doc.documentElement.getAttribute('viewBox'),
          ids: [...doc.querySelectorAll('[id]')].map((element) => element.id),
          clips,
          images: imageInfo,
          rootWrapper:
            doc
              .querySelector('[data-clip-node="root"]')
              ?.parentElement?.getAttribute('clip-path') ?? null,
          childWrapper:
            doc
              .querySelector('[data-clip-node="child"]')
              ?.parentElement?.getAttribute('clip-path') ?? null,
          grandchildWrapper:
            doc.querySelector('rect[fill="#1e88e5"]')?.parentElement?.getAttribute('clip-path') ??
            null,
          omitted:
            doc.querySelector('[id="omitted"]') !== null ||
            doc.querySelector('rect[fill="#7b1fa2"]') !== null,
          hookWrapper:
            doc
              .querySelector('[data-hook="temporary"]')
              ?.parentElement?.getAttribute('clip-path') ?? null,
        },
      };
    });
    const dominant = (pixel: readonly number[], channel: 0 | 1 | 2) =>
      (pixel[channel] ?? 0) > 130 &&
      (pixel[channel] ?? 0) > (pixel[(channel + 1) % 3] ?? 0) + 50 &&
      (pixel[channel] ?? 0) > (pixel[(channel + 2) % 3] ?? 0) + 50;
    const close = (pixel: readonly number[], expected: readonly number[]) =>
      pixel.every((value, index) => Math.abs(value - (expected[index] ?? 0)) < 8);
    const white = (pixel: readonly number[]) =>
      pixel.every((value, index) => index === 3 || value > 230);
    expect(result.png.width).toBe(600);
    expect(result.png.height).toBe(350);
    expect(dominant(result.png.root, 0)).toBe(true);
    expect(dominant(result.png.child, 1)).toBe(true);
    expect(dominant(result.png.grandchild, 2)).toBe(true);
    expect(dominant(result.png.canvasHtml, 0)).toBe(true);
    expect(result.png.domHtml).toEqual([142, 36, 170, 255]);
    expect(dominant(result.png.domOutside, 0)).toBe(true);
    expect(white(result.png.omitted)).toBe(true);
    expect(dominant(result.minimap.root, 0)).toBe(true);
    expect(dominant(result.minimap.child, 1)).toBe(true);
    expect(dominant(result.minimap.grandchild, 2)).toBe(true);
    expect(dominant(result.minimap.canvasHtml, 0)).toBe(true);
    expect(dominant(result.minimap.omitted, 2)).toBe(false);
    expect(result.svg.width).toBe('600');
    expect(result.svg.height).toBe('350');
    expect(result.svg.viewBox).toBe('0 0 600 350');
    expect(result.svg.ids).toEqual(
      expect.arrayContaining([
        'fieldnotes-export-clip-0',
        'fieldnotes-export-clip-1-1',
        'fieldnotes-export-clip-2-0',
      ]),
    );
    expect(new Set(result.svg.ids).size).toBe(result.svg.ids.length);
    expect(result.svg.ids.every((id) => !id.includes('hostile id:/#?'))).toBe(true);
    expect(result.svg.rootWrapper).toBeNull();
    expect(result.svg.childWrapper).toBe('url(#fieldnotes-export-clip-2-0)');
    expect(result.svg.grandchildWrapper).toBe('url(#fieldnotes-export-clip-2-1)');
    expect(result.svg.clips.map((clip) => clip.rect)).toEqual([
      ['40', '40', '220', '180'],
      ['120', '80', '120', '100'],
      ['120', '80', '120', '100'],
      ['40', '40', '220', '180'],
    ]);
    expect(result.svg.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          x: '145',
          y: '105',
          width: '35',
          height: '35',
          wrapper: 'url(#fieldnotes-export-clip-2-2)',
        }),
        expect.objectContaining({
          x: '20',
          y: '135',
          width: '70',
          height: '35',
          wrapper: 'url(#fieldnotes-export-clip-2-3)',
        }),
      ]),
    );
    const canvasImage = result.svg.images.find((image) => image.x === '145');
    const domImage = result.svg.images.find((image) => image.x === '20');
    expect(close(canvasImage?.pixel ?? [], [245, 124, 0, 255])).toBe(true);
    expect(close(domImage?.pixel ?? [], [142, 36, 170, 255])).toBe(true);
    expect(result.svg.omitted).toBe(false);
    expect(result.svg.hookWrapper).toBeNull();
    expect(errors).toEqual([]);
  });
});
