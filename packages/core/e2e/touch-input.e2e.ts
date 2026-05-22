import { test, expect } from './fixtures/canvas-page';
import { pinchGesture, twoFingerPan } from './helpers/touch';
import { stylusDraw } from './helpers/stylus';

test.describe('touch input', () => {
  test('pinch to zoom changes camera zoom', async ({ canvasPage }) => {
    const zoomBefore = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoom: number };
      };
      return vp.camera.zoom;
    });

    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await pinchGesture(canvasPage.page, { x: cx, y: cy }, 100, 300, 10);
    await canvasPage.page.waitForTimeout(200);

    const zoomAfter = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoom: number };
      };
      return vp.camera.zoom;
    });

    expect(zoomAfter).not.toBe(zoomBefore);
  });

  test('two-finger pan moves camera', async ({ canvasPage }) => {
    const posBefore = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { position: { x: number; y: number } };
      };
      return { ...vp.camera.position };
    });

    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    await twoFingerPan(
      canvasPage.page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: 150, y: 75 },
      10,
    );
    await canvasPage.page.waitForTimeout(200);

    const posAfter = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { position: { x: number; y: number } };
      };
      return { ...vp.camera.position };
    });

    const moved = posAfter.x !== posBefore.x || posAfter.y !== posBefore.y;
    expect(moved).toBe(true);
  });

  test('stylus draw creates a stroke', async ({ canvasPage }) => {
    await canvasPage.selectTool('pencil');

    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await stylusDraw(canvasPage.page, [
      { x: cx - 100, y: cy, pressure: 0.2 },
      { x: cx - 50, y: cy + 10, pressure: 0.5 },
      { x: cx, y: cy + 20, pressure: 0.8 },
      { x: cx + 50, y: cy + 10, pressure: 0.6 },
      { x: cx + 100, y: cy, pressure: 0.3 },
    ]);
    await canvasPage.page.waitForTimeout(200);

    const strokes = await canvasPage.getElementsByType('stroke');
    expect(strokes.length).toBe(1);
  });
});
