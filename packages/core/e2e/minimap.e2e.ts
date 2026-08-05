import { test, expect } from './fixtures/canvas-page';
import { singleFingerHold } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Minimap: thumbnail fidelity (real element shapes, not the old full-bounds
 * colored-rect fill) and tap/drag navigation, on desktop AND iPad.
 *
 * `Viewport`'s built-in minimap (`ViewportOptions.minimap: true`, always on in
 * the demo) is a fixed 200x140 CSS-pixel canvas with an 8px content padding
 * (see `packages/core/src/canvas/minimap.ts` and `minimap-controller.ts`).
 * Several cases below re-derive the navigation transform locally with the
 * same formula as `minimap-transform.ts`'s `computeMinimapTransform` so
 * assertions do not depend on unexported internals — valid because these
 * tests run against an otherwise-empty scene, where the controller's mapping
 * (`union(content bbox, viewport rect)`) collapses to exactly the viewport
 * rect.
 */

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;
const MINIMAP_PADDING = 8;

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Mirrors `computeMinimapTransform` in `minimap-transform.ts`. */
function computeMinimapTransform(
  mapping: Bounds,
  miniW: number,
  miniH: number,
  padding: number,
): MinimapTransform {
  const availW = Math.max(1, miniW - 2 * padding);
  const availH = Math.max(1, miniH - 2 * padding);
  const w = Math.max(mapping.w, 1);
  const h = Math.max(mapping.h, 1);
  const scale = Math.min(availW / w, availH / h);
  const offsetX = (miniW - mapping.w * scale) / 2 - mapping.x * scale;
  const offsetY = (miniH - mapping.h * scale) / 2 - mapping.y * scale;
  return { scale, offsetX, offsetY };
}

/** Mirrors `miniToWorld` in `minimap-transform.ts`. */
function miniToWorld(t: MinimapTransform, p: Point): Point {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}

async function getVisibleRect(page: Page): Promise<Bounds> {
  return page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      getVisibleRect: () => Bounds;
    };
    return vp.getVisibleRect();
  });
}

async function cameraCenterWorld(
  page: Page,
  canvasWidth: number,
  canvasHeight: number,
): Promise<Point> {
  return page.evaluate(
    ({ w, h }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { screenToWorld: (p: Point) => Point };
      };
      return vp.camera.screenToWorld({ x: w / 2, y: h / 2 });
    },
    { w: canvasWidth, h: canvasHeight },
  );
}

function minimapLocator(page: Page) {
  return page.locator('canvas[data-fieldnotes-minimap]');
}

interface RedScan {
  found: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Scans the minimap's own pixel buffer for red-ish pixels and their bbox. */
async function scanMinimapRed(page: Page): Promise<RedScan> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('minimap canvas not found');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap canvas has no 2d context');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a > 40 && r > 150 && g < 100 && b < 100) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { found, minX, minY, maxX, maxY };
  });
}

/** True if any red-ish pixel exists in a small window around (x, y), in the minimap's own pixel space. */
async function isRedNear(page: Page, x: number, y: number, radius: number): Promise<boolean> {
  return page.evaluate(
    ({ x, y, radius }) => {
      const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('minimap canvas not found');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('minimap canvas has no 2d context');
      const size = radius * 2 + 1;
      const left = Math.max(0, Math.round(x - radius));
      const top = Math.max(0, Math.round(y - radius));
      const w = Math.min(canvas.width - left, size);
      const h = Math.min(canvas.height - top, size);
      if (w <= 0 || h <= 0) return false;
      const data = ctx.getImageData(left, top, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a > 40 && r > 150 && g < 100 && b < 100) return true;
      }
      return false;
    },
    { x, y, radius },
  );
}

async function setPencilColorRed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.getElementById('tool-color');
    if (input instanceof HTMLInputElement) {
      input.value = '#ff0000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

interface DrawArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A drawing rectangle inside the wrapper that clears the demo's floating
 * chrome — the (wide, overflowing) toolbar strip, the grid panel (top-left),
 * the layers panel (top-right), and the minimap itself (bottom-right) — so a
 * diagonal drawn corner-to-corner never lands a mouse event on an overlay
 * instead of the canvas.
 */
async function safeDrawArea(
  page: Page,
  wrapperBox: { x: number; y: number; width: number; height: number },
): Promise<DrawArea> {
  const toolbarBox = await page.locator('#toolbar').boundingBox();
  const gridPanelBox = await page.locator('#grid-panel').boundingBox();
  const layersPanelBox = await page.locator('#layers-panel').boundingBox();
  const minimapBox = await minimapLocator(page).boundingBox();
  const margin = 30;
  const top = (toolbarBox ? toolbarBox.y + toolbarBox.height : wrapperBox.y) + margin;
  const left = (gridPanelBox ? gridPanelBox.x + gridPanelBox.width : wrapperBox.x) + margin;
  const rightBound = Math.min(
    layersPanelBox ? layersPanelBox.x : wrapperBox.x + wrapperBox.width,
    minimapBox ? minimapBox.x : wrapperBox.x + wrapperBox.width,
  );
  return {
    left,
    top,
    right: rightBound - margin,
    bottom: wrapperBox.y + wrapperBox.height - margin,
  };
}

test.describe('minimap thumbnail fidelity', () => {
  test('renders the real diagonal stroke shape, not a full-bounds fill', async ({ canvasPage }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('pencil');
    await setPencilColorRed(page);

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const area = await safeDrawArea(page, box);
    const x1 = area.left;
    const y1 = area.top;
    const x2 = area.right;
    const y2 = area.bottom;

    // A straight diagonal across the safe drawing area (clear of the
    // toolbar and the minimap itself), to maximize the minimap footprint of
    // the stroke relative to the (empty) rest of the scene.
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
    await page.mouse.move(x2, y2, { steps: 5 });
    await page.mouse.up();

    expect((await canvasPage.getElementsByType('stroke')).length).toBe(1);

    // Past the controller's 200ms scene re-render debounce plus a draw frame.
    await page.waitForTimeout(500);

    const scan = await scanMinimapRed(page);
    expect(scan.found).toBe(true);
    // A real (non-degenerate) diagonal footprint, not a single dot.
    expect(scan.maxX - scan.minX).toBeGreaterThan(10);
    expect(scan.maxY - scan.minY).toBeGreaterThan(10);

    // On the diagonal: the midpoint of the stroke's minimap bbox lies on a
    // top-left -> bottom-right line and must be red.
    const midX = (scan.minX + scan.maxX) / 2;
    const midY = (scan.minY + scan.maxY) / 2;
    expect(await isRedNear(page, midX, midY, 3)).toBe(true);

    // Off the diagonal: the OTHER two corners of the stroke's bounding box
    // (top-right, bottom-left) are not on the line. The old minimap filled
    // the full element bounds as a colored rect, which would paint these
    // corners red too; the new one only draws the actual stroke shape.
    expect(await isRedNear(page, scan.maxX, scan.minY, 3)).toBe(false);
    expect(await isRedNear(page, scan.minX, scan.maxY, 3)).toBe(false);
  });
});

test.describe('minimap navigation', () => {
  test('clicking the minimap centers the camera on the clicked world point', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const minimapBox = await minimapLocator(page).boundingBox();
    if (!minimapBox) throw new Error('Minimap canvas not found');
    const wrapperBox = await canvasPage.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    // Empty scene: the controller's mapping (union of content bbox and
    // viewport rect) collapses to exactly the viewport rect.
    const visibleRect = await getVisibleRect(page);
    const transform = computeMinimapTransform(
      visibleRect,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      MINIMAP_PADDING,
    );
    const localPoint = { x: 24, y: 18 }; // off-center, inside the padded content area
    const expectedWorld = miniToWorld(transform, localPoint);

    await page.mouse.click(minimapBox.x + localPoint.x, minimapBox.y + localPoint.y);
    await page.waitForTimeout(50);

    const centerWorld = await cameraCenterWorld(page, wrapperBox.width, wrapperBox.height);
    expect(Math.abs(centerWorld.x - expectedWorld.x)).toBeLessThan(2);
    expect(Math.abs(centerWorld.y - expectedWorld.y)).toBeLessThan(2);
  });

  test('dragging across the minimap moves the camera through multiple positions', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const minimapBox = await minimapLocator(page).boundingBox();
    if (!minimapBox) throw new Error('Minimap canvas not found');

    await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { onChange: (cb: () => void) => () => void; position: Point };
      };
      const positions: Point[] = [];
      (window as unknown as Record<string, unknown>)['__minimap_drag_positions'] = positions;
      vp.camera.onChange(() => positions.push({ ...vp.camera.position }));
    });

    const startX = minimapBox.x + 20;
    const startY = minimapBox.y + 15;
    const endX = minimapBox.x + minimapBox.width - 20;
    const endY = minimapBox.y + minimapBox.height - 15;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    const positions = await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['__minimap_drag_positions'] as Point[],
    );

    const distinct = new Set(positions.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  test('a single-finger tap on the minimap centers the camera and creates no elements', async ({
    canvasPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad', 'iPad-only touch tap navigation');

    const page = canvasPage.page;
    const minimapBox = await minimapLocator(page).boundingBox();
    if (!minimapBox) throw new Error('Minimap canvas not found');
    const wrapperBox = await canvasPage.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const visibleRect = await getVisibleRect(page);
    const transform = computeMinimapTransform(
      visibleRect,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      MINIMAP_PADDING,
    );
    const localPoint = { x: 170, y: 115 }; // bottom-right region, inset from the edge
    const expectedWorld = miniToWorld(transform, localPoint);

    await singleFingerHold(
      page,
      { x: minimapBox.x + localPoint.x, y: minimapBox.y + localPoint.y },
      50,
    );
    await page.waitForTimeout(100);

    const centerWorld = await cameraCenterWorld(page, wrapperBox.width, wrapperBox.height);
    expect(Math.abs(centerWorld.x - expectedWorld.x)).toBeLessThan(2);
    expect(Math.abs(centerWorld.y - expectedWorld.y)).toBeLessThan(2);
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});

test.describe('minimap host resize', () => {
  test('resizing the host updates the viewport rect drawn on the minimap', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;

    // A fixed world-space element keeps the controller's mapping (union of
    // content bbox and viewport rect) from being screen-size-driven only —
    // otherwise the drawn rect always hugs the same padded box regardless of
    // host size, and this test could not discriminate a stale rect.
    await canvasPage.selectTool('pencil');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const dotX = box.x + box.width / 2;
    const dotY = box.y + box.height / 2;
    // A real (if tiny) drag: a stroke needs at least two recorded points, so
    // a stationary click alone is discarded by the pencil tool.
    await page.mouse.move(dotX, dotY);
    await page.mouse.down();
    await page.mouse.move(dotX + 5, dotY + 5, { steps: 3 });
    await page.mouse.up();
    expect((await canvasPage.getElementsByType('stroke')).length).toBe(1);

    await page.waitForTimeout(500); // past the scene re-render debounce

    const before = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('minimap canvas not found');
      return canvas.toDataURL();
    });

    const original = page.viewportSize() ?? { width: 1280, height: 720 };
    const target = {
      width: Math.max(400, original.width - 200),
      height: Math.max(300, original.height - 120),
    };
    await page.setViewportSize(target);
    await page.waitForTimeout(500); // resize observer + debounce + draw frame

    const after = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-fieldnotes-minimap]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('minimap canvas not found');
      return canvas.toDataURL();
    });

    expect(after).not.toBe(before);
  });
});
