import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw, twoFingerPan } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Shared live ruler building blocks: `MeasureTool` drag emission (desktop +
 * touch parity, zero elements created) and `RemoteMeasureOverlay`
 * apply/remove/hold+fade. The demo page exposes `__fieldnotes_viewport`,
 * `__fieldnotes_remote_measure`, and `__fieldnotes_measure_emissions` (every
 * local emission — active and cleared — pushed by the demo's own
 * `measure.onMeasurement` listener, which also applies each one to the
 * overlay under sender `'self'`).
 */

interface Point {
  x: number;
  y: number;
}

type MeasurePresence =
  | { kind: 'measure'; start: Point; end: Point; cells: number; feet: number; color?: string }
  | { kind: 'measure'; cleared: true };

type ActiveMeasurePresence = Extract<MeasurePresence, { feet: number }>;

function isActiveMeasure(e: MeasurePresence): e is ActiveMeasurePresence {
  return 'feet' in e;
}

const DEFAULT_COLOR = '#FF5722';
const REMOTE_COLOR = '#00AA00';

/** Counts opaque canvas pixels within `tolerance` of `hex` (stroke/dots). */
async function countColorPixels(page: Page, hex: string, tolerance = 40): Promise<number> {
  return page.evaluate(
    ({ hex, tolerance }) => {
      const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      const r0 = parseInt(hex.slice(1, 3), 16);
      const g0 = parseInt(hex.slice(3, 5), 16);
      const b0 = parseInt(hex.slice(5, 7), 16);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a < 10) continue;
        if (
          Math.abs(r - r0) <= tolerance &&
          Math.abs(g - g0) <= tolerance &&
          Math.abs(b - b0) <= tolerance
        ) {
          count += 1;
        }
      }
      return count;
    },
    { hex, tolerance },
  );
}

/** Counts near-black canvas pixels — the measurement label's dark pill. */
async function countDarkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (a < 10) continue;
      if (r < 120 && g < 120 && b < 120) count += 1;
    }
    return count;
  });
}

async function readEmissions(page: Page): Promise<MeasurePresence[]> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>)
        .__fieldnotes_measure_emissions as MeasurePresence[],
  );
}

/**
 * A screen segment 144 world units apart, centered on the canvas, computed
 * through the live camera so it holds regardless of pan/zoom. With the
 * demo's default state (no grid, no snap) `MeasureTool`'s math — cells =
 * worldDistance / gridSize(24), feet = cells * feetPerCell(5) — turns this
 * into exactly 6 cells / 30 ft, letting a local drag and a remote apply
 * share one "same world segment" fixture across the label-parity cases.
 */
async function measureSegment(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ screenStart: Point; screenEnd: Point; worldStart: Point; worldEnd: Point }> {
  const raw = await page.evaluate(
    ({ cx, cy, half }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: {
          screenToWorld: (p: Point) => Point;
          worldToScreen: (p: Point) => Point;
        };
      };
      const center = vp.camera.screenToWorld({ x: cx, y: cy });
      const worldStart = { x: center.x - half, y: center.y };
      const worldEnd = { x: center.x + half, y: center.y };
      return {
        worldStart,
        worldEnd,
        screenStart: vp.camera.worldToScreen(worldStart),
        screenEnd: vp.camera.worldToScreen(worldEnd),
      };
    },
    { cx: box.width / 2, cy: box.height / 2, half: 72 },
  );
  return {
    worldStart: raw.worldStart,
    worldEnd: raw.worldEnd,
    screenStart: { x: box.x + raw.screenStart.x, y: box.y + raw.screenStart.y },
    screenEnd: { x: box.x + raw.screenEnd.x, y: box.y + raw.screenEnd.y },
  };
}

async function applyRemoteMeasure(page: Page, sender: string, data: unknown): Promise<boolean> {
  return page.evaluate(
    ({ sender, data }) => {
      const overlay = (window as unknown as Record<string, unknown>)
        .__fieldnotes_remote_measure as { apply: (sender: string, data: unknown) => boolean };
      return overlay.apply(sender, data);
    },
    { sender, data },
  );
}

async function removeRemoteMeasure(page: Page, sender: string): Promise<void> {
  await page.evaluate((sender) => {
    const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_measure as {
      remove: (sender: string) => void;
    };
    overlay.remove(sender);
  }, sender);
}

test.describe('measure tool emission', () => {
  test('a mouse drag emits a live measurement then a clear, and never creates elements', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('measure');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { screenStart, screenEnd } = await measureSegment(canvasPage.page, box);

    await canvasPage.page.mouse.move(screenStart.x, screenStart.y);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(screenEnd.x, screenEnd.y, { steps: 12 });
    await canvasPage.page.waitForTimeout(150); // let the raf tick flush
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(150);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'measure', cleared: true });

    const active = emissions.filter(isActiveMeasure);
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const e of active) {
      expect(Number.isFinite(e.feet)).toBe(true);
      expect(e.color).toBe(DEFAULT_COLOR);
    }

    // Ephemerality: presence only, nothing to undo.
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});

test.describe('remote measure overlay', () => {
  test('applies a validated measurement for a remote sender: segment stroke and label pill both render', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('pencil'); // viewer's tool is irrelevant to remote measurements
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { worldStart, worldEnd } = await measureSegment(canvasPage.page, box);

    const malformedAccepted = await applyRemoteMeasure(canvasPage.page, 'remote-1', {
      kind: 'poke',
      payload: 'not a measurement',
    });
    expect(malformedAccepted).toBe(false);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBe(0);

    const accepted = await applyRemoteMeasure(canvasPage.page, 'remote-1', {
      kind: 'measure',
      start: worldStart,
      end: worldEnd,
      cells: 6,
      feet: 30,
      color: REMOTE_COLOR,
    });
    expect(accepted).toBe(true);
    await canvasPage.page.waitForTimeout(200);

    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBeGreaterThan(20);
    expect(await countDarkPixels(canvasPage.page)).toBeGreaterThan(30);
    expect(await canvasPage.getElementCount()).toBe(0); // presence only, nothing persisted
  });

  test('label parity: a local drag over the same world segment reads 30 ft, matching the remote payload', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('measure');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { screenStart, screenEnd, worldStart, worldEnd } = await measureSegment(
      canvasPage.page,
      box,
    );

    await canvasPage.page.mouse.move(screenStart.x, screenStart.y);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(screenEnd.x, screenEnd.y, { steps: 12 });
    await canvasPage.page.waitForTimeout(150); // let the raf tick flush

    const emissions = await readEmissions(canvasPage.page);
    const active = emissions.filter(isActiveMeasure);
    const lastActive = active[active.length - 1];
    expect(lastActive).toBeTruthy();
    const localFeet = lastActive?.feet ?? NaN;
    expect(Math.round(localFeet)).toBe(30);

    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(150);

    // Remote apply of the exact segment/feet just measured locally must render identically.
    const accepted = await applyRemoteMeasure(canvasPage.page, 'remote-2', {
      kind: 'measure',
      start: worldStart,
      end: worldEnd,
      cells: lastActive?.cells ?? 6,
      feet: localFeet,
      color: REMOTE_COLOR,
    });
    expect(accepted).toBe(true);
    await canvasPage.page.waitForTimeout(200);

    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBeGreaterThan(20);
    expect(await countDarkPixels(canvasPage.page)).toBeGreaterThan(30);
  });

  test('a cleared measurement holds at full opacity, then fades, then is removed', async ({
    canvasPage,
  }) => {
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { worldStart, worldEnd } = await measureSegment(canvasPage.page, box);

    expect(
      await applyRemoteMeasure(canvasPage.page, 'remote-3', {
        kind: 'measure',
        start: worldStart,
        end: worldEnd,
        cells: 6,
        feet: 30,
        color: REMOTE_COLOR,
      }),
    ).toBe(true);
    await canvasPage.page.waitForTimeout(150);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBeGreaterThan(20);

    expect(
      await applyRemoteMeasure(canvasPage.page, 'remote-3', { kind: 'measure', cleared: true }),
    ).toBe(true);

    // Inside the 1500ms hold: still fully visible.
    await canvasPage.page.waitForTimeout(500);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBeGreaterThan(20);
    expect(await countDarkPixels(canvasPage.page)).toBeGreaterThan(30);

    // Well past hold(1500) + fade(400): gone. (500 + 1900 = 2400ms since clear.)
    await canvasPage.page.waitForTimeout(1900);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBe(0);

    const activeSenders = await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>)
        .__fieldnotes_remote_measure as { activeSenderCount: number };
      return overlay.activeSenderCount;
    });
    expect(activeSenders).toBe(0);
  });

  test('presence-leave removes a sender ruler immediately, without waiting for hold/fade', async ({
    canvasPage,
  }) => {
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { worldStart, worldEnd } = await measureSegment(canvasPage.page, box);

    expect(
      await applyRemoteMeasure(canvasPage.page, 'remote-4', {
        kind: 'measure',
        start: worldStart,
        end: worldEnd,
        cells: 6,
        feet: 30,
        color: REMOTE_COLOR,
      }),
    ).toBe(true);
    await canvasPage.page.waitForTimeout(150);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBeGreaterThan(20);

    await removeRemoteMeasure(canvasPage.page, 'remote-4');
    await canvasPage.page.waitForTimeout(150);
    expect(await countColorPixels(canvasPage.page, REMOTE_COLOR)).toBe(0);
  });
});

test.describe('touch measurement', () => {
  test('a single-finger drag measures like a mouse drag and creates zero elements; a two-finger pan emits nothing', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('measure');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const points = Array.from({ length: 12 }, (_, i) => ({
      x: cx - 80 + i * 15,
      y: cy + i * 5,
    }));
    await singleFingerDraw(canvasPage.page, points);
    await canvasPage.page.waitForTimeout(200);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'measure', cleared: true });
    const active = emissions.filter(isActiveMeasure);
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const e of active) expect(Number.isFinite(e.feet)).toBe(true);
    expect(await canvasPage.getElementCount()).toBe(0);

    const beforePanCount = emissions.length;
    await twoFingerPan(canvasPage.page, { x: cx, y: cy }, { x: 60, y: 0 }, 6);
    await canvasPage.page.waitForTimeout(150);

    const afterPan = await readEmissions(canvasPage.page);
    expect(afterPan.length).toBe(beforePanCount); // two fingers navigate; the tool never sees them
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});
