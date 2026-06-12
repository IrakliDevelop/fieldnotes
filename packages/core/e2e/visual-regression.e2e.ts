import { test, expect } from './fixtures/canvas-page';

test.describe('visual regression', () => {
  test('canvas with shapes matches snapshot', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 100, cy - 50);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 50, { steps: 5 });
    await canvasPage.page.mouse.up();

    await canvasPage.page.waitForTimeout(300);

    await canvasPage.page.addStyleTag({
      content:
        '#toolbar, #info, #layers-panel, #empty-hint, #toast-container, #shape-panel, #text-panel, #note-panel, #grid-panel, #template-panel, #measure-panel { visibility: hidden !important; }',
    });

    await expect(wrapper).toHaveScreenshot('canvas-with-shape.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
