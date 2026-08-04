import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw, singleFingerHold } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * PingInput: long-press-to-ping and ping-at-cursor alongside the active tool.
 * The demo wires `__fieldnotes_ping_input` into the remote overlay under a
 * `'self'` sender key and binds "g" to `pingAtPointer()` ("p" is the pencil).
 */

/** Counts strongly red pixels on the main canvas (background dots are gray). */
async function redPixelCount(page: Page): Promise<number> {
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
      if (r > 200 && g < 60 && b < 60) count += 1;
    }
    return count;
  });
}

interface PingEmissionShape {
  x: number;
  y: number;
  color: string;
  durationMs: number;
  radius: number;
}

async function subscribeToInputPings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const input = w.__fieldnotes_ping_input as {
      onPing: (cb: (e: unknown) => void) => () => void;
    };
    const emissions: unknown[] = [];
    w.__ping_input_emissions = emissions;
    input.onPing((e) => emissions.push(e));
  });
}

async function readEmissions(page: Page): Promise<PingEmissionShape[]> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__ping_input_emissions as PingEmissionShape[],
  );
}

async function screenToWorld(
  page: Page,
  local: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate((screen) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
    };
    return vp.camera.screenToWorld(screen);
  }, local);
}

test.describe('long-press ping', () => {
  test('a held mouse press pings while the pencil still draws its dot', async ({ canvasPage }) => {
    await subscribeToInputPings(canvasPage.page);
    await canvasPage.selectTool('pencil');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const expectedWorld = await screenToWorld(canvasPage.page, { x: cx - box.x, y: cy - box.y });

    // A 4px wiggle stays inside the 8px slop: the ping still fires while the
    // pencil records a real (dot-sized) stroke, proving zero interference.
    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 4, cy);
    await canvasPage.page.waitForTimeout(800); // past the 600ms long-press delay
    await canvasPage.page.mouse.up();

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBe(1);
    expect(Math.abs((emissions[0]?.x ?? NaN) - expectedWorld.x)).toBeLessThan(2);
    expect(Math.abs((emissions[0]?.y ?? NaN) - expectedWorld.y)).toBeLessThan(2);

    // The self pulse renders through the remote overlay (default ping red).
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);

    // Passive observer: the pencil was never interrupted — its dot exists.
    expect(await canvasPage.getElementCount()).toBe(1);
    expect((await canvasPage.getElementsByType('stroke')).length).toBe(1);
  });

  test('dragging past the slop cancels the ping but not the pencil stroke', async ({
    canvasPage,
  }) => {
    await subscribeToInputPings(canvasPage.page);
    await canvasPage.selectTool('pencil');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 80, cy, { steps: 4 }); // well past 8px slop
    await canvasPage.page.waitForTimeout(800);
    await canvasPage.page.mouse.up();

    expect((await readEmissions(canvasPage.page)).length).toBe(0);
    expect((await canvasPage.getElementsByType('stroke')).length).toBe(1);
  });

  test('a still single-finger touch hold pings', async ({ canvasPage }) => {
    await subscribeToInputPings(canvasPage.page);
    await canvasPage.selectTool('hand'); // navigation tool: hold must still ping

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await singleFingerHold(canvasPage.page, { x: cx, y: cy }, 800);

    expect((await readEmissions(canvasPage.page)).length).toBe(1);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('a moving single-finger drag does not ping', async ({ canvasPage }) => {
    await subscribeToInputPings(canvasPage.page);
    await canvasPage.selectTool('hand');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await singleFingerDraw(canvasPage.page, [
      { x: cx, y: cy },
      { x: cx + 40, y: cy + 10 },
      { x: cx + 90, y: cy + 20 },
    ]);
    await canvasPage.page.waitForTimeout(800);

    expect((await readEmissions(canvasPage.page)).length).toBe(0);
  });

  test('with the ping tool active the shouldPing veto prevents a double ping', async ({
    canvasPage,
  }) => {
    await subscribeToInputPings(canvasPage.page);
    await canvasPage.selectTool('ping');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.waitForTimeout(800);
    await canvasPage.page.mouse.up();

    // The PingTool pinged on pointer down; PingInput stayed silent.
    expect((await readEmissions(canvasPage.page)).length).toBe(0);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);
  });
});

test.describe('ping at cursor', () => {
  test('"g" pings at the hovered position without creating elements', async ({ canvasPage }) => {
    await subscribeToInputPings(canvasPage.page);

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 3;
    const cy = box.y + box.height / 3;
    const expectedWorld = await screenToWorld(canvasPage.page, { x: cx - box.x, y: cy - box.y });

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.keyboard.press('g');
    await canvasPage.page.waitForTimeout(100);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBe(1);
    expect(Math.abs((emissions[0]?.x ?? NaN) - expectedWorld.x)).toBeLessThan(2);
    expect(Math.abs((emissions[0]?.y ?? NaN) - expectedWorld.y)).toBeLessThan(2);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('rapid "g" presses are rate-limited to one ping per interval', async ({ canvasPage }) => {
    await subscribeToInputPings(canvasPage.page);

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');

    await canvasPage.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await canvasPage.page.keyboard.press('g');
    await canvasPage.page.keyboard.press('g');
    await canvasPage.page.keyboard.press('g');
    await canvasPage.page.waitForTimeout(100);

    expect((await readEmissions(canvasPage.page)).length).toBe(1);
  });
});
