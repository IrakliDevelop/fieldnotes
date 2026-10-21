import { test, expect } from './fixtures/canvas-page';
import type { CanvasPage } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Movement tracking in the demo: a square 40px grid with snap on, one 1×1 token
 * tracked through the toolbar's "Track movement" toggle (5 ft per cell, bands
 * 30/60). `__fieldnotes_movement` is the demo's `MovementTracker`; its live drag
 * is drawn locally and looped back through a `RemoteMovementOverlay`.
 */

const CELL = 40;
const GREEN = '#2E7D32';

/** 1×1 transparent PNG — the token's pixels are irrelevant, its box is not. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Tracker {
  isTracked: (id: string) => boolean;
  getMovement: (id: string) => { feet: number; remaining: number | null } | null;
}

/** Square grid, snap on, and one cell-centred token, tracked via the toolbar toggle. */
async function setupTrackedToken(canvasPage: CanvasPage): Promise<{ id: string; box: Box }> {
  const page = canvasPage.page;
  await page.selectOption('#grid-type', 'square');
  await page.click('#grid-toggle');
  await page.click('#snap-toggle');
  expect(
    await page.evaluate(
      () => (window as unknown as { viewport: { snapToGrid: boolean } }).viewport.snapToGrid,
    ),
  ).toBe(true);

  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const id = await page.evaluate(
    ({ cx, cy, cell, src }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { screenToWorld: (p: Point) => Point };
        addImage: (src: string, p: Point, size: { w: number; h: number }) => string;
      };
      const near = vp.camera.screenToWorld({ x: cx, y: cy });
      const corner = {
        x: Math.round(near.x / cell) * cell - 2 * cell,
        y: Math.round(near.y / cell) * cell,
      };
      return vp.addImage(src, corner, { w: cell, h: cell });
    },
    { cx: box.width / 2, cy: box.height / 2, cell: CELL, src: PIXEL_PNG },
  );

  await canvasPage.selectTool('select');
  const centre = await tokenScreenCentre(page, box, id);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator('#movement-track')).toBeEnabled();
  await page.click('#movement-track');
  await expect.poll(() => isTracked(page, id)).toBe(true);
  return { id, box };
}

async function isTracked(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elementId) => {
    const tracker = (window as unknown as Record<string, unknown>).__fieldnotes_movement as
      Tracker | undefined;
    return tracker?.isTracked(elementId) ?? false;
  }, id);
}

async function feet(page: Page, id: string): Promise<number | null> {
  return page.evaluate((elementId) => {
    const tracker = (window as unknown as Record<string, unknown>).__fieldnotes_movement as Tracker;
    return tracker.getMovement(elementId)?.feet ?? null;
  }, id);
}

async function tokenPosition(page: Page, id: string): Promise<Point> {
  return page.evaluate((elementId) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => { position: Point } | undefined };
    };
    const el = vp.store.getById(elementId);
    if (!el) throw new Error(`Element ${elementId} is gone`);
    return el.position;
  }, id);
}

/** The token's centre in page coordinates, offset by `cells` grid cells. */
async function tokenScreenCentre(page: Page, box: Box, id: string, cells: Point = { x: 0, y: 0 }) {
  const p = await page.evaluate(
    ({ elementId, cells, cell }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: {
          getById: (id: string) => { position: Point; size: { w: number; h: number } } | undefined;
        };
        camera: { worldToScreen: (p: Point) => Point };
      };
      const el = vp.store.getById(elementId);
      if (!el) throw new Error(`Element ${elementId} is gone`);
      return vp.camera.worldToScreen({
        x: el.position.x + el.size.w / 2 + cells.x * cell,
        y: el.position.y + el.size.h / 2 + cells.y * cell,
      });
    },
    { elementId: id, cells, cell: CELL },
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Presses on the token and moves it `cells` to the right, leaving the button down. */
async function pressAndDrag(page: Page, box: Box, id: string, cells: number): Promise<void> {
  const from = await tokenScreenCentre(page, box, id);
  const to = await tokenScreenCentre(page, box, id, { x: cells, y: 0 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

async function countColorPixels(page: Page, hex: string, tolerance = 40): Promise<number> {
  return page.evaluate(
    ({ hex, tolerance }) => {
      const canvas = window.__fnCompositeCanvas();
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      const r0 = parseInt(hex.slice(1, 3), 16);
      const g0 = parseInt(hex.slice(3, 5), 16);
      const b0 = parseInt(hex.slice(5, 7), 16);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 10) continue;
        if (
          Math.abs((data[i] ?? 0) - r0) <= tolerance &&
          Math.abs((data[i + 1] ?? 0) - g0) <= tolerance &&
          Math.abs((data[i + 2] ?? 0) - b0) <= tolerance
        ) {
          count += 1;
        }
      }
      return count;
    },
    { hex, tolerance },
  );
}

/**
 * CSS-pixel height of the dark label pill drawn above `centre` (wrapper-local
 * CSS px). The crop is the pill's left end, clear of the 40px token under its
 * middle; grid lines, dots, cell tints and the green path are all lighter than
 * the pill's 75%-black fill.
 */
async function labelHeight(page: Page, centre: Point): Promise<number> {
  return page.evaluate((c) => {
    const canvas = window.__fnCompositeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const dpr = window.devicePixelRatio;
    const x0 = Math.max(0, Math.round((c.x - 90) * dpr));
    const y0 = Math.max(0, Math.round((c.y - 60) * dpr));
    const w = Math.round(65 * dpr);
    const h = Math.round(60 * dpr);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let top = Infinity;
    let bottom = -Infinity;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const dark =
          (data[i + 3] ?? 0) > 200 &&
          (data[i] ?? 255) < 100 &&
          (data[i + 1] ?? 255) < 100 &&
          (data[i + 2] ?? 255) < 100;
        if (!dark) continue;
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
      }
    }
    return bottom < top ? 0 : (bottom - top + 1) / dpr;
  }, centre);
}

test.describe('movement tracking', () => {
  test('a mouse drag of three cells counts 15 ft with the overlay shown only mid-drag, and a second drag continues to 30 ft', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const { id, box } = await setupTrackedToken(canvasPage);
    expect(await countColorPixels(page, GREEN)).toBe(0);

    await pressAndDrag(page, box, id, 3);
    await expect.poll(() => countColorPixels(page, GREEN)).toBeGreaterThan(50);
    await page.mouse.up();
    await expect.poll(() => countColorPixels(page, GREEN)).toBe(0);
    expect(await feet(page, id)).toBe(15);

    await pressAndDrag(page, box, id, 3);
    await page.mouse.up();
    await expect.poll(() => feet(page, id)).toBe(30);
  });

  test('Escape mid-drag restores the position uncounted, and Ctrl+Z undoes a counted move and its feet', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const { id, box } = await setupTrackedToken(canvasPage);

    await pressAndDrag(page, box, id, 3);
    await page.mouse.up();
    await expect.poll(() => feet(page, id)).toBe(15);
    const afterFirst = await tokenPosition(page, id);

    await pressAndDrag(page, box, id, 2);
    await expect.poll(async () => (await tokenPosition(page, id)).x).toBe(afterFirst.x + 2 * CELL);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await tokenPosition(page, id)).toEqual(afterFirst);
    expect(await feet(page, id)).toBe(15);

    await pressAndDrag(page, box, id, 3);
    await page.mouse.up();
    await expect.poll(() => feet(page, id)).toBe(30);
    expect(await tokenPosition(page, id)).toEqual({ x: afterFirst.x + 3 * CELL, y: afterFirst.y });

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => feet(page, id)).toBe(15);
    expect(await tokenPosition(page, id)).toEqual(afterFirst);
  });

  test('a touch drag of three cells counts 15 ft like a mouse drag', async ({ canvasPage }) => {
    const page = canvasPage.page;
    const { id, box } = await setupTrackedToken(canvasPage);
    const start = await tokenPosition(page, id);
    const points = [];
    for (let i = 0; i <= 12; i++) {
      points.push(await tokenScreenCentre(page, box, id, { x: (3 * i) / 12, y: 0 }));
    }

    await singleFingerDraw(page, points);

    await expect.poll(() => feet(page, id)).toBe(15);
    expect(await tokenPosition(page, id)).toEqual({ x: start.x + 3 * CELL, y: start.y });
  });

  test('Misty Step places the token two cells away without spending feet', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const { id, box } = await setupTrackedToken(canvasPage);
    const start = await tokenPosition(page, id);
    const target = await tokenScreenCentre(page, box, id, { x: 2, y: 0 });

    await page.click('#movement-misty-step');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
                toolManager: { activeTool: { name: string } | null };
              }
            ).toolManager.activeTool?.name,
        ),
      )
      .toBe('vtt-place');
    await page.mouse.click(target.x, target.y);

    await expect.poll(async () => (await tokenPosition(page, id)).x).toBe(start.x + 2 * CELL);
    expect(await feet(page, id)).toBe(0);
  });

  test('the live label pill keeps its screen height at zoom 0.25', async ({ canvasPage }) => {
    const page = canvasPage.page;
    const { id, box } = await setupTrackedToken(canvasPage);
    const localCentre = async (): Promise<Point> => {
      const p = await tokenScreenCentre(page, box, id);
      return { x: p.x - box.x, y: p.y - box.y };
    };

    await pressAndDrag(page, box, id, 3);
    const centre = await localCentre();
    await expect.poll(() => labelHeight(page, centre)).toBeGreaterThan(10);
    const atZoom1 = await labelHeight(page, centre);
    await page.mouse.up();

    await page.evaluate((anchor) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoomAt: (level: number, p: Point) => void; zoom: number };
      };
      vp.camera.zoomAt(0.25, anchor);
    }, centre);
    // A 10px token sits inside its own selection handles; deselect so the press drags it.
    const empty = await tokenScreenCentre(page, box, id, { x: 0, y: 8 });
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator('#movement-track')).toBeDisabled();

    await pressAndDrag(page, box, id, 3);
    const zoomedCentre = await localCentre();
    await expect
      .poll(async () => Math.abs((await labelHeight(page, zoomedCentre)) - atZoom1))
      .toBeLessThanOrEqual(2);
    await page.mouse.up();
  });
});
