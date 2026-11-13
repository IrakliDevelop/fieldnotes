import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/canvas-page';

interface Point {
  x: number;
  y: number;
}

interface TestWindow {
  __fieldnotes_viewport: {
    store: { clear: () => void; add: (element: unknown) => void };
    camera: {
      screenToWorld: (point: Point) => Point;
      worldToScreen: (point: Point) => Point;
    };
    domLayer: HTMLDivElement;
    layerManager: { activeLayerId: string };
    toolContext: { switchTool: (name: string) => void; setSelection: (ids: string[]) => void };
    setLink: (ids: string[], link: string | null) => void;
    getSelectedIds: () => string[];
  };
  __opened?: string;
}

async function addLinkedShape(page: Page): Promise<{ id: string; corner: Point; badge: Point }> {
  return page.evaluate(() => {
    const vp = (window as unknown as TestWindow).__fieldnotes_viewport;
    vp.store.clear();
    const id = 'linked-shape';
    const size = { w: 120, h: 80 };
    const centre = vp.camera.screenToWorld({
      x: vp.domLayer.clientWidth / 2,
      y: vp.domLayer.clientHeight / 2,
    });
    const position = { x: Math.round(centre.x - size.w / 2), y: Math.round(centre.y - size.h / 2) };
    vp.store.add({
      id,
      type: 'shape',
      shape: 'rectangle',
      position,
      size,
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'none',
      index: 'a0',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
    });
    vp.setLink([id], 'https://example.com');
    vp.toolContext.switchTool('select');
    vp.toolContext.setSelection([id]);
    // SELECTION_PAD 4 puts `ne` outside the bbox; the badge centre sits 18 px beyond it at zoom 1.
    const ne = { x: position.x + size.w + 4, y: position.y - 4 };
    return {
      id,
      corner: vp.camera.worldToScreen({ x: position.x + size.w, y: position.y }),
      badge: vp.camera.worldToScreen({ x: ne.x + 18, y: ne.y - 18 }),
    };
  });
}

test.describe('link badge', () => {
  test('a selected linked shape shows the badge', async ({ canvasPage }) => {
    const { page } = canvasPage;
    const { corner } = await addLinkedShape(page);
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    await page.addStyleTag({
      content:
        '#toolbar, #info, #layers-panel, #empty-hint, #toast-container, #shape-panel, #text-panel, #note-panel, #grid-panel, #template-panel, #measure-panel, #zorder-panel, [data-fieldnotes-minimap] { visibility: hidden !important; }',
    });

    // A clip around the ne corner keeps the small badge well above the 1% diff budget.
    const half = 40;
    await expect(page).toHaveScreenshot('link-badge.png', {
      clip: {
        x: Math.round(box.x + corner.x - half),
        y: Math.round(box.y + corner.y - half),
        width: 2 * half,
        height: 2 * half,
      },
      maxDiffPixelRatio: 0.01,
    });
  });

  test('clicking or tapping the badge opens the link', async ({ canvasPage }, testInfo) => {
    const { page } = canvasPage;
    const { id, badge } = await addLinkedShape(page);
    await page.evaluate(() => {
      window.open = (url?: string | URL) => {
        (window as unknown as TestWindow).__opened = String(url);
        return null;
      };
    });
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const x = box.x + badge.x;
    const y = box.y + badge.y;
    if (testInfo.project.name === 'ipad') {
      await page.touchscreen.tap(x, y);
    } else {
      await page.mouse.click(x, y);
    }
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__opened === 'https://example.com',
    );
    const selected = await page.evaluate(() =>
      (window as unknown as TestWindow).__fieldnotes_viewport.getSelectedIds(),
    );
    expect(selected).toEqual([id]);
  });
});
