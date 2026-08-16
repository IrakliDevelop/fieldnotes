import { test, expect } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';

/**
 * Footprint-aware grid snapping for dragged elements. With a square grid, snap
 * on and smart guides off, `SelectTool` snaps an element's CENTRE through
 * `snapFootprintCenter`: an odd cell axis lands on a cell centre, an even axis
 * on a grid intersection. A 1×1 token therefore stays cell-centred across a
 * drag while a 2×2 token settles on the intersection between its four cells.
 *
 * The demo drives this through its own panel controls (`#grid-type`,
 * `#grid-toggle`, `#snap-toggle`), so the spec also covers the wiring a user
 * actually touches rather than poking the viewport directly.
 */

const CELL = 40;
const EPS = 1e-6;

/** 1×1 transparent PNG — the element's pixels are irrelevant, its box is not. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Point {
  x: number;
  y: number;
}

/**
 * Signed distance from `value` to the nearest grid LINE, in cells, wrapped into
 * (-0.5, 0.5]. `0` means the value sits on an intersection, `±0.5` means it sits
 * on a cell centre. Wrapping keeps the check honest for negative world
 * coordinates, where a raw `%` would flip sign.
 */
function cellOffset(value: number): number {
  const fraction = (((value / CELL) % 1) + 1) % 1;
  return fraction > 0.5 ? fraction - 1 : fraction;
}

async function elementCentre(page: Page, id: string): Promise<Point> {
  return page.evaluate((elementId) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: {
        getById: (id: string) => { position: Point; size: { w: number; h: number } } | undefined;
      };
    };
    const el = vp.store.getById(elementId);
    if (!el) throw new Error(`Element ${elementId} is gone`);
    return { x: el.position.x + el.size.w / 2, y: el.position.y + el.size.h / 2 };
  }, id);
}

/**
 * Drags `id` by a WORLD delta, converting both ends through the live camera so
 * the gesture is zoom-independent. The press lands on the element's centre,
 * well clear of the selection handles at its corners.
 */
async function dragElementBy(
  page: Page,
  box: { x: number; y: number },
  id: string,
  delta: Point,
): Promise<void> {
  const points = await page.evaluate(
    ({ elementId, delta }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: {
          getById: (id: string) => { position: Point; size: { w: number; h: number } } | undefined;
        };
        camera: { worldToScreen: (p: Point) => Point };
      };
      const el = vp.store.getById(elementId);
      if (!el) throw new Error(`Element ${elementId} is gone`);
      const centre = { x: el.position.x + el.size.w / 2, y: el.position.y + el.size.h / 2 };
      return {
        from: vp.camera.worldToScreen(centre),
        to: vp.camera.worldToScreen({ x: centre.x + delta.x, y: centre.y + delta.y }),
      };
    },
    { elementId: id, delta },
  );

  await page.mouse.move(box.x + points.from.x, box.y + points.from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + points.to.x, box.y + points.to.y, { steps: 10 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('select drag snapping on a square grid', () => {
  test('a 1×1 token stays cell-centred and a 2×2 token settles on an intersection', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;

    // Square grid at the panel's default 40px cell. The type must be chosen
    // BEFORE the toggle: the change handler only re-adds an ALREADY active grid.
    await page.selectOption('#grid-type', 'square');
    await page.click('#grid-toggle');
    await expect(page.locator('#grid-cell-size')).toHaveValue(String(CELL));

    const grid = await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        getGridInfo: () => { gridType: string; cellSize: number } | null;
      };
      return vp.getGridInfo();
    });
    expect(grid?.gridType).toBe('square');
    expect(grid?.cellSize).toBe(CELL);

    // Snap is off by default; the toolbar button is the user-facing switch.
    if (
      !(await page.evaluate(
        () => (window as unknown as { viewport: { snapToGrid: boolean } }).viewport.snapToGrid,
      ))
    ) {
      await page.click('#snap-toggle');
    }
    expect(
      await page.evaluate(
        () => (window as unknown as { viewport: { snapToGrid: boolean } }).viewport.snapToGrid,
      ),
    ).toBe(true);

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');

    // A 1×1 token, dropped cell-centred near the middle of the canvas.
    const id = await page.evaluate(
      ({ cx, cy, cell, src }) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          camera: { screenToWorld: (p: Point) => Point };
          addImage: (src: string, p: Point, size: { w: number; h: number }) => string;
        };
        const near = vp.camera.screenToWorld({ x: cx, y: cy });
        const centre = {
          x: (Math.round((near.x - cell / 2) / cell) + 0.5) * cell,
          y: (Math.round((near.y - cell / 2) / cell) + 0.5) * cell,
        };
        return vp.addImage(
          src,
          { x: centre.x - cell / 2, y: centre.y - cell / 2 },
          {
            w: cell,
            h: cell,
          },
        );
      },
      { cx: box.width / 2, cy: box.height / 2, cell: CELL, src: PIXEL_PNG },
    );

    const before = await elementCentre(page, id);
    expect(Math.abs(cellOffset(before.x))).toBeCloseTo(0.5, 6);

    await canvasPage.selectTool('select');
    await dragElementBy(page, box, id, { x: 2 * CELL, y: CELL });

    const afterOdd = await elementCentre(page, id);
    // It really moved, and the odd footprint kept it centred in its cell.
    expect(afterOdd.x).toBeGreaterThan(before.x + EPS);
    expect(afterOdd.y).toBeGreaterThan(before.y + EPS);
    expect(Math.abs(cellOffset(afterOdd.x))).toBeCloseTo(0.5, 6);
    expect(Math.abs(cellOffset(afterOdd.y))).toBeCloseTo(0.5, 6);

    // Grow the same token to 2×2 about its current centre; the drag that
    // follows must now resolve to an intersection, not a cell centre.
    await page.evaluate(
      ({ elementId, centre, cell }) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          store: { update: (id: string, patch: unknown) => void };
          requestRender: () => void;
        };
        vp.store.update(elementId, {
          position: { x: centre.x - cell, y: centre.y - cell },
          size: { w: 2 * cell, h: 2 * cell },
        });
        vp.requestRender();
      },
      { elementId: id, centre: afterOdd, cell: CELL },
    );
    await page.waitForTimeout(150);

    await dragElementBy(page, box, id, { x: 2 * CELL, y: CELL });

    const afterEven = await elementCentre(page, id);
    expect(cellOffset(afterEven.x)).toBeCloseTo(0, 6);
    expect(cellOffset(afterEven.y)).toBeCloseTo(0, 6);
  });
});
