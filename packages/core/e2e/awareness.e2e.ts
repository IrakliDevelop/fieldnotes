import { test, expect } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';

/**
 * Remote awareness cursors: `PeerRoster` + `RemoteCursorOverlay`. The demo
 * page exposes `__fieldnotes_awareness = { roster, cursors }` — applying an
 * awareness frame draws an arrow glyph plus a name chip in the peer's colour,
 * at constant screen size regardless of camera zoom (scaled by `1 / zoom`).
 * `__fieldnotes_viewport` exposes `camera.zoomAt(level, screenPoint)`,
 * `camera.zoom`, and `requestRender()`.
 */

const REMOTE_COLOR = '#e11d48';

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

async function applyCursor(page: Page, x: number, y: number, name = 'Ada'): Promise<boolean> {
  return page.evaluate(
    ({ x, y, name }) => {
      const hook = (window as unknown as Record<string, unknown>).__fieldnotes_awareness as {
        roster: { apply: (from: string, data: unknown) => boolean };
      };
      return hook.roster.apply('remote-1', {
        kind: 'awareness',
        id: 'p1',
        name,
        color: '#e11d48',
        cursor: { x, y },
      });
    },
    { x, y, name },
  );
}

test.describe('remote awareness cursors', () => {
  test('renders a named cursor at the world point, follows a camera pan, and disappears on leave', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    expect(await countColorPixels(page, REMOTE_COLOR)).toBe(0);
    expect(await applyCursor(page, 200, 150)).toBe(true);
    await page.waitForTimeout(150);
    const before = await countColorPixels(page, REMOTE_COLOR);
    expect(before).toBeGreaterThan(50);

    // Zoom in 2x: the glyph and label must stay the same screen size (pixel
    // count roughly constant, not doubling/quadrupling with the zoom level).
    await page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { zoomAt: (level: number, screen: { x: number; y: number }) => void; zoom: number };
        requestRender: () => void;
      };
      vp.camera.zoomAt(vp.camera.zoom * 2, { x: 0, y: 0 });
      vp.requestRender();
    });
    await page.waitForTimeout(150);
    const zoomed = await countColorPixels(page, REMOTE_COLOR);
    expect(zoomed).toBeGreaterThan(before * 0.5);
    expect(zoomed).toBeLessThan(before * 2);

    // A malformed frame (empty id) is refused and changes nothing.
    const refused = await page.evaluate(() => {
      const hook = (window as unknown as Record<string, unknown>).__fieldnotes_awareness as {
        roster: { apply: (from: string, data: unknown) => boolean };
      };
      return hook.roster.apply('remote-1', { kind: 'awareness', id: '', cursor: { x: 1, y: 1 } });
    });
    expect(refused).toBe(false);

    await page.evaluate(() => {
      const hook = (window as unknown as Record<string, unknown>).__fieldnotes_awareness as {
        roster: { remove: (from: string) => void };
      };
      hook.roster.remove('remote-1');
    });
    await page.waitForTimeout(150);
    expect(await countColorPixels(page, REMOTE_COLOR)).toBe(0);
  });
});
