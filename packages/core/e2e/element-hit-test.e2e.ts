import { test, expect } from './fixtures/canvas-page';
import type { CanvasPage } from './fixtures/canvas-page';

interface ShapeSnapshot {
  id: string;
  layerId: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

interface HitTestWindow {
  __fieldnotes_hit_test: (x: number, y: number, respectLayerLock?: boolean) => string | null;
  __fieldnotes_viewport: {
    layerManager: {
      setLayerLocked: (id: string, locked: boolean) => boolean;
    };
  };
}

/** Draws a rectangle via the shape tool and returns its store snapshot (world coordinates). */
async function drawShape(canvasPage: CanvasPage): Promise<ShapeSnapshot> {
  await canvasPage.selectTool('shape');
  const wrapper = canvasPage.wrapper();
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('Wrapper not found');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.6;

  await canvasPage.page.mouse.move(cx - 80, cy - 40);
  await canvasPage.page.mouse.down();
  await canvasPage.page.mouse.move(cx + 80, cy + 40, { steps: 5 });
  await canvasPage.page.mouse.up();
  await canvasPage.page.waitForTimeout(200);

  const shapes = (await canvasPage.getElementsByType('shape')) as ShapeSnapshot[];
  const shape = shapes[0];
  if (!shape) throw new Error('No shape found after draw');
  return shape;
}

/** Calls the demo's __fieldnotes_hit_test probe with a world-space point. */
function hitTest(
  canvasPage: CanvasPage,
  x: number,
  y: number,
  respectLayerLock?: boolean,
): Promise<string | null> {
  return canvasPage.page.evaluate(
    ({ x, y, respectLayerLock }) => {
      const w = window as unknown as HitTestWindow;
      return w.__fieldnotes_hit_test(x, y, respectLayerLock);
    },
    { x, y, respectLayerLock },
  );
}

test.describe('getElementAt', () => {
  test('hits a placed element at its centre', async ({ canvasPage }) => {
    const shape = await drawShape(canvasPage);
    const cx = shape.position.x + shape.size.w / 2;
    const cy = shape.position.y + shape.size.h / 2;

    const id = await hitTest(canvasPage, cx, cy);
    expect(id).toBe(shape.id);
  });

  test('misses 4px outside the element bounds', async ({ canvasPage }) => {
    const shape = await drawShape(canvasPage);
    // Just past the right edge, vertically centred: inside bounds is inclusive
    // (see select-hit.ts isInsideBounds), so 4px past the edge is the first
    // point guaranteed to miss.
    const missX = shape.position.x + shape.size.w + 4;
    const missY = shape.position.y + shape.size.h / 2;

    const id = await hitTest(canvasPage, missX, missY);
    expect(id).toBeNull();
  });

  test('misses empty space', async ({ canvasPage }) => {
    await drawShape(canvasPage);

    const id = await hitTest(canvasPage, -9999, -9999);
    expect(id).toBeNull();
  });

  test('locked layer: null by default, hit with respectLayerLock: false', async ({
    canvasPage,
  }) => {
    // LayerManager refuses to lock the active layer when no fallback exists
    // (layer-manager.ts setLayerLocked) and silently no-ops. Add a second
    // layer first so locking the shape's (active) layer has somewhere to
    // fall back to, mirroring the Viewport.getElementAt unit test fixture.
    await canvasPage.page.click('#add-layer');
    await canvasPage.page.waitForTimeout(200);

    const shape = await drawShape(canvasPage);
    const cx = shape.position.x + shape.size.w / 2;
    const cy = shape.position.y + shape.size.h / 2;

    const locked = await canvasPage.page.evaluate((layerId) => {
      const w = window as unknown as HitTestWindow;
      return w.__fieldnotes_viewport.layerManager.setLayerLocked(layerId, true);
    }, shape.layerId);
    expect(locked).toBe(true);

    const idDefault = await hitTest(canvasPage, cx, cy);
    expect(idDefault).toBeNull();

    const idUnlocked = await hitTest(canvasPage, cx, cy, false);
    expect(idUnlocked).toBe(shape.id);
  });
});
