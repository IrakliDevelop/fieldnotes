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
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press('v');
    expect((await state(page)).activeTool).toBe('frame');
    await page.evaluate(() => document.querySelector('input')?.remove());

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
