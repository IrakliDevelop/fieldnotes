import { test, expect } from './fixtures/canvas-page';

test.describe('history (undo/redo)', () => {
  test('public batch removal is one undo step', async ({ canvasPage }) => {
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    for (const offset of [-100, 100]) {
      await canvasPage.selectTool('shape');
      await canvasPage.page.mouse.move(box.x + box.width / 2 + offset, box.y + 300);
      await canvasPage.page.mouse.down();
      await canvasPage.page.mouse.move(box.x + box.width / 2 + offset + 50, box.y + 350);
      await canvasPage.page.mouse.up();
    }
    expect(await canvasPage.getElementCount()).toBe(2);

    const removed = await canvasPage.page.evaluate(() => {
      const viewport = (
        window as unknown as {
          __fieldnotes_viewport: {
            store: { snapshot(): { id: string }[] };
            removeElements(ids: string[]): number;
          };
        }
      ).__fieldnotes_viewport;
      return viewport.removeElements(viewport.store.snapshot().map((element) => element.id));
    });

    expect(removed).toBe(2);
    expect(await canvasPage.getElementCount()).toBe(0);
    await canvasPage.page.click('#undo');
    expect(await canvasPage.getElementCount()).toBe(2);
  });

  test('undo removes drawn element', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;

    await canvasPage.page.mouse.move(cx - 80, cy - 40);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 80, cy + 40, { steps: 5 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    expect(await canvasPage.getElementCount()).toBe(1);

    await canvasPage.page.click('#undo');
    await canvasPage.page.waitForTimeout(200);

    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('redo restores undone element', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;

    await canvasPage.page.mouse.move(cx - 80, cy - 40);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 80, cy + 40, { steps: 5 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    expect(await canvasPage.getElementCount()).toBe(1);

    await canvasPage.page.click('#undo');
    await canvasPage.page.waitForTimeout(200);
    expect(await canvasPage.getElementCount()).toBe(0);

    await canvasPage.page.click('#redo');
    await canvasPage.page.waitForTimeout(200);
    expect(await canvasPage.getElementCount()).toBe(1);
  });
});
