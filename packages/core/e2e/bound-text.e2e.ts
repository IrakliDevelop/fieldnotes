import { test, expect } from './fixtures/canvas-page';

test('double-clicking a rectangle creates editable bound text and Escape abandons it', async ({
  canvasPage,
}) => {
  const wrapper = canvasPage.wrapper();
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const point = { x: box.width / 2, y: box.height / 2 };
  const world = await canvasPage.page.evaluate((screen) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { screenToWorld: (point: { x: number; y: number }) => { x: number; y: number } };
    };
    return vp.camera.screenToWorld(screen);
  }, point);
  await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      layerManager: { activeLayerId: string };
      store: { add: (element: unknown) => void };
      requestRender: () => void;
    };
    vp.store.add({
      id: 'bound-rectangle',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 120, h: 60 },
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'none',
      index: 'a0',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
    });
    vp.requestRender();
  });
  await canvasPage.page.evaluate((center) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { update: (id: string, patch: unknown) => void };
    };
    vp.store.update('bound-rectangle', {
      position: { x: center.x - 60, y: center.y - 30 },
    });
  }, world);
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => unknown };
    };
    return vp.store.getById('bound-rectangle') !== undefined;
  });
  expect(
    await canvasPage.page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('#canvas') !== null,
      { x: box.x + point.x, y: box.y + point.y },
    ),
  ).toBe(true);
  await canvasPage.page.mouse.dblclick(box.x + point.x, box.y + point.y);
  const editor = wrapper.locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getAll: () => { type: string; containerId?: string }[] };
    };
    return !vp.store.getAll().some((element) => element.type === 'text' && element.containerId);
  });
});
