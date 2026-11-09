import type { Point, Viewport } from '../src';
import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';

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
    const readRoute = async () =>
      page.evaluate(async (color) => {
        const viewport = window.__fieldnotes_viewport;
        if (!viewport) throw new Error('Demo viewport is not ready');
        const arrow = viewport.store.getElementsByType('arrow')[0];
        const blocker = viewport.store.getElementsByType('shape')[1];
        if (!arrow || !blocker) throw new Error('Arrow fixture is incomplete');
        const svg = await viewport.exportSVG();
        const paths = [
          ...new DOMParser()
            .parseFromString(svg, 'image/svg+xml')
            .querySelectorAll(`path[stroke="${color}"][stroke-linecap="round"]`),
        ];
        if (paths.length !== 1) throw new Error(`Expected one arrow path, got ${paths.length}`);
        const data = paths[0]?.getAttribute('d');
        if (!data) throw new Error('Elbow route SVG path is missing');
        const matches = [...data.matchAll(/([ML])(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)];
        if (matches.map((match) => match[0]).join(' ') !== data) {
          throw new Error(`Unexpected SVG command in arrow route: ${data}`);
        }
        const points = matches.map((match) => ({ x: Number(match[2]), y: Number(match[3]) }));
        return {
          arrow: { fixedSegments: arrow.fixedSegments, routing: arrow.routing, width: arrow.width },
          blocker: { position: blocker.position, size: blocker.size },
          points,
        };
      }, '#7c3aed');
    const expectAutomaticRoute = (route: Awaited<ReturnType<typeof readRoute>>) => {
      expect(route.arrow.routing).toBe('elbow');
      expect(route.points.length).toBeGreaterThanOrEqual(4);
      const clearance = 12 + route.arrow.width / 2;
      const left = route.blocker.position.x - clearance;
      const right = route.blocker.position.x + route.blocker.size.w + clearance;
      const top = route.blocker.position.y - clearance;
      const bottom = route.blocker.position.y + route.blocker.size.h + clearance;
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1];
        const to = route.points[index];
        if (!from || !to) throw new Error('Route point is missing');
        expect(Number.isFinite(from.x) && Number.isFinite(from.y)).toBe(true);
        expect(from.x === to.x || from.y === to.y).toBe(true);
        expect(from.x !== to.x || from.y !== to.y).toBe(true);
        const minX = Math.min(from.x, to.x);
        const maxX = Math.max(from.x, to.x);
        const minY = Math.min(from.y, to.y);
        const maxY = Math.max(from.y, to.y);
        expect(minX >= right || maxX <= left || minY >= bottom || maxY <= top).toBe(true);
      }
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
    await page.locator('#tool-color').fill('#7c3aed');
    await routing.selectOption('elbow');
    await draw(source, target);
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('arrow').length === 1,
    );

    expectAutomaticRoute(await readRoute());

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
    expectAutomaticRoute(await readRoute());

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

    const routeBeforePin = await readRoute();
    const from = routeBeforePin.points[1];
    const to = routeBeforePin.points[2];
    if (!from || !to) throw new Error('Elbow route has no draggable interior segment');
    const segment = await page.evaluate(
      (world) => {
        const viewport = window.__fieldnotes_viewport;
        if (!viewport) throw new Error('Demo viewport is not ready');
        return viewport.camera.worldToScreen(world);
      },
      { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    );
    const horizontal = from.y === to.y;
    const segmentStart = { x: box.x + segment.x, y: box.y + segment.y };
    const segmentEnd = horizontal
      ? { x: segmentStart.x, y: segmentStart.y + 36 }
      : { x: segmentStart.x + 36, y: segmentStart.y };
    const expectedPin = await page.evaluate(
      ({ point, axis }) => {
        const viewport = window.__fieldnotes_viewport;
        if (!viewport) throw new Error('Demo viewport is not ready');
        const world = viewport.camera.screenToWorld(point);
        return { axis, value: axis === 'x' ? world.x : world.y };
      },
      {
        point: { x: segmentEnd.x - box.x, y: segmentEnd.y - box.y },
        axis: horizontal ? 'y' : 'x',
      },
    );
    const historyBeforePin = await page.evaluate(
      () => window.__fieldnotes_viewport?.history.undoCount,
    );
    expect(routeBeforePin.arrow.fixedSegments).toBeUndefined();
    await dragSegment(segmentStart, segmentEnd);
    await page.waitForFunction((pin) => {
      const arrow = window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0];
      return JSON.stringify(arrow?.fixedSegments) === JSON.stringify([pin]);
    }, expectedPin);
    expect(await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount)).toBe(
      historyBeforePin + 1,
    );
    await expect(resetRoute).toBeEnabled();

    await page.locator('#undo').click();
    await page.waitForFunction((history) => {
      const viewport = window.__fieldnotes_viewport;
      return (
        viewport?.history.undoCount === history &&
        viewport.store.getElementsByType('arrow')[0]?.fixedSegments === undefined
      );
    }, historyBeforePin);
    await page.locator('#redo').click();
    await page.waitForFunction(
      ({ history, pin }) => {
        const viewport = window.__fieldnotes_viewport;
        return (
          viewport?.history.undoCount === history &&
          JSON.stringify(viewport.store.getElementsByType('arrow')[0]?.fixedSegments) ===
            JSON.stringify([pin])
        );
      },
      { history: historyBeforePin + 1, pin: expectedPin },
    );
    await resetRoute.click();
    await page.waitForFunction((history) => {
      const viewport = window.__fieldnotes_viewport;
      return (
        viewport?.history.undoCount === history &&
        viewport.store.getElementsByType('arrow')[0]?.fixedSegments === undefined
      );
    }, historyBeforePin + 2);
    await page.locator('#undo').click();
    await page.waitForFunction(
      ({ history, pin }) => {
        const viewport = window.__fieldnotes_viewport;
        return (
          viewport?.history.undoCount === history &&
          JSON.stringify(viewport.store.getElementsByType('arrow')[0]?.fixedSegments) ===
            JSON.stringify([pin])
        );
      },
      { history: historyBeforePin + 1, pin: expectedPin },
    );

    const historyBeforeRoutingChange = await page.evaluate(
      () => window.__fieldnotes_viewport?.history.undoCount,
    );
    const expectedFixedSegments = Object.freeze([expectedPin]);
    expect(
      await page.evaluate(
        () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments,
      ),
    ).toEqual(expectedFixedSegments);
    await routing.selectOption('bezier');
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.routing === 'bezier',
    );
    await expect(routing).toHaveValue('bezier');
    expect(
      await page.evaluate(
        () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments,
      ),
    ).toEqual(expectedFixedSegments);
    expect(await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount)).toBe(
      historyBeforeRoutingChange + 1,
    );
    await expect(resetRoute).toBeDisabled();

    await routing.selectOption('elbow');
    await page.waitForFunction(
      () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.routing === 'elbow',
    );
    await expect(routing).toHaveValue('elbow');
    expect(
      await page.evaluate(
        () => window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0]?.fixedSegments,
      ),
    ).toEqual(expectedFixedSegments);
    expect(await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount)).toBe(
      historyBeforeRoutingChange + 2,
    );
    await expect(resetRoute).toBeEnabled();

    if (touch) {
      const currentRoute = await readRoute();
      const currentFrom = currentRoute.points[1];
      const currentTo = currentRoute.points[2];
      if (!currentFrom || !currentTo)
        throw new Error('Current elbow route has no interior segment');
      const currentSegment = await page.evaluate(
        (world) => {
          const viewport = window.__fieldnotes_viewport;
          if (!viewport) throw new Error('Demo viewport is not ready');
          return viewport.camera.worldToScreen(world);
        },
        { x: (currentFrom.x + currentTo.x) / 2, y: (currentFrom.y + currentTo.y) / 2 },
      );
      const currentStart = { x: box.x + currentSegment.x, y: box.y + currentSegment.y };
      const currentHorizontal = currentFrom.y === currentTo.y;
      const currentEnd = currentHorizontal
        ? { x: currentStart.x, y: currentStart.y - 36 }
        : { x: currentStart.x - 36, y: currentStart.y };
      const original = await page.evaluate(() => {
        const arrow = window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0];
        if (!arrow) throw new Error('Arrow was not created');
        const { version: _version, editor: _editor, ...authored } = arrow;
        void _version;
        void _editor;
        return authored;
      });
      const undoCount = await page.evaluate(() => window.__fieldnotes_viewport?.history.undoCount);
      const transientPin = await page.evaluate(
        ({ point, axis }) => {
          const viewport = window.__fieldnotes_viewport;
          if (!viewport) throw new Error('Demo viewport is not ready');
          const world = viewport.camera.screenToWorld(point);
          return { axis, value: axis === 'x' ? world.x : world.y };
        },
        {
          point: { x: currentEnd.x - box.x, y: currentEnd.y - box.y },
          axis: currentHorizontal ? 'y' : 'x',
        },
      );
      const client = await page.context().newCDPSession(page);
      const firstMove = {
        x: currentStart.x + (currentEnd.x - currentStart.x) / 8,
        y: currentStart.y + (currentEnd.y - currentStart.y) / 8,
      };
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: currentStart.x, y: currentStart.y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: firstMove.x, y: firstMove.y, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: currentEnd.x, y: currentEnd.y, id: 1 }],
      });
      await page.waitForFunction((pin) => {
        const arrow = window.__fieldnotes_viewport?.store.getElementsByType('arrow')[0];
        return JSON.stringify(arrow?.fixedSegments) === JSON.stringify([pin]);
      }, transientPin);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: currentEnd.x, y: currentEnd.y, id: 1 },
          { x: currentEnd.x + 80, y: currentEnd.y, id: 2 },
        ],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: currentEnd.x + 10, y: currentEnd.y, id: 1 },
          { x: currentEnd.x + 90, y: currentEnd.y, id: 2 },
        ],
      });
      await page.waitForTimeout(100);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(
        ({ expected, history }) => {
          const viewport = window.__fieldnotes_viewport;
          const arrow = viewport?.store.getElementsByType('arrow')[0];
          if (!viewport || !arrow) return false;
          const { version: _version, editor: _editor, ...authored } = arrow;
          void _version;
          void _editor;
          return (
            JSON.stringify(authored) === JSON.stringify(expected) &&
            viewport.history.undoCount === history
          );
        },
        { expected: original, history: undoCount },
      );
    }
  });
});
