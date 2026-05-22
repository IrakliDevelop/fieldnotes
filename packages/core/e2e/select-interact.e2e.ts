import { test, expect } from './fixtures/canvas-page';

test.describe('select and interact', () => {
  test('click on drawn shape to select it', async ({ canvasPage }) => {
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

    const shapes = await canvasPage.getElementsByType('shape');
    expect(shapes.length).toBe(1);

    await canvasPage.page.keyboard.press('v');
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.click(cx, cy);
    await canvasPage.page.waitForTimeout(200);

    const selectedCount = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        toolManager: {
          getTool: (name: string) => { selectedIds: string[] };
        };
      };
      return vp.toolManager.getTool('select').selectedIds.length;
    });
    expect(selectedCount).toBe(1);
  });

  test('drag selected shape to move it', async ({ canvasPage }) => {
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

    const shapesBefore = (await canvasPage.getElementsByType('shape')) as {
      position: { x: number; y: number };
    }[];
    expect(shapesBefore.length).toBe(1);
    const firstBefore = shapesBefore[0];
    if (!firstBefore) throw new Error('No shape found');
    const posBefore = firstBefore.position;

    await canvasPage.page.keyboard.press('v');
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.click(cx, cy);
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 50, { steps: 10 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    const shapesAfter = (await canvasPage.getElementsByType('shape')) as {
      position: { x: number; y: number };
    }[];
    expect(shapesAfter.length).toBe(1);
    const firstAfter = shapesAfter[0];
    if (!firstAfter) throw new Error('No shape found after move');
    const posAfter = firstAfter.position;

    expect(posAfter.x).not.toBe(posBefore.x);
    expect(posAfter.y).not.toBe(posBefore.y);
  });
});
