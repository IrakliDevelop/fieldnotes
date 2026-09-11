import { test, expect } from './fixtures/canvas-page';

test.describe('drawing tools', () => {
  test('draws a rectangle with shape tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 100, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 100, { steps: 5 });
    await canvasPage.page.mouse.up();

    const shapes = await canvasPage.getElementsByType('shape');
    expect(shapes.length).toBe(1);
  });

  test('draws a stroke with pencil tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('pencil');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 100, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 50, { steps: 10 });
    await canvasPage.page.mouse.up();

    const strokes = await canvasPage.getElementsByType('stroke');
    expect(strokes.length).toBe(1);
  });

  test('places a note with note tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('note');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.click(cx, cy);

    const notes = await canvasPage.getElementsByType('note');
    expect(notes.length).toBe(1);
  });

  test('draws an arrow with arrow tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('arrow');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 150, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 150, cy + 100, { steps: 5 });
    await canvasPage.page.mouse.up();

    const arrows = await canvasPage.getElementsByType('arrow');
    expect(arrows.length).toBe(1);
  });

  test('opens arrow label editing within the screen-pixel tolerance when zoomed out', async ({
    canvasPage,
  }) => {
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const screen = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: {
          setZoom: (zoom: number) => void;
          moveTo: (x: number, y: number) => void;
          worldToScreen: (point: { x: number; y: number }) => { x: number; y: number };
        };
        layerManager: { activeLayerId: string };
        requestRender: () => void;
        store: { clear: () => void; add: (element: unknown) => void };
      };
      vp.store.clear();
      vp.camera.moveTo(0, 0);
      vp.camera.setZoom(0.1);
      vp.store.add({
        id: 'zoom-arrow',
        type: 'arrow',
        position: { x: 1000, y: 3000 },
        from: { x: 1000, y: 3000 },
        to: { x: 3000, y: 3000 },
        bend: 0,
        color: '#000000',
        width: 2,
        zIndex: 0,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
      });
      vp.requestRender();
      // Fifty world units are five screen pixels below the arrow at 0.1x.
      return vp.camera.worldToScreen({ x: 2000, y: 3050 });
    });

    await canvasPage.page.mouse.dblclick(box.x + screen.x, box.y + screen.y);
    await expect(wrapper.locator('input[type="text"]')).toBeVisible();
  });

  test('places text with text tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('text');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.click(cx, cy);

    const texts = await canvasPage.getElementsByType('text');
    expect(texts.length).toBe(1);
  });
});
