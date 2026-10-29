import { test, expect, CanvasPage } from './fixtures/canvas-page';
import { singleFingerDraw, twoFingerTakeover } from './helpers/touch';

interface FrameState {
  count: number;
  undoCount: number;
  selectedIds: string[];
  activeTool: string | undefined;
  frames: { size: { w: number; h: number } }[];
}

async function openCanvas(page: Parameters<typeof CanvasPage>[0]) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const canvasPage = new CanvasPage(page);
  await canvasPage.goto();
  return { canvasPage, errors };
}

async function state(page: Parameters<typeof CanvasPage>[0]): Promise<FrameState> {
  return page.evaluate(() => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { count: number; getElementsByType: (type: string) => FrameState['frames'] };
      history: { undoCount: number };
      getSelectedIds: () => string[];
      toolManager: { activeTool: { name: string } | null };
    };
    return {
      count: viewport.store.count,
      undoCount: viewport.history.undoCount,
      selectedIds: viewport.getSelectedIds(),
      activeTool: viewport.toolManager.activeTool?.name,
      frames: viewport.store.getElementsByType('extension'),
    };
  });
}

test.describe('frame tool', () => {
  test('desktop toolbar, F, creation, square, click, undo, and interruptions', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop mouse coverage');
    const { canvasPage, errors } = await openCanvas(page);
    await canvasPage.selectTool('frame');
    expect((await state(page)).activeTool).toBe('frame');
    await canvasPage.wrapper().focus();
    await page.keyboard.press('v');
    await page.keyboard.press('f');
    expect((await state(page)).activeTool).toBe('frame');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'frame-shortcut-input';
      document.body.append(input);
      const live = document.createElement('div');
      live.dataset.elementId = 'frame-shortcut-live';
      live.dataset.fnLive = '';
      const button = document.createElement('button');
      button.id = 'frame-shortcut-live-control';
      live.append(button);
      document.body.append(live);
    });
    await canvasPage.selectTool('hand');
    await page.locator('#frame-shortcut-input').focus();
    await page.keyboard.press('f');
    expect((await state(page)).activeTool).toBe('hand');
    await page.locator('#frame-shortcut-live-control').focus();
    await page.keyboard.press('f');
    expect((await state(page)).activeTool).toBe('hand');
    await page.evaluate(() => {
      document.querySelector('#frame-shortcut-input')?.remove();
      document.querySelector('[data-element-id="frame-shortcut-live"]')?.remove();
    });
    await canvasPage.selectTool('frame');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 100, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (window as unknown as { __fieldnotes_viewport: { store: { count: number } } })
          .__fieldnotes_viewport.store.count === 1,
    );
    let result = await state(page);
    expect(result.activeTool).toBe('select');
    expect(result.selectedIds).toHaveLength(1);
    expect(result.undoCount).toBe(1);
    await page.evaluate(() =>
      (
        window as unknown as { __fieldnotes_viewport: { undo: () => void } }
      ).__fieldnotes_viewport.undo(),
    );
    expect((await state(page)).count).toBe(0);

    await canvasPage.selectTool('frame');
    await page.keyboard.down('Shift');
    await page.mouse.move(cx - 50, cy - 50);
    await page.mouse.down();
    await page.mouse.move(cx + 10, cy - 20);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    result = await state(page);
    expect(result.frames[0]?.size).toEqual({ w: 80, h: 80 });
    await canvasPage.selectTool('frame');
    await page.mouse.click(cx + 100, cy + 100);
    expect((await state(page)).count).toBe(1);

    for (const interruption of ['Escape', 'lostpointercapture', 'blur', 'visibilitychange']) {
      await page.reload();
      await page.waitForSelector('#canvas canvas');
      await canvasPage.selectTool('frame');
      await canvasPage.wrapper().focus();
      await page.mouse.move(cx - 80, cy - 60);
      await page.mouse.down();
      await page.mouse.move(cx, cy);
      if (interruption === 'Escape') await page.keyboard.press('Escape');
      else
        await page.evaluate((type) => {
          const wrapper = document.querySelector('#canvas > div');
          if (!wrapper) throw new Error('Wrapper not found');
          if (type === 'lostpointercapture')
            wrapper.dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
          else if (type === 'visibilitychange') document.dispatchEvent(new Event(type));
          else window.dispatchEvent(new Event(type));
        }, interruption);
      await page.mouse.up();
      const cancelled = await state(page);
      expect(cancelled.count).toBe(0);
      expect(cancelled.undoCount).toBe(0);
    }
    expect(errors).toEqual([]);
  });

  test('iPad deferred touch creates one frame and takeover cancels it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad', 'iPad touch coverage');
    const { canvasPage, errors } = await openCanvas(page);
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    await canvasPage.selectTool('frame');
    expect((await state(page)).activeTool).toBe('frame');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await singleFingerDraw(page, [
      { x: cx - 100, y: cy - 60 },
      { x: cx - 30, y: cy - 15 },
      { x: cx + 40, y: cy + 30 },
    ]);
    let result = await state(page);
    expect(result.count).toBe(1);
    expect(result.selectedIds).toHaveLength(1);
    expect(result.undoCount).toBe(1);

    await page.reload();
    await page.waitForSelector('#canvas canvas');
    await canvasPage.selectTool('frame');
    await twoFingerTakeover(page, { x: cx - 100, y: cy - 60 }, { x: 100, y: 70 });
    result = await state(page);
    expect(result.count).toBe(0);
    expect(result.undoCount).toBe(0);
    expect(errors).toEqual([]);
  });
});

test('clips a long frame title to its header bounds', async ({ page }) => {
  const { errors } = await openCanvas(page);
  const result = await page.evaluate(() => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      elementRegistry: {
        getAdapter(type: string):
          | {
              render?: (
                context: CanvasRenderingContext2D,
                element: unknown,
                allElements: unknown[],
              ) => void;
            }
          | undefined;
      };
    };
    const renderer = viewport.elementRegistry.getAdapter('core:frame')?.render;
    if (!renderer) throw new Error('Frame renderer not registered');
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Scratch canvas was not created');
    renderer(
      context,
      {
        id: 'long-title',
        type: 'extension',
        extensionType: 'core:frame',
        position: { x: 10, y: 10 },
        size: { w: 80, h: 48 },
        index: 'a0',
        version: 1,
        locked: false,
        layerId: '',
        dataVersion: 1,
        data: { title: 'A title that reaches far beyond this frame', color: '#64748b' },
      },
      [],
    );
    const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3] ?? 0;
    let titlePixels = 0;
    let outsidePixels = 0;
    for (let y = 12; y < 32; y++) {
      for (let x = 18; x < 89; x++) titlePixels += alpha(x, y) > 0 ? 1 : 0;
      for (let x = 91; x < canvas.width; x++) outsidePixels += alpha(x, y) > 0 ? 1 : 0;
    }
    return { titlePixels, outsidePixels };
  });

  expect(result.titlePixels).toBeGreaterThan(0);
  expect(result.outsidePixels).toBe(0);
  expect(errors).toEqual([]);
});

test('exports rich frame contents as real PNG pixels and structured SVG', async ({ page }) => {
  const { errors } = await openCanvas(page);
  const result = await page.evaluate(async () => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: {
        add: (element: unknown) => void;
        update(id: string, patch: Record<string, unknown>): void;
      };
      layerManager: {
        activeLayerId: string;
        setLayerOpacity(id: string, opacity: number): void;
      };
      elementRegistry: { register(definition: Record<string, unknown>): void };
      addHtmlElement(
        dom: HTMLElement,
        position: { x: number; y: number },
        size: { w: number; h: number },
        options: { htmlType: string },
      ): string;
      setParent(childId: string, parentId: string): void;
      registerHtmlPainter(
        type: string,
        painter: (context: {
          ctx: CanvasRenderingContext2D;
          element: { id: string };
          size: { w: number; h: number };
        }) => void,
      ): () => void;
      renderHooks: {
        imageExport: {
          register(hooks: {
            afterElements(context: { ctx: CanvasRenderingContext2D }): void;
          }): () => void;
        };
        svgExport: {
          register(hooks: {
            afterElements(context: { appendSvg(fragment: string): void }): void;
          }): () => void;
        };
      };
      exportImage: (options: {
        frameId: string;
        scale: number;
        padding: number;
        filter: (element: { id: string }) => boolean;
        onAssetError: (diagnostic: { elementId: string }) => void;
      }) => Promise<Blob | null>;
      exportSVG: (options: {
        frameId: string;
        padding: number;
        filter: (element: { id: string }) => boolean;
      }) => Promise<string>;
    };
    const frameId = 'e2e-export-frame';
    const layerId = viewport.layerManager.activeLayerId;
    viewport.layerManager.setLayerOpacity(layerId, 0.5);
    const painterIds: string[] = [];
    let collectPainterIds = false;
    const unregisterPainter = viewport.registerHtmlPainter(
      'e2e:frame-html',
      ({ ctx, element, size }) => {
        if (collectPainterIds) painterIds.push(element.id);
        ctx.fillStyle = '#f57c00';
        ctx.fillRect(0, 0, size.w, size.h);
      },
    );
    viewport.elementRegistry.register({
      type: 'e2e:frame-clip',
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
        ctx: CanvasRenderingContext2D,
        element: { data: { bounds: { x: number; y: number; w: number; h: number } } },
      ) => {
        const { bounds } = element.data;
        ctx.fillStyle = '#8b5cf6';
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      },
      emitSvg: (element: { data: { bounds: { x: number; y: number; w: number; h: number } } }) => {
        const { bounds } = element.data;
        return `<rect data-frame-clip="included" x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="#8b5cf6" />`;
      },
    });
    viewport.store.add({
      id: frameId,
      type: 'extension',
      extensionType: 'core:frame',
      position: { x: 100, y: 100 },
      size: { w: 240, h: 164 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId,
      dataVersion: 1,
      data: { title: 'Hidden chrome', color: '#64748b' },
    });
    viewport.store.add({
      id: 'e2e-export-child',
      type: 'shape',
      position: { x: 110, y: 120 },
      size: { w: 40, h: 40 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId,
      parentId: frameId,
      shape: 'rectangle',
      fillColor: '#00ff00',
      strokeColor: '#00ff00',
      strokeWidth: 0,
      opacity: 1,
    });
    viewport.store.add({
      id: 'e2e-export-clip',
      type: 'extension',
      extensionType: 'e2e:frame-clip',
      position: { x: 0, y: 0 },
      size: { w: 1, h: 1 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId,
      dataVersion: 1,
      data: { bounds: { x: 120, y: 130, w: 100, h: 80 }, clip: { x: 140, y: 140, w: 60, h: 60 } },
    });
    viewport.store.add({
      id: 'e2e-export-nested',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 130, y: 135 },
      size: { w: 90, h: 80 },
      index: 'a2',
      version: 1,
      locked: false,
      layerId,
      parentId: 'e2e-export-clip',
      fillColor: '#0066ff',
      strokeColor: '#0066ff',
      strokeWidth: 0,
    });
    const htmlId = viewport.addHtmlElement(
      document.createElement('div'),
      { x: 155, y: 150 },
      { w: 20, h: 20 },
      { htmlType: 'e2e:frame-html' },
    );
    viewport.setParent(htmlId, frameId);
    viewport.store.add({
      id: 'e2e-export-image',
      type: 'image',
      position: { x: 180, y: 180 },
      size: { w: 20, h: 20 },
      index: 'a3',
      version: 1,
      locked: false,
      layerId,
      parentId: frameId,
      src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="%2300cc88"/%3E%3C/svg%3E',
    });
    const excludedHtmlId = viewport.addHtmlElement(
      document.createElement('div'),
      { x: 10_000, y: 10_000 },
      { w: 20, h: 20 },
      { htmlType: 'e2e:frame-html' },
    );
    viewport.store.add({
      id: 'e2e-export-invalid-image',
      type: 'image',
      position: { x: 10_050, y: 10_000 },
      size: { w: 20, h: 20 },
      index: 'z0',
      version: 1,
      locked: false,
      layerId,
      src: 'data:image/png;base64,not-a-real-image',
    });
    viewport.store.add({
      id: 'e2e-export-overlap',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 100, y: 124 },
      size: { w: 240, h: 140 },
      index: 'z1',
      version: 1,
      locked: false,
      layerId,
      fillColor: '#ff0000',
      strokeColor: '#ff0000',
      strokeWidth: 0,
    });
    viewport.setParent('e2e-export-clip', frameId);
    const unregisterImageHook = viewport.renderHooks.imageExport.register({
      afterElements: ({ ctx }) => {
        ctx.fillStyle = '#123456';
        ctx.fillRect(80, 104, 8, 8);
      },
    });
    const unregisterSvgHook = viewport.renderHooks.svgExport.register({
      afterElements: ({ appendSvg }) =>
        appendSvg(
          '<rect data-frame-hook="padding" x="80" y="104" width="8" height="8" fill="#123456" />',
        ),
    });
    const diagnostics: string[] = [];
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    collectPainterIds = true;
    const image = await viewport.exportImage({
      frameId,
      scale: 1,
      padding: 24,
      filter: (element) => element.id !== 'e2e-export-clip',
      onAssetError: ({ elementId }) => diagnostics.push(elementId),
    });
    if (!image) throw new Error('Frame image was not created');
    const bitmap = await createImageBitmap(image);
    const surface = document.createElement('canvas');
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Scratch canvas was not created');
    context.drawImage(bitmap, 0, 0);
    const svg = await viewport.exportSVG({
      frameId,
      padding: 24,
      filter: (element) => element.id !== 'e2e-export-clip',
    });
    collectPainterIds = false;
    unregisterPainter();
    unregisterImageHook();
    unregisterSvgHook();
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    const nested = doc.querySelector('rect[fill="#0066ff"]');
    const clipById = new Map(
      [...doc.querySelectorAll('clipPath')].map((clip) => {
        const rect = clip.querySelector('rect');
        return [
          clip.id,
          [
            rect?.getAttribute('x'),
            rect?.getAttribute('y'),
            rect?.getAttribute('width'),
            rect?.getAttribute('height'),
          ],
        ];
      }),
    );
    let nestedClip: (string | null | undefined)[] | null = null;
    for (let ancestor = nested?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const match = /^url\(#(.+)\)$/.exec(ancestor.getAttribute('clip-path') ?? '');
      if (match?.[1]) {
        nestedClip = clipById.get(match[1]) ?? null;
        break;
      }
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: {
        green: pixel(36, 30),
        greenAboveFrame: pixel(44, 22),
        blue: pixel(75, 55),
        blueOutsideNestedClip: pixel(59, 80),
        filteredClip: pixel(134, 35),
        html: pixel(90, 60),
        image: pixel(115, 90),
        hook: pixel(5, 5),
        header: pixel(30, 5),
        unrelated: pixel(220, 80),
      },
      painterIds: [...new Set(painterIds)],
      htmlId,
      excludedHtmlId,
      diagnostics,
      svg: {
        width: doc.documentElement.getAttribute('width'),
        height: doc.documentElement.getAttribute('height'),
        viewBox: doc.documentElement.getAttribute('viewBox'),
        opacity: doc.querySelector('g[opacity="0.5"]') !== null,
        clips: doc.querySelectorAll('clipPath').length,
        child: doc.querySelector('rect[fill="#00ff00"]') !== null,
        nested: doc.querySelector('rect[fill="#0066ff"]') !== null,
        clip: doc.querySelector('[data-frame-clip="included"]') !== null,
        nestedClip,
        html: [...doc.querySelectorAll('image')].some((image) => image.getAttribute('x') === '155'),
        image: [...doc.querySelectorAll('image')].some(
          (image) => image.getAttribute('x') === '180',
        ),
        hook: doc.querySelector('[data-frame-hook="padding"]') !== null,
        frameChrome: svg.includes('Hidden chrome'),
        unrelated: svg.includes('#ff0000'),
        excludedHtml: [...doc.querySelectorAll('image')].some(
          (image) => image.getAttribute('x') === '10000',
        ),
        invalid: svg.includes('not-a-real-image'),
      },
    };
  });

  expect(result.width).toBe(288);
  expect(result.height).toBe(188);
  const close = (pixel: number[], expected: number[], tolerance = 12) =>
    pixel.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= tolerance);
  expect(close(result.pixels.green, [0, 255, 0, 128])).toBe(true);
  expect(result.pixels.greenAboveFrame[3]).toBe(0);
  expect(close(result.pixels.blue, [0, 102, 255, 128])).toBe(true);
  expect(result.pixels.blueOutsideNestedClip[3]).toBe(0);
  expect(result.pixels.filteredClip[3]).toBe(0);
  expect(close(result.pixels.html, [245, 124, 0, 128])).toBe(true);
  expect(result.pixels.image[1]).toBeGreaterThan(120);
  expect(close(result.pixels.hook, [18, 52, 86, 255])).toBe(true);
  expect(result.pixels.header[3]).toBe(0);
  expect(result.pixels.unrelated[3]).toBe(0);
  expect(result.painterIds).toEqual([result.htmlId]);
  expect(result.painterIds).not.toContain(result.excludedHtmlId);
  expect(result.diagnostics).toEqual([]);
  expect(result.svg).toMatchObject({
    width: '288',
    height: '188',
    viewBox: '76 100 288 188',
    opacity: true,
    child: true,
    nested: true,
    clip: false,
    html: true,
    image: true,
    hook: true,
    frameChrome: false,
    unrelated: false,
    excludedHtml: false,
    invalid: false,
  });
  expect(result.svg.clips).toBeGreaterThanOrEqual(1);
  expect(result.svg.nestedClip).toEqual(['140', '140', '60', '60']);
  expect(errors).toEqual([]);
});

test('exports empty frame backgrounds and encoding without changing board defaults', async ({
  page,
}) => {
  const { errors } = await openCanvas(page);
  const result = await page.evaluate(async () => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { add: (element: unknown) => void };
      exportImage: (options: {
        frameId: string;
        padding?: number;
        scale?: number;
        background?: string;
        format?: 'jpeg';
      }) => Promise<Blob | null>;
      exportSVG: (options: {
        frameId: string;
        padding?: number;
        background?: string;
      }) => Promise<string>;
    };
    const frameId = 'e2e-empty-export-frame';
    viewport.store.add({
      id: frameId,
      type: 'extension',
      extensionType: 'core:frame',
      position: { x: 10, y: 20 },
      size: { w: 80, h: 48 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      dataVersion: 1,
      data: { title: 'Empty', color: '#64748b' },
    });
    const png = await viewport.exportImage({ frameId, padding: 2, scale: 1 });
    const colored = await viewport.exportImage({
      frameId,
      padding: 2,
      scale: 1,
      background: '#123456',
    });
    const jpeg = await viewport.exportImage({ frameId, format: 'jpeg', scale: 1 });
    const svg = await viewport.exportSVG({ frameId, padding: 2, background: '#123456' });
    if (!png || !colored || !jpeg) throw new Error('Empty frame image was not created');
    const pngBitmap = await createImageBitmap(png);
    const coloredBitmap = await createImageBitmap(colored);
    const jpegBitmap = await createImageBitmap(jpeg);
    const alpha = (bitmap: ImageBitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Scratch canvas was not created');
      context.drawImage(bitmap, 0, 0);
      return [
        ...context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1)
          .data,
      ];
    };
    return {
      png: [pngBitmap.width, pngBitmap.height, alpha(pngBitmap)],
      colored: alpha(coloredBitmap),
      jpeg: [jpegBitmap.width, jpegBitmap.height, jpeg.type, alpha(jpegBitmap)],
      svg,
    };
  });

  expect(result.png.slice(0, 2)).toEqual([84, 28]);
  expect(result.png[2]?.[3]).toBe(0);
  expect(result.colored).toEqual([18, 52, 86, 255]);
  expect(result.jpeg.slice(0, 3)).toEqual([80, 24, 'image/jpeg']);
  expect(result.jpeg[3]?.[0]).toBeGreaterThan(240);
  expect(result.jpeg[3]?.[3]).toBe(255);
  expect(result.svg).toContain('viewBox="8 42 84 28"');
  expect(result.svg).toContain('#123456');
  expect(errors).toEqual([]);
});
