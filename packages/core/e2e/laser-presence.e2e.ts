import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Live laser pointer building blocks: viewport overlay registration (draws
 * for any active tool), LaserTool trail emission (desktop + touch parity),
 * and RemoteLaserOverlay apply/remove/fade. The demo page exposes
 * `__fieldnotes_viewport` and `__fieldnotes_remote_laser`.
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

interface EmissionShape {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  fadeMs: number;
}

async function subscribeToLaserEmissions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const vp = w.__fieldnotes_viewport as {
      toolManager: {
        getTool: (name: string) => { onTrail: (cb: (e: unknown) => void) => () => void };
      };
    };
    const emissions: unknown[] = [];
    w.__laser_emissions = emissions;
    vp.toolManager.getTool('laser').onTrail((e) => emissions.push(e));
  });
}

async function readEmissions(page: Page): Promise<EmissionShape[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__laser_emissions as EmissionShape[],
  );
}

test.describe('viewport overlay registration', () => {
  test('a registered overlay draws while a tool without renderOverlay is active, and unregisters cleanly', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('pencil'); // active tool has no overlay of its own

    expect(await redPixelCount(canvasPage.page)).toBe(0);

    await canvasPage.page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const vp = w.__fieldnotes_viewport as {
        camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
        registerOverlay: (draw: (ctx: CanvasRenderingContext2D) => void) => () => void;
        requestRender: () => void;
      };
      const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
      const center = vp.camera.screenToWorld({
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2,
      });
      w.__overlay_unregister = vp.registerOverlay((ctx) => {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(center.x - 50, center.y - 50, 100, 100);
      });
    });
    await canvasPage.page.waitForTimeout(200);

    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(1000);
    // Ephemerality: the overlay drew pixels, not elements.
    expect(await canvasPage.getElementCount()).toBe(0);

    await canvasPage.page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      (w.__overlay_unregister as () => void)();
    });
    await canvasPage.page.waitForTimeout(200);

    expect(await redPixelCount(canvasPage.page)).toBe(0);
  });
});

test.describe('laser trail emission', () => {
  test('mouse drawing emits coalesced world-space batches and never creates elements', async ({
    canvasPage,
  }) => {
    await subscribeToLaserEmissions(canvasPage.page);
    await canvasPage.selectTool('laser');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const expectedStart = await canvasPage.page.evaluate(
      (start) => {
        const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
        };
        return vp.camera.screenToWorld(start);
      },
      { x: cx - 100 - box.x, y: cy - box.y },
    );

    await canvasPage.page.mouse.move(cx - 100, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 50, { steps: 12 });
    await canvasPage.page.mouse.up();
    await canvasPage.page.waitForTimeout(300); // let the raf tick flush

    const emissions = await readEmissions(canvasPage.page);
    const totalPoints = emissions.reduce((sum, e) => sum + e.points.length, 0);
    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(totalPoints).toBeGreaterThanOrEqual(5);
    // Coalescing: many pointer events, far fewer per-frame batches.
    expect(emissions.length).toBeLessThan(totalPoints);

    const first = emissions[0];
    expect(first?.color).toBeTruthy();
    expect(first?.width).toBeGreaterThan(0);
    expect(first?.fadeMs).toBeGreaterThan(0);
    expect(Math.abs((first?.points[0]?.x ?? NaN) - expectedStart.x)).toBeLessThan(2);
    expect(Math.abs((first?.points[0]?.y ?? NaN) - expectedStart.y)).toBeLessThan(2);

    // Ephemerality: no elements, nothing to undo.
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('touch drawing emits the same coalesced batches', async ({ canvasPage }) => {
    await subscribeToLaserEmissions(canvasPage.page);
    await canvasPage.selectTool('laser');

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const points = Array.from({ length: 12 }, (_, i) => ({
      x: cx - 80 + i * 15,
      y: cy + i * 5,
    }));
    await singleFingerDraw(canvasPage.page, points);
    await canvasPage.page.waitForTimeout(300);

    const emissions = await readEmissions(canvasPage.page);
    const totalPoints = emissions.reduce((sum, e) => sum + e.points.length, 0);
    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(totalPoints).toBeGreaterThanOrEqual(5);
    expect(emissions.length).toBeLessThan(totalPoints);
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});

test.describe('remote laser overlay', () => {
  async function applyRemoteTrail(
    page: Page,
    sender: string,
    options: { fadeMs?: number } = {},
  ): Promise<boolean> {
    return page.evaluate(
      ({ sender: senderKey, fadeMs }) => {
        const w = window as unknown as Record<string, unknown>;
        const vp = w.__fieldnotes_viewport as {
          camera: { screenToWorld: (p: { x: number; y: number }) => { x: number; y: number } };
        };
        const overlay = w.__fieldnotes_remote_laser as {
          apply: (sender: string, data: unknown) => boolean;
        };
        const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
        const center = vp.camera.screenToWorld({
          x: canvas.clientWidth / 2,
          y: canvas.clientHeight / 2,
        });
        return overlay.apply(senderKey, {
          kind: 'laser',
          points: Array.from({ length: 20 }, (_, i) => ({
            x: center.x - 100 + i * 10,
            y: center.y,
          })),
          color: '#ff0000',
          width: 24,
          ...(fadeMs !== undefined ? { fadeMs } : {}),
        });
      },
      { sender, fadeMs: options.fadeMs },
    );
  }

  test('applies a validated trail for a remote sender and removes it immediately on leave', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('pencil'); // viewer's tool is irrelevant to remote trails

    const malformedAccepted = await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_laser as {
        apply: (sender: string, data: unknown) => boolean;
      };
      return overlay.apply('conn-1', { kind: 'poke', payload: 'not a laser' });
    });
    expect(malformedAccepted).toBe(false);

    expect(await applyRemoteTrail(canvasPage.page, 'conn-1')).toBe(true);
    await canvasPage.page.waitForTimeout(200);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(500);
    expect(await canvasPage.getElementCount()).toBe(0); // presence only, nothing persisted

    await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_laser as {
        remove: (sender: string) => void;
      };
      overlay.remove('conn-1'); // presence-leave
    });
    await canvasPage.page.waitForTimeout(200);
    expect(await redPixelCount(canvasPage.page)).toBe(0);
  });

  test('trails fade out on their own after fadeMs', async ({ canvasPage }) => {
    expect(await applyRemoteTrail(canvasPage.page, 'conn-2', { fadeMs: 400 })).toBe(true);
    await canvasPage.page.waitForTimeout(150);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(0);

    await canvasPage.page.waitForTimeout(900);
    expect(await redPixelCount(canvasPage.page)).toBe(0);

    const activeSenders = await canvasPage.page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_laser as {
        activeSenderCount: number;
      };
      return overlay.activeSenderCount;
    });
    expect(activeSenders).toBe(0);
  });
});
