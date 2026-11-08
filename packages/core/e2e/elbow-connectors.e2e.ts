import type { Point, Viewport } from '../src';
import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw, twoFingerTakeover } from './helpers/touch';

declare global {
  interface Window {
    __fieldnotes_viewport?: Viewport;
  }
}

test.describe('elbow connectors', () => {
  test('draws an elbow arrow around an obstacle, moves a bound shape, fixes a segment and undoes', async ({
    canvasPage,
  }, testInfo) => {
    const page = canvasPage.page;
    const touch = testInfo.project.name === 'ipad';
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Canvas wrapper not found');

    const draw = async (from: Point, to: Point) => {
      if (touch) return singleFingerDraw(page, [from, to]);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
    };
    const tap = async (point: Point) => {
      if (!touch) return page.mouse.click(point.x, point.y);
      const client = await page.context().newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: point.x, y: point.y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const dragSegment = async (from: Point, to: Point) => {
      if (!touch) return draw(from, to);
      const client = await page.context().newCDPSession(page);
      const x = from.x + (to.x - from.x) / 8;
      const y = from.y + (to.y - from.y) / 8;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x, y: from.y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: to.x, y: to.y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    const y = box.y + Math.min(450, box.height - 160);
    const source = { x: box.x + 180, y: y - 60 };
    const blocker = { x: box.x + 410, y };
    const target = { x: box.x + 650, y: y + 60 };

    const shapes: readonly [Point, Point][] = [
      [
        { x: source.x - 35, y: source.y - 35 },
        { x: source.x + 35, y: source.y + 35 },
      ],
      [
        { x: blocker.x - 45, y: y - 90 },
        { x: blocker.x + 45, y: y + 90 },
      ],
      [
        { x: target.x - 35, y: target.y - 35 },
        { x: target.x + 35, y: target.y + 35 },
      ],
    ];
    for (const [from, to] of shapes) {
      await canvasPage.selectTool('shape');
      await draw(from, to);
    }
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('shape').length === 3,
    );

    await canvasPage.selectTool('arrow');
    const routing = page.locator('#arrow-routing');
    const resetRoute = page.locator('#arrow-reset-segments');

    await expect(routing).toHaveValue('bezier');
    await routing.selectOption('elbow');
    await draw(source, target);
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('arrow').length === 1,
    );

    const drawn = await page.evaluate(async () => {
      const viewport = window.__fieldnotes_viewport;
      if (!viewport) throw new Error('Demo viewport is not ready');
      const arrow = viewport.store.getElementsByType('arrow')[0];
      if (!arrow) throw new Error('Arrow was not created');
      const svg = await viewport.exportSVG();
      const path = new DOMParser()
        .parseFromString(svg, 'image/svg+xml')
        .querySelector('path[stroke-linecap="round"]');
      return { routing: arrow.routing, path: path?.getAttribute('d') };
    });
    expect(drawn.routing).toBe('elbow');
    expect(drawn.path).toMatch(/^M[^Q]*L/);

    const fromBeforeMove = await page.evaluate(() => {
      const arrow = window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0];
      if (!arrow) throw new Error('Arrow was not created');
      return arrow.from;
    });
    await canvasPage.selectTool('select');
    await draw(source, { x: source.x + 30, y: source.y + 25 });
    await page.waitForFunction((before) => {
      const arrow = window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0];
      return arrow?.from.x !== before.x || arrow?.from.y !== before.y;
    }, fromBeforeMove);

    const arrowHit = await page.evaluate(() => {
      const viewport = window.__fieldnotes_viewport;
      if (!viewport) throw new Error('Demo viewport is not ready');
      const arrow = viewport.store.getElementsByType('arrow')[0];
      if (!arrow) throw new Error('Arrow was not created');
      const rect = viewport.domLayer.getBoundingClientRect();
      for (let y = 120; y < rect.height - 80; y += 8) {
        for (let x = 80; x < rect.width - 80; x += 8) {
          if (viewport.getElementAt(viewport.camera.screenToWorld({ x, y }))?.id === arrow.id) {
            return { x, y };
          }
        }
      }
      throw new Error('Could not find an arrow hit point');
    });
    await tap({ x: box.x + arrowHit.x, y: box.y + arrowHit.y });
    await page.waitForFunction(() => window.__fieldnotes_viewport?.getSelectedIds().length === 1);
    await expect(routing).toHaveValue('elbow');

    const segment = await page.evaluate(async () => {
      const viewport = window.__fieldnotes_viewport;
      if (!viewport) throw new Error('Demo viewport is not ready');
      const svg = await viewport.exportSVG();
      const path = new DOMParser()
        .parseFromString(svg, 'image/svg+xml')
        .querySelector('path[stroke-linecap="round"]');
      const data = path?.getAttribute('d');
      if (!data) throw new Error('Elbow route SVG path is missing');
      const points = [...data.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(
        (match) => ({
          x: Number(match[1]),
          y: Number(match[2]),
        }),
      );
      for (let index = 1; index < points.length - 2; index++) {
        const from = points[index];
        const to = points[index + 1];
        if (from && to && (from.x !== to.x || from.y !== to.y)) {
          return {
            point: viewport.camera.worldToScreen({
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2,
            }),
            horizontal: from.y === to.y,
          };
        }
      }
      throw new Error('Elbow route has no draggable interior segment');
    });
    const segmentStart = { x: box.x + segment.point.x, y: box.y + segment.point.y };
    const segmentEnd = segment.horizontal
      ? { x: segmentStart.x, y: segmentStart.y + 36 }
      : { x: segmentStart.x + 36, y: segmentStart.y };
    await dragSegment(segmentStart, segmentEnd);
    await page.waitForFunction(() =>
      Boolean(
        window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments?.length,
      ),
    );
    await expect(resetRoute).toBeEnabled();

    await page.locator('#undo').click();
    await page.waitForFunction(
      () => !window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments,
    );
    await page.locator('#redo').click();
    await page.waitForFunction(() =>
      Boolean(window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments),
    );
    await resetRoute.click();
    await page.waitForFunction(
      () => !window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments,
    );
    await page.locator('#undo').click();
    await page.waitForFunction(() =>
      Boolean(window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments),
    );

    await routing.selectOption('bezier');
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.routing === 'bezier',
    );
    await expect(routing).toHaveValue('bezier');

    if (touch) {
      await routing.selectOption('elbow');
      const undoCount = await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount);
      await twoFingerTakeover(page, segmentStart, { x: 40, y: 0 });
      expect(await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount)).toBe(
        undoCount,
      );
    }
  });
});
