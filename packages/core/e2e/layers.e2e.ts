import { test, expect } from './fixtures/canvas-page';

test.describe('layers', () => {
  test('add layer increases layer count', async ({ canvasPage }) => {
    const layerCountBefore = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        layerManager: { getLayers: () => unknown[] };
      };
      return vp.layerManager.getLayers().length;
    });

    await canvasPage.page.click('#add-layer');
    await canvasPage.page.waitForTimeout(200);

    const layerCountAfter = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        layerManager: { getLayers: () => unknown[] };
      };
      return vp.layerManager.getLayers().length;
    });

    expect(layerCountAfter).toBe(layerCountBefore + 1);
  });

  test('draw on new layer assigns element to that layer', async ({ canvasPage }) => {
    await canvasPage.page.click('#add-layer');
    await canvasPage.page.waitForTimeout(200);

    const activeLayerId = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        layerManager: { activeLayerId: string };
      };
      return vp.layerManager.activeLayerId;
    });

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

    const shapes = (await canvasPage.getElementsByType('shape')) as { layerId: string }[];
    expect(shapes.length).toBe(1);
    const shape = shapes[0];
    if (!shape) throw new Error('No shape found on new layer');
    expect(shape.layerId).toBe(activeLayerId);
  });
});
