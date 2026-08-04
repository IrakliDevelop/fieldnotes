import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Map-ping building blocks: PingTool tap-to-ping emission (desktop + touch
 * parity, rate limit) and RemotePingOverlay apply/remove/self-expiry. The
 * demo page exposes `__fieldnotes_viewport` and `__fieldnotes_remote_ping`.
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

async function subscribeToPingEmissions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const vp = w.__fieldnotes_viewport as {
      toolManager: {
        getTool: (name: string) => { onPing: (cb: (e: unknown) => void) => () => void };
      };
    };
    const emissions: unknown[] = [];
    w.__ping_emissions = emissions;
    vp.toolManager.getTool('ping').onPing((e) => emissions.push(e));
  });
}

async function readEmissions(page: Page): Promise<PingEmissionShape[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__ping_emissions as PingEmissionShape[],
  );
}

test.describe('ping tool emission', () => {
  test('a mouse click pings the world position, animates locally, and never creates elements', async ({
    canvasPage,
  }) => {
    await subscribeToPingEmissions(canvasPage.page);
    await canvasPage.selectTool('ping');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const expectedWorld = await canvasPage.page.evaluate(
      (screen) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
        };
        return vp.camera.screenToWorld(screen);
      },
      { x: cx - box.x, y: cy - box.y },
    );

    await canvasPage.page.mouse.click(cx, cy);
    await canvasPage.page.waitForTimeout(150);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBe(1);
    const first = emissions[0];
    expect(Math.abs((first?.x ?? NaN) - expectedWorld.x)).toBeLessThan(2);
    expect(Math.abs((first?.y ?? NaN) - expectedWorld.y)).toBeLessThan(2);
    expect(first?.color).toBeTruthy();
    expect(first?.durationMs).toBeGreaterThan(0);
    expect(first?.radius).toBeGreaterThan(0);

    // The local pulse is drawing (default color is red).
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);

    // Ephemerality: pixels, not elements; nothing to undo.
    expect(await canvasPage.getElementCount()).toBe(0);

    // The pulse self-expires (default 1800ms).
    await canvasPage.page.waitForTimeout(2200);
    expect(await redPixelCount(canvasPage.page)).toBe(0);
  });

  test('rapid clicks are rate-limited to one emission per interval', async ({ canvasPage }) => {
    await subscribeToPingEmissions(canvasPage.page);
    await canvasPage.selectTool('ping');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Three clicks well inside the default 300ms window.
    await canvasPage.page.mouse.click(cx, cy, { delay: 10 });
    await canvasPage.page.mouse.click(cx + 20, cy, { delay: 10 });
    await canvasPage.page.mouse.click(cx + 40, cy, { delay: 10 });
    await canvasPage.page.waitForTimeout(100);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBe(1);
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('a single-finger tap pings like a mouse click', async ({ canvasPage }) => {
    await subscribeToPingEmissions(canvasPage.page);
    await canvasPage.selectTool('ping');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await singleFingerDraw(canvasPage.page, [{ x: cx, y: cy }]);
    await canvasPage.page.waitForTimeout(150);

    const emissions = await readEmissions(canvasPage.page);
    expect(emissions.length).toBe(1);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});

test.describe('remote ping overlay', () => {
  async function applyRemotePing(
    page: Page,
    sender: string,
    options: { durationMs?: number } = {},
  ): Promise<boolean> {
    return page.evaluate(
      ({ sender: senderKey, durationMs }) => {
        const w = window as unknown as Record<string, unknown>;
        const vp = w.__fieldnotes_viewport as {
          camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
        };
        const overlay = w.__fieldnotes_remote_ping as {
          apply: (sender: string, data: unknown) => boolean;
        };
        const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
        const center = vp.camera.screenToWorld({
          x: canvas.clientWidth / 2,
          y: canvas.clientHeight / 2,
        });
        return overlay.apply(senderKey, {
          kind: 'ping',
          x: center.x,
          y: center.y,
          color: '#ff0000',
          radius: 80,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      },
      { sender, durationMs: options.durationMs },
    );
  }

  test('applies a validated ping for a remote sender and removes it immediately on leave', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('pencil'); // viewer's tool is irrelevant to remote pings

    const malformedAccepted = await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_ping as {
        apply: (sender: string, data: unknown) => boolean;
      };
      return (
        overlay.apply('conn-1', { kind: 'poke', payload: 'not a ping' }) ||
        overlay.apply('conn-1', { kind: 'laser', points: [{ x: 0, y: 0 }] })
      );
    });
    expect(malformedAccepted).toBe(false);

    expect(await applyRemotePing(canvasPage.page, 'conn-1', { durationMs: 10_000 })).toBe(true);
    await canvasPage.page.waitForTimeout(200);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(50);
    expect(await canvasPage.getElementCount()).toBe(0); // presence only, nothing persisted

    await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_ping as {
        remove: (sender: string) => void;
      };
      overlay.remove('conn-1'); // presence-leave
    });
    await canvasPage.page.waitForTimeout(200);
    expect(await redPixelCount(canvasPage.page)).toBe(0);
  });

  test('pings self-expire after their duration', async ({ canvasPage }) => {
    expect(await applyRemotePing(canvasPage.page, 'conn-2', { durationMs: 500 })).toBe(true);
    await canvasPage.page.waitForTimeout(150);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(0);

    await canvasPage.page.waitForTimeout(900);
    expect(await redPixelCount(canvasPage.page)).toBe(0);

    const activeSenders = await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_ping as {
        activeSenderCount: number;
      };
      return overlay.activeSenderCount;
    });
    expect(activeSenders).toBe(0);
  });
});
