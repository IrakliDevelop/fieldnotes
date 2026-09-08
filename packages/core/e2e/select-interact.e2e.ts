import { test, expect } from './fixtures/canvas-page';

test.describe('select and interact', () => {
  test('aims and resizes registered VTT template envelopes', async ({ canvasPage }) => {
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const points = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: {
          screenToWorld: (point: { x: number; y: number }) => { x: number; y: number };
          worldToScreen: (point: { x: number; y: number }) => { x: number; y: number };
        };
        domLayer: HTMLDivElement;
        layerManager: { activeLayerId: string };
        store: { add: (element: unknown) => void };
        toolContext: unknown;
        toolManager: {
          setTool: (name: string, context: unknown) => void;
          getTool: (name: string) => { setSelection: (ids: string[]) => void };
        };
      };
      const center = vp.camera.screenToWorld({
        x: vp.domLayer.clientWidth / 2,
        y: vp.domLayer.clientHeight / 2,
      });
      vp.store.add({
        id: 'e2e-cone-envelope',
        type: 'extension',
        extensionType: 'vtt:template',
        position: center,
        zIndex: 1,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
        data: {
          templateShape: 'cone',
          radius: 80,
          angle: 0,
          fillColor: '#ff0000',
          strokeColor: '#880000',
          strokeWidth: 2,
          opacity: 0.4,
        },
      });
      vp.toolManager.setTool('select', vp.toolContext);
      vp.toolManager.getTool('select').setSelection(['e2e-cone-envelope']);
      return {
        aim: vp.camera.worldToScreen({ x: center.x + 104, y: center.y }),
        aimTarget: vp.camera.worldToScreen({ x: center.x, y: center.y - 80 }),
        center,
      };
    });

    await canvasPage.page.mouse.move(box.x + points.aim.x, box.y + points.aim.y);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(box.x + points.aimTarget.x, box.y + points.aimTarget.y, {
      steps: 5,
    });
    await canvasPage.page.mouse.up();

    const angle = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: { getById: (id: string) => { data: Record<string, unknown> } };
      };
      return vp.store.getById('e2e-cone-envelope').data['angle'];
    });
    expect(angle).toBeCloseTo(-Math.PI / 2, 2);

    const resize = await canvasPage.page.evaluate(({ center }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { worldToScreen: (point: { x: number; y: number }) => { x: number; y: number } };
        layerManager: { activeLayerId: string };
        store: { add: (element: unknown) => void };
        toolManager: { getTool: (name: string) => { setSelection: (ids: string[]) => void } };
      };
      const circleCenter = { x: center.x + 220, y: center.y };
      vp.store.add({
        id: 'e2e-circle-envelope',
        type: 'extension',
        extensionType: 'vtt:template',
        position: circleCenter,
        zIndex: 2,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
        data: {
          templateShape: 'circle',
          radius: 40,
          angle: 0,
          fillColor: '#0000ff',
          strokeColor: '#000088',
          strokeWidth: 2,
          opacity: 0.4,
        },
      });
      vp.toolManager.getTool('select').setSelection(['e2e-circle-envelope']);
      return {
        handle: vp.camera.worldToScreen({ x: circleCenter.x + 40, y: circleCenter.y + 40 }),
        target: vp.camera.worldToScreen({ x: circleCenter.x + 70, y: circleCenter.y + 70 }),
      };
    }, points);

    await canvasPage.page.mouse.move(box.x + resize.handle.x, box.y + resize.handle.y);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(box.x + resize.target.x, box.y + resize.target.y, {
      steps: 5,
    });
    await canvasPage.page.mouse.up();

    const radius = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: { getById: (id: string) => { data: Record<string, unknown> } };
      };
      return vp.store.getById('e2e-circle-envelope').data['radius'];
    });
    expect(radius).toBeGreaterThan(40);
  });

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

  test('align panel clears when selected elements are deleted via keyboard', async ({
    canvasPage,
  }) => {
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.5;

    // Draw first rectangle.
    await canvasPage.selectTool('shape');
    await canvasPage.page.mouse.move(cx - 180, cy - 60);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx - 100, cy, { steps: 5 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    // Draw second rectangle, well clear of the first.
    await canvasPage.selectTool('shape');
    await canvasPage.page.mouse.move(cx + 100, cy - 60);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 180, cy, { steps: 5 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    const shapes = await canvasPage.getElementsByType('shape');
    expect(shapes.length).toBe(2);

    // Marquee-select both rectangles from empty space.
    await canvasPage.page.keyboard.press('v');
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.move(cx - 200, cy - 100);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 200, cy + 60, { steps: 10 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(200);

    const selectedCount = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        toolManager: {
          getTool: (name: string) => { selectedIds: string[] };
        };
      };
      return vp.toolManager.getTool('select').selectedIds.length;
    });
    expect(selectedCount).toBe(2);

    const alignPanel = canvasPage.page.locator('#align-panel');
    await expect(alignPanel).toBeVisible();
    await expect(alignPanel).toHaveCSS('display', 'flex');

    await canvasPage.page.keyboard.press('Delete');

    // No further pointer input after this point: the panel must clear from
    // the deletion's own selection-change event alone.
    await expect(alignPanel).toBeHidden();

    const shapesAfterDelete = await canvasPage.getElementsByType('shape');
    expect(shapesAfterDelete.length).toBe(0);
  });
});
