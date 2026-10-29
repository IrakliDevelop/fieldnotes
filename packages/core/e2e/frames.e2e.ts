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

test('exports rich frame contents as real PNG pixels and structured SVG', async ({ page }) => {
  const { errors } = await openCanvas(page);
  const result = await page.evaluate(async () => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { add: (element: unknown) => void };
      exportImage: (options: {
        frameId: string;
        scale: number;
        padding: number;
      }) => Promise<Blob | null>;
      exportSVG: (options: { frameId: string; padding: number }) => Promise<string>;
    };
    const frameId = 'e2e-export-frame';
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
      data: { title: 'Hidden chrome', color: '#64748b' },
    });
    viewport.store.add({
      id: 'e2e-export-child',
      type: 'shape',
      position: { x: 20, y: 50 },
      size: { w: 10, h: 10 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      parentId: frameId,
      shape: 'rectangle',
      fillColor: '#00ff00',
      strokeColor: '#00ff00',
      strokeWidth: 0,
      opacity: 1,
    });
    viewport.store.add({
      id: 'e2e-export-overlap',
      type: 'shape',
      position: { x: 10, y: 44 },
      size: { w: 80, h: 24 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: '',
      shape: 'rectangle',
      fillColor: '#ff0000',
      strokeColor: '#ff0000',
      strokeWidth: 0,
      opacity: 1,
    });
    const image = await viewport.exportImage({ frameId, scale: 1, padding: 24 });
    if (!image) throw new Error('Frame image was not created');
    const bitmap = await createImageBitmap(image);
    const surface = document.createElement('canvas');
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Scratch canvas was not created');
    context.drawImage(bitmap, 0, 0);
    const sample = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    const svg = await viewport.exportSVG({ frameId, padding: 24 });
    return {
      width: bitmap.width,
      height: bitmap.height,
      svg,
      child: sample(35, 35),
      header: sample(30, 5),
      unrelated: sample(75, 45),
    };
  });

  expect(result.width).toBe(128);
  expect(result.height).toBe(72);
  expect(result.svg).toContain('viewBox="-14 20 128 72"');
  expect(result.svg).toContain('#00ff00');
  expect(result.svg).not.toContain('#ff0000');
  expect(result.svg).not.toContain('Hidden chrome');
  expect(result.child[1]).toBeGreaterThan(240);
  expect(result.header[3]).toBe(0);
  expect(result.unrelated[3]).toBe(0);
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
