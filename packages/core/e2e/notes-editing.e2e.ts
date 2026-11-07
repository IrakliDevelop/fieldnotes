import { test, expect } from './fixtures/canvas-page';

test.describe('notes editing', () => {
  test('place note, double-click to edit, type text, click away to commit', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('note');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;

    await canvasPage.page.mouse.click(cx, cy);
    await canvasPage.page.waitForTimeout(500);

    const notes = await canvasPage.getElementsByType('note');
    expect(notes.length).toBe(1);

    const noteNode = canvasPage.page.locator('[data-element-id]').first();
    await noteNode.waitFor({ state: 'visible', timeout: 3000 });

    await noteNode.dblclick();
    await canvasPage.page.waitForTimeout(300);

    await canvasPage.page.keyboard.type('Hello E2E');
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.click(box.x + 10, box.y + 10);
    await canvasPage.page.waitForTimeout(300);

    const updatedNotes = (await canvasPage.getElementsByType('note')) as { text: string }[];
    expect(updatedNotes.length).toBe(1);
    const updatedNote = updatedNotes[0];
    if (!updatedNote) throw new Error('No note found after edit');
    expect(updatedNote.text).toContain('Hello E2E');
  });

  test('Escape after editing a note keeps board shortcuts working', async ({ canvasPage }) => {
    const { page } = canvasPage;
    await canvasPage.selectTool('note');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
    await expect.poll(async () => (await canvasPage.getElementsByType('note')).length).toBe(1);

    const noteNode = page.locator('[data-element-id]').first();
    await noteNode.waitFor({ state: 'visible', timeout: 3000 });
    await noteNode.dblclick();
    await expect(noteNode).toHaveAttribute('contenteditable', 'true');
    await expect.poll(() => noteNode.evaluate((el) => el === document.activeElement)).toBe(true);

    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    expect(await wrapper.evaluate((el) => el === document.activeElement)).toBe(true);
    const undoCount = () =>
      page.evaluate(() => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          history: { undoCount: number };
        };
        return vp.history.undoCount;
      });
    const before = await undoCount();

    await page.keyboard.press('Control+z');

    await expect.poll(undoCount).toBe(before - 1);
    const notes = (await canvasPage.getElementsByType('note')) as { text: string }[];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text ?? '').not.toContain('Hello');
  });

  test('Escape after editing shape text lets Control+z undo it without a click', async ({
    canvasPage,
  }) => {
    const { page } = canvasPage;
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const screen = { x: box.width / 2, y: box.height / 2 };
    await page.evaluate((screen) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { screenToWorld: (point: { x: number; y: number }) => { x: number; y: number } };
        layerManager: { activeLayerId: string };
        store: { add: (element: unknown) => void };
      };
      const world = vp.camera.screenToWorld(screen);
      vp.store.add({
        id: 'focus-host',
        type: 'shape',
        shape: 'rectangle',
        position: { x: world.x - 60, y: world.y - 30 },
        size: { w: 120, h: 60 },
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: 'none',
        index: 'a0',
        version: 1,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
      });
    }, screen);
    const host = () =>
      page.evaluate(() => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          store: { getAll: () => { id: string; containerId?: string; size: { h: number } }[] };
        };
        const all = vp.store.getAll();
        return {
          height: all.find((element) => element.id === 'focus-host')?.size.h,
          bound: all.some((element) => element.containerId === 'focus-host'),
        };
      });

    await page.keyboard.press('v');
    await page.mouse.click(box.x + screen.x, box.y + screen.y);
    await page.keyboard.press('Enter');
    const editor = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type('one two three four five six seven eight nine ten eleven twelve');
    await expect.poll(async () => (await host()).height ?? 0).toBeGreaterThan(60);
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);

    await page.keyboard.press('Control+z');

    await expect.poll(host).toEqual({ height: 60, bound: false });
  });
});
