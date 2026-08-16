import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw, twoFingerPan, twoFingerTakeover } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Movement paths: `PathTool`'s multi-waypoint gesture (desktop click-to-corner,
 * tap-the-last-waypoint / Enter to commit, Escape or a two-finger takeover to
 * abandon) and `RemotePathOverlay`'s apply/remove. The demo page exposes
 * `__fieldnotes_viewport`, `__fieldnotes_remote_path`,
 * `__fieldnotes_path_emissions` (every local emission — active and cleared —
 * converted with `toPathPresence` and applied to the overlay under `'self'`)
 * and `__fieldnotes_path_commits` (raw `PathEmission`s from `onCommit`).
 *
 * The demo's default state has no grid and snapping off, so `PathTool` snaps
 * to identity: a screen point released at is a world point exactly, and
 * pressing the same pixel again matches the last waypoint within 1e-6. Every
 * fixture point is therefore reused verbatim rather than recomputed.
 */

interface Point {
  x: number;
  y: number;
}

type PathPresence =
  | {
      kind: 'path';
      points: Point[];
      segmentColors: string[];
      feet: number;
      color?: string;
    }
  | { kind: 'path'; cleared: true };

type ActivePathPresence = Extract<PathPresence, { feet: number }>;

interface PathCommit {
  waypoints: Point[];
  cursor: Point | null;
  totalFeet: number;
  color: string;
}

function isActivePath(e: PathPresence): e is ActivePathPresence {
  return 'points' in e;
}

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

async function readEmissions(page: Page): Promise<PathPresence[]> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__fieldnotes_path_emissions as PathPresence[],
  );
}

async function readCommits(page: Page): Promise<PathCommit[]> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__fieldnotes_path_commits as PathCommit[],
  );
}

/**
 * Three corners of an L-shaped path, centred on the canvas and computed
 * through the live camera so they hold regardless of pan/zoom. The legs are
 * well over 40px apart so no two waypoints can collide under the tool's 1e-6
 * "same point" test; the returned screen points are page coordinates, ready to
 * hand straight to `page.mouse`.
 */
async function pathCorners(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ screen: Point[]; world: Point[] }> {
  const raw = await page.evaluate(
    ({ cx, cy }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: {
          screenToWorld: (p: Point) => Point;
          worldToScreen: (p: Point) => Point;
        };
      };
      const centre = vp.camera.screenToWorld({ x: cx, y: cy });
      const world = [
        { x: centre.x - 120, y: centre.y - 60 },
        { x: centre.x + 0, y: centre.y - 60 },
        { x: centre.x + 0, y: centre.y + 60 },
      ];
      return { world, screen: world.map((p) => vp.camera.worldToScreen(p)) };
    },
    { cx: box.width / 2, cy: box.height / 2 },
  );
  return {
    world: raw.world,
    screen: raw.screen.map((p) => ({ x: box.x + p.x, y: box.y + p.y })),
  };
}

function at(points: Point[], index: number): Point {
  const point = points[index];
  if (!point) throw new Error(`Missing fixture point ${index}`);
  return point;
}

test.describe('path tool gesture', () => {
  test('drag, click, then tap the last waypoint: one commit with three waypoints, then a clear, and zero elements', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('path');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { screen } = await pathCorners(page, box);
    const [a, b, c] = [at(screen, 0), at(screen, 1), at(screen, 2)];

    // Leg 1: press at A, drag to B, release — B becomes the second waypoint.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Leg 2: click at C — a press/release away from the last waypoint adds it.
    await page.mouse.move(c.x, c.y, { steps: 10 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Commit: press/release on the SAME pixel, which is the last waypoint.
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    const commits = await readCommits(page);
    expect(commits.length).toBe(1);
    const commit = commits[0];
    expect(commit?.waypoints.length).toBe(3);
    expect(commit?.cursor).toBe(null);
    expect(Number.isFinite(commit?.totalFeet ?? NaN)).toBe(true);

    const emissions = await readEmissions(page);
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'path', cleared: true });
    const active = emissions.filter(isActivePath);
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const e of active) {
      expect(e.segmentColors.length).toBe(e.points.length - 1);
      expect(Number.isFinite(e.feet)).toBe(true);
    }

    // Ephemerality: presence only, nothing to undo.
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('Escape cancels an open path without committing', async ({ canvasPage }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('path');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { screen } = await pathCorners(page, box);
    const [a, b] = [at(screen, 0), at(screen, 1)];

    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(150);

    const openEmissions = await readEmissions(page);
    expect(openEmissions.filter(isActivePath).length).toBeGreaterThanOrEqual(1);

    // The canvas wrapper took focus from the pointer gesture, so the keyboard
    // handler's focus scope offers the key to the active tool.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    expect(await readCommits(page)).toHaveLength(0);
    const emissions = await readEmissions(page);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'path', cleared: true });
    expect(await canvasPage.getElementCount()).toBe(0);
  });

  test('Enter commits an open two-waypoint path', async ({ canvasPage }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('path');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { screen } = await pathCorners(page, box);
    const [a, b] = [at(screen, 0), at(screen, 1)];

    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const commits = await readCommits(page);
    expect(commits.length).toBe(1);
    expect(commits[0]?.waypoints.length).toBe(2);
    expect(commits[0]?.cursor).toBe(null);

    const emissions = await readEmissions(page);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'path', cleared: true });
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});

test.describe('remote path overlay', () => {
  test('renders a validated remote path, rejects a malformed one, and removes on presence-leave', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('pencil'); // the viewer's tool is irrelevant to remote paths
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const { world } = await pathCorners(page, box);

    const apply = (data: unknown): Promise<boolean> =>
      page.evaluate((payload) => {
        const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_path as {
          apply: (sender: string, data: unknown) => boolean;
        };
        return overlay.apply('remote-1', payload);
      }, data);

    // One colour per segment is the contract; five colours for two segments is
    // malformed and must be refused outright, leaving nothing on the canvas.
    expect(
      await apply({
        kind: 'path',
        points: world,
        segmentColors: [REMOTE_COLOR, REMOTE_COLOR, REMOTE_COLOR, REMOTE_COLOR, REMOTE_COLOR],
        feet: 30,
        color: REMOTE_COLOR,
      }),
    ).toBe(false);
    await page.waitForTimeout(150);
    expect(await countColorPixels(page, REMOTE_COLOR)).toBe(0);

    expect(
      await apply({
        kind: 'path',
        points: world,
        segmentColors: [REMOTE_COLOR, REMOTE_COLOR],
        feet: 30,
        color: REMOTE_COLOR,
      }),
    ).toBe(true);
    await page.waitForTimeout(200);
    expect(await countColorPixels(page, REMOTE_COLOR)).toBeGreaterThan(20);
    expect(await canvasPage.getElementCount()).toBe(0); // presence only, nothing persisted

    await page.evaluate(() => {
      const overlay = (window as unknown as Record<string, unknown>).__fieldnotes_remote_path as {
        remove: (sender: string) => void;
      };
      overlay.remove('remote-1');
    });
    await page.waitForTimeout(200);
    expect(await countColorPixels(page, REMOTE_COLOR)).toBe(0);
  });
});

test.describe('touch movement paths', () => {
  test('a two-finger pan between legs does not disturb the open path — proven by committing it afterward — and a takeover mid-leg abandons the next one', async ({
    canvasPage,
  }) => {
    const page = canvasPage.page;
    await canvasPage.selectTool('path');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const { screen } = await pathCorners(page, box);
    const [a, b] = [at(screen, 0), at(screen, 1)];

    await singleFingerDraw(page, [a, b]);
    await page.waitForTimeout(200);

    const drawn = await readEmissions(page);
    const active = drawn.filter(isActivePath);
    expect(active.length).toBeGreaterThanOrEqual(1);
    const lastActive = active[active.length - 1];
    expect(lastActive?.points.length).toBe(2); // the path stays open on the second corner
    expect(lastActive?.segmentColors.length).toBe(1);
    expect(await readCommits(page)).toHaveLength(0);

    // Two fingers landing between legs are navigation, not input: the tool is
    // idle so it is never told anything. Re-reading the last emission after
    // the pan can't prove that on its own — nothing new being pushed looks
    // identical whether the pan was ignored or never reached the tool for an
    // unrelated reason — so pin the emission COUNT instead: nothing appended,
    // nothing cleared.
    const beforePanCount = drawn.length;
    await twoFingerPan(page, centre, { x: 60, y: 0 }, 6);
    await page.waitForTimeout(200);

    const afterPan = await readEmissions(page);
    expect(afterPan.length).toBe(beforePanCount);

    // Positive proof the path is still open: committing it now must yield
    // exactly the two waypoints drawn before the pan.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const commits = await readCommits(page);
    expect(commits.length).toBe(1);
    expect(commits[0]?.waypoints.length).toBe(2);

    const afterCommit = await readEmissions(page);
    expect(afterCommit[afterCommit.length - 1]).toEqual({ kind: 'path', cleared: true });

    // A second finger arriving while a FRESH leg is being dragged IS a
    // takeover: the tool is cancelled, so the open path is abandoned, never
    // committed — the commit count from above must not grow.
    await twoFingerTakeover(page, { x: centre.x - 120, y: centre.y + 60 }, { x: 80, y: 0 });
    await page.waitForTimeout(200);

    const emissions = await readEmissions(page);
    expect(emissions[emissions.length - 1]).toEqual({ kind: 'path', cleared: true });
    expect(await readCommits(page)).toHaveLength(1); // the takeover added no commit
    expect(await canvasPage.getElementCount()).toBe(0);
  });
});
