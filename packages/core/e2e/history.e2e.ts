import { test, expect } from './fixtures/canvas-page';

test.describe('history (undo/redo)', () => {
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
