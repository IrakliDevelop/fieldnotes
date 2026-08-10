import { test, expect, CanvasPage } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';
import { pinchGesture, singleFingerDraw, singleFingerHold, twoFingerPan } from './helpers/touch';

/**
 * e2e coverage for the html-painter registry + `ElementActivation` (Task
 * A11). The demo wires a `'demo-marker'` canvas painter (solid #1E88E5 disc
 * + label, `packages/demo/main.ts`) and, by default, a `'double'`-gesture
 * activation surface; navigating with `?activation=single` swaps to a
 * one-tap surface for case 3 / the touch cases.
 *
 * Several properties here are only honestly provable in a real browser:
 * jsdom's `getContext('2d')` returns null in this workspace (see the A8 SVG
 * export unit test, which has to simulate the offscreen canvas), and the
 * unit-level `ElementActivation`/`InputHandler` tests dispatch synthetic
 * events directly rather than going through real `setPointerCapture`,
 * `visibilitychange`, or pan-inertia timing.
 */

const MARKER_COLOR: readonly [number, number, number] = [30, 136, 229]; // #1E88E5
const MARKER_SIZE = { w: 56, h: 56 };

interface WorldPoint {
  x: number;
  y: number;
}

interface PagePoint {
  x: number;
  y: number;
}

interface MarkerActivation {
  element: { id: string; type: string };
  pointerType: string;
  gesture: 'single' | 'double';
}

function isCloseColor(
  actual: readonly number[],
  expected: readonly [number, number, number],
  tolerance = 16,
): boolean {
  return expected.every((v, i) => Math.abs((actual[i] ?? -1000) - v) <= tolerance);
}

/** Navigates directly (bypassing the `canvasPage` fixture's hardcoded `/'`) so
 *  a query string such as `?activation=single` can be applied. */
async function gotoDemo(page: Page, query = ''): Promise<CanvasPage> {
  await page.goto(`/${query}`);
  await page.waitForSelector('#canvas canvas');
  await page.waitForTimeout(500);
  return new CanvasPage(page);
}

/** World point at the exact centre of the current viewport, robust to any
 *  camera pan/zoom that already happened (unlike assuming the fresh-load
 *  identity transform). */
async function viewportWorldCenter(page: Page): Promise<WorldPoint> {
  const rect = await page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      getVisibleRect: () => { x: number; y: number; w: number; h: number };
    };
    return vp.getVisibleRect();
  });
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Adds a `'demo-marker'` html element centred at `center` (world space). */
async function addMarkerAtCenter(
  page: Page,
  center: WorldPoint,
  size: { w: number; h: number } = MARKER_SIZE,
): Promise<string> {
  const position = { x: center.x - size.w / 2, y: center.y - size.h / 2 };
  return page.evaluate(
    ({ position, size }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
          opts?: { htmlType?: string },
        ) => string;
      };
      const dom = document.createElement('div');
      return vp.addHtmlElement(dom, position, size, { htmlType: 'demo-marker' });
    },
    { position, size },
  );
}

/** Converts a world point to page (viewport-absolute) coordinates via the
 *  live camera transform, so it stays correct after any pan/zoom. */
async function toPagePoint(
  page: Page,
  wrapperBox: { x: number; y: number },
  world: WorldPoint,
): Promise<PagePoint> {
  const screen = await page.evaluate((w) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { worldToScreen: (p: WorldPoint) => PagePoint };
    };
    return vp.camera.worldToScreen(w);
  }, world);
  return { x: wrapperBox.x + screen.x, y: wrapperBox.y + screen.y };
}

async function getMarkerActivations(page: Page): Promise<MarkerActivation[]> {
  return page.evaluate(() => {
    const activations = (window as unknown as Record<string, unknown>)
      .__fieldnotes_marker_activations;
    return activations as MarkerActivation[];
  });
}

async function getPainterCallCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const calls = (window as unknown as Record<string, unknown>)
      .__fieldnotes_marker_painter_calls as { count: number };
    return calls.count;
  });
}

/** Samples the live on-screen canvas at a world point, DPR-correct. */
async function samplePixel(page: Page, world: WorldPoint): Promise<number[]> {
  return page.evaluate((w) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { worldToScreen: (p: WorldPoint) => PagePoint };
    };
    const canvas = document.querySelector('#canvas canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas not found');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas has no 2d context');
    const screen = vp.camera.worldToScreen(w);
    const dpr = canvas.width / canvas.clientWidth;
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(screen.x * dpr)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(screen.y * dpr)));
    return [...ctx.getImageData(px, py, 1, 1).data];
  }, world);
}

test.describe('marker painting', () => {
  test('a marker paints its colour at the centre, and not at a known-empty point', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const center = { x: 100 + MARKER_SIZE.w / 2, y: 100 };
    const callsBefore = await getPainterCallCount(page);
    await addMarkerAtCenter(page, center);
    await page.waitForTimeout(300);

    const callsAfter = await getPainterCallCount(page);
    expect(callsAfter).toBeGreaterThan(callsBefore); // the painter really ran

    const centrePixel = await samplePixel(page, center);
    expect(isCloseColor(centrePixel, MARKER_COLOR)).toBe(true);

    // Known-empty: well clear of the marker's bounds, still on-canvas.
    const emptyPoint = { x: center.x + MARKER_SIZE.w + 60, y: center.y };
    const emptyPixel = await samplePixel(page, emptyPoint);
    expect(isCloseColor(emptyPixel, MARKER_COLOR)).toBe(false);
  });

  test('z-order: a marker painted between two shapes shows through only in the middle band', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const center = { x: 200, y: 200 };

    const ids = await page.evaluate(
      ({ center }) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          addShape: (opts: Record<string, unknown>) => string;
          addHtmlElement: (
            dom: HTMLElement,
            position: { x: number; y: number },
            size: { w: number; h: number },
            opts?: { htmlType?: string },
          ) => string;
          store: { update: (id: string, patch: { zIndex: number }) => void };
          requestRender: () => void;
        };
        const square = (half: number) => ({
          position: { x: center.x - half, y: center.y - half },
          size: { w: half * 2, h: half * 2 },
        });

        const bottomId = vp.addShape({
          ...square(60),
          shape: 'rectangle',
          fillColor: '#ff0000',
          strokeWidth: 0,
        });
        const markerId = vp.addHtmlElement(
          document.createElement('div'),
          square(40).position,
          { w: 80, h: 80 },
          { htmlType: 'demo-marker' },
        );
        const topId = vp.addShape({
          ...square(20),
          shape: 'rectangle',
          fillColor: '#00ff00',
          strokeWidth: 0,
        });

        vp.store.update(bottomId, { zIndex: 0 });
        vp.store.update(markerId, { zIndex: 1 });
        vp.store.update(topId, { zIndex: 2 });
        vp.requestRender();
        return { bottomId, markerId, topId };
      },
      { center },
    );

    expect(ids.markerId).toBeTruthy();
    await page.waitForTimeout(300);

    const topPixel = await samplePixel(page, center); // dead centre: green (topmost)
    const bandPixel = await samplePixel(page, { x: center.x + 30, y: center.y }); // marker band
    const outerPixel = await samplePixel(page, { x: center.x + 50, y: center.y }); // bottom only

    expect(isCloseColor(topPixel, [0, 255, 0])).toBe(true);
    expect(isCloseColor(bandPixel, MARKER_COLOR)).toBe(true);
    expect(isCloseColor(outerPixel, [255, 0, 0])).toBe(true);
  });
});

test.describe('marker activation — mouse', () => {
  test("'double' surface: a single click does not activate, a double click activates once", async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const wrapperBox = await canvasPage.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(400); // past the 300ms double-tap window: the half must time out
    expect(await getMarkerActivations(page)).toHaveLength(0);

    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(80);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);
    expect(await getMarkerActivations(page)).toHaveLength(1);
  });

  test("'single' surface: one click activates", async ({ page }) => {
    const cp = await gotoDemo(page, '?activation=single');
    const wrapperBox = await cp.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);
  });
});

test.describe('marker activation — touch', () => {
  test('a touch tap activates; a touch drag beyond slop does not', async ({ page }) => {
    const cp = await gotoDemo(page, '?activation=single');
    const wrapperBox = await cp.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    // Positive control first: a plain tap (down/up, no movement) at these
    // exact coordinates activates, proving the gesture reaches the canvas.
    await singleFingerHold(page, point, 40);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);

    // Same marker, same surface: a drag well past the 8px slop must not add
    // a second activation, even though it starts and ends over the marker.
    await singleFingerDraw(page, [point, { x: point.x + 30, y: point.y }]);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);
  });

  test('a two-finger pinch does not activate, and pinch-zoom navigation still works', async ({
    page,
  }) => {
    const cp = await gotoDemo(page, '?activation=single');
    const wrapperBox = await cp.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    // Positive control first, same coordinates and harness: a one-finger tap
    // here activates, so the two-finger case below isn't "not activating"
    // merely because the marker was never reachable.
    await singleFingerHold(page, point, 40);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);

    const zoomBefore = await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoom: number };
      };
      return vp.camera.zoom;
    });

    // Pinch centred exactly on the marker — the hardest case for a leak.
    await pinchGesture(page, point, 100, 280, 10);
    await page.waitForTimeout(200);

    const zoomAfter = await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoom: number };
      };
      return vp.camera.zoom;
    });

    // Native navigation survives activation being enabled...
    expect(zoomAfter).not.toBe(zoomBefore);
    // ...and the two-pointer gesture never armed a second activation.
    expect(await getMarkerActivations(page)).toHaveLength(1);
  });
});

test.describe('marker export', () => {
  test('export with a painter: the PNG contains real marker pixels', async ({ canvasPage }) => {
    const page = canvasPage.page;
    const size = { w: 60, h: 60 };
    const result = await page.evaluate(
      async ({ size }) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          addHtmlElement: (
            dom: HTMLElement,
            position: { x: number; y: number },
            size: { w: number; h: number },
            opts?: { htmlType?: string },
          ) => string;
          exportImage: (options: Record<string, unknown>) => Promise<Blob | null>;
        };
        vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, size, {
          htmlType: 'demo-marker',
        });
        const blob = await vp.exportImage({
          scale: 1,
          region: { x: 0, y: 0, w: size.w, h: size.h },
        });
        if (!blob) return null;
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          centre: [...ctx.getImageData(size.w / 2, size.h / 2, 1, 1).data],
          corner: [...ctx.getImageData(2, 2, 1, 1).data],
        };
      },
      { size },
    );

    expect(result).not.toBeNull();
    expect(result?.width).toBe(size.w);
    expect(result?.height).toBe(size.h);
    expect(isCloseColor(result?.centre ?? [], MARKER_COLOR)).toBe(true);
    expect(isCloseColor(result?.corner ?? [], MARKER_COLOR)).toBe(false);
  });

  test('export with a painter: the SVG embeds a raster with real marker pixels', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const size = { w: 60, h: 60 };
    const result = await page.evaluate(
      async ({ size }) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          addHtmlElement: (
            dom: HTMLElement,
            position: { x: number; y: number },
            size: { w: number; h: number },
            opts?: { htmlType?: string },
          ) => string;
          exportSVG: (options?: Record<string, unknown>) => Promise<string>;
        };
        vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, size, {
          htmlType: 'demo-marker',
        });
        const svg = await vp.exportSVG();
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const imageEl = doc.querySelector('image');
        if (!imageEl) return null;
        const href = imageEl.getAttribute('href');
        const width = Number(imageEl.getAttribute('width'));
        const height = Number(imageEl.getAttribute('height'));
        if (!href || !(width > 0) || !(height > 0)) return null;

        const img = new Image();
        img.src = href;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        return {
          centre: [...ctx.getImageData(Math.round(width / 2), Math.round(height / 2), 1, 1).data],
          corner: [...ctx.getImageData(2, 2, 1, 1).data],
        };
      },
      { size },
    );

    expect(result).not.toBeNull();
    expect(isCloseColor(result?.centre ?? [], MARKER_COLOR)).toBe(true);
    expect(isCloseColor(result?.corner ?? [], MARKER_COLOR)).toBe(false);
  });

  test('export without a painter under strict mode rejects with HtmlPainterMissingError', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const result = await page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
          opts?: { htmlType?: string },
        ) => string;
        exportImage: (options: {
          strictMissingCanvasHtml: boolean;
          expectedCanvasTypes: Set<string>;
        }) => Promise<Blob | null>;
        exportSVG: (options: {
          strictMissingCanvasHtml: boolean;
          expectedCanvasTypes: Set<string>;
        }) => Promise<string>;
      };
      // Unregistered htmlType — never claimed via expectCanvasHtmlTypes or
      // registerHtmlPainter, only declared per-call so it routes to 'missing'.
      vp.addHtmlElement(
        document.createElement('div'),
        { x: 0, y: 0 },
        { w: 20, h: 20 },
        {
          htmlType: 'e2e-ghost-marker',
        },
      );
      const errorName = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return null;
        } catch (error) {
          return error instanceof Error ? error.name : String(error);
        }
      };
      return {
        image: await errorName(() =>
          vp.exportImage({
            strictMissingCanvasHtml: true,
            expectedCanvasTypes: new Set(['e2e-ghost-marker']),
          }),
        ),
        svg: await errorName(() =>
          vp.exportSVG({
            strictMissingCanvasHtml: true,
            expectedCanvasTypes: new Set(['e2e-ghost-marker']),
          }),
        ),
      };
    });

    expect(result.image).toBe('HtmlPainterMissingError');
    expect(result.svg).toBe('HtmlPainterMissingError');
  });
});

test.describe('marker activation — integration edge cases', () => {
  test('releasing outside the wrapper under real pointer capture does not activate, and a later tap still works', async ({
    page,
  }) => {
    const cp = await gotoDemo(page, '?activation=single');
    const wrapperBox = await cp.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    // Positive control: this exact point, in this exact harness, activates.
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    expect(await getMarkerActivations(page)).toHaveLength(1);

    // Press on the marker, drag past the page edge, release outside. The
    // default 'select' tool would normally drag the marker along with the
    // pointer on this exact gesture — that's fine, and orthogonal to what
    // this case proves — so the marker is expected to end up elsewhere
    // afterward; a fresh marker re-anchors the recovery check below rather
    // than chasing wherever this one was dragged to.
    //
    // InputHandler's `setPointerCapture` keeps the wrapper receiving
    // pointermove/up for the whole gesture even though the cursor leaves it
    // — unlike the bare-controller unit test, which dispatches events
    // directly on the element and never has to prove that. Must not
    // activate: slop is blown long before release either way.
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(-80, -80, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    expect(await getMarkerActivations(page)).toHaveLength(1); // unchanged

    // Recovery: a fresh marker at the same on-screen centre (the camera
    // itself never moved — only the dragged element did) still activates
    // normally, proving the off-canvas release left no stale state behind.
    await addMarkerAtCenter(page, center);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    expect(await getMarkerActivations(page)).toHaveLength(2);
  });

  test('visibilitychange clears a pending tap without permanently disabling activation', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    const wrapperBox = await canvasPage.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center); // default 'double' surface
    const point = await toPagePoint(page, wrapperBox, center);

    // Tap 1 arms a pending half.
    await page.mouse.click(point.x, point.y);
    // Backgrounding: the exact event ElementActivation subscribes to.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    // Tap 2, well within the 300ms double-tap window of tap 1: if the
    // pending half had survived the interrupt, this would pair with it and
    // activate right here. It must not.
    await page.waitForTimeout(60);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(0);

    // Tap 3, close to tap 2: proves activation is not permanently latched
    // off after the interrupt — a fresh double-tap still completes.
    await page.waitForTimeout(60);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);
  });

  test('a tap that stops a pan-inertia coast does not activate the marker beneath it', async ({
    page,
  }) => {
    const cp = await gotoDemo(page, '?activation=single');
    const wrapperBox = await cp.wrapper().boundingBox();
    if (!wrapperBox) throw new Error('Wrapper not found');

    const center = await viewportWorldCenter(page);
    await addMarkerAtCenter(page, center);
    const point = await toPagePoint(page, wrapperBox, center);

    // Positive control: on this ('single') surface, in this harness, a
    // plain tap at these coordinates activates.
    await singleFingerHold(page, point, 40);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1);

    // Start recording camera positions, then flick-pan fast enough to start
    // pan-inertia coasting, and release.
    await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { onChange: (cb: () => void) => () => void; position: { x: number; y: number } };
      };
      const positions: { x: number; y: number }[] = [];
      (window as unknown as Record<string, unknown>)['__markers_coast_positions'] = positions;
      vp.camera.onChange(() => positions.push({ ...vp.camera.position }));
    });
    await twoFingerPan(page, point, { x: 80, y: 0 }, 4);

    // Confirm the camera is still gliding (moving with no further input)
    // before the stopping tap — otherwise this test would prove nothing.
    await page.waitForTimeout(60);
    const coastingPositions = await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>)['__markers_coast_positions'] as {
          x: number;
          y: number;
        }[],
    );
    const distinctCoastPositions = new Set(
      coastingPositions.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`),
    );
    expect(distinctCoastPositions.size).toBeGreaterThan(1);

    // Tap the marker's CURRENT screen location (the camera has panned) while
    // still coasting — this tap's only job is to stop the glide, per spec
    // §5.3, and must not also activate.
    const currentPoint = await toPagePoint(page, wrapperBox, center);
    await singleFingerHold(page, currentPoint, 40);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(1); // unchanged

    // The coast is now stopped; a fresh tap at the (now-static) location
    // activates normally, proving no permanent latch.
    await page.waitForTimeout(400);
    const finalPoint = await toPagePoint(page, wrapperBox, center);
    await singleFingerHold(page, finalPoint, 40);
    await page.waitForTimeout(150);
    expect(await getMarkerActivations(page)).toHaveLength(2);
  });
});
