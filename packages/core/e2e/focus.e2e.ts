import { test, expect } from './fixtures/canvas-page';
import { pinchGesture } from './helpers/touch';
import type { Page } from '@playwright/test';

/**
 * Camera bookmarks / focus requests: `CameraAnimator` drives the viewport
 * camera and `RemoteFocusReceiver` (role `'player'`) applies focus presence
 * frames, animating to a target `CameraView`, freezing on any local input
 * mid-flight, and marking arrival with one pulse. The demo page exposes
 * `__fieldnotes_focus` — `{ animator, receiver, capture(), focus(view, audience?) }`
 * — mirroring `__fieldnotes_remote_ping` / `__fieldnotes_remote_measure`.
 *
 * The default animation duration is 400ms (see `CameraAnimator`); every
 * "mid-flight" case interrupts at 100ms and every "did it finish" check
 * waits well past 400ms from the focus call, so a broken freeze/cancel would
 * show up as the camera continuing to converge on the target.
 */

interface CameraView {
  x: number;
  y: number;
  w: number;
  h: number;
}

type FocusAudience = 'all' | 'players' | 'display';

function centerOf(view: CameraView): { x: number; y: number } {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function captureView(page: Page): Promise<CameraView> {
  return page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>).__fieldnotes_focus as {
      capture: () => CameraView;
    };
    return hook.capture();
  });
}

async function getVisibleRect(page: Page): Promise<CameraView> {
  return page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      getVisibleRect: () => CameraView;
    };
    return vp.getVisibleRect();
  });
}

/**
 * Reads `CameraAnimator.animating` directly, rather than inferring
 * "still in flight" from position math against `easeOutCubic`. That curve
 * front-loads motion — by 70% of the 400ms duration it has already covered
 * over 97% of the distance — so a distance-based "is it still mid-flight"
 * check is acutely sensitive to ordinary test overhead (an evaluate()
 * round-trip, CDP session setup). The boolean has none of that sensitivity:
 * it is true for the entire [0, 400ms) window regardless of position.
 */
async function isAnimating(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>).__fieldnotes_focus as {
      animator: { animating: boolean };
    };
    return hook.animator.animating;
  });
}

async function focusTo(
  page: Page,
  view: CameraView,
  audience: FocusAudience = 'all',
): Promise<boolean> {
  return page.evaluate(
    ({ view, audience }) => {
      const hook = (window as unknown as Record<string, unknown>).__fieldnotes_focus as {
        focus: (view: CameraView, audience?: FocusAudience) => boolean;
      };
      return hook.focus(view, audience);
    },
    { view, audience },
  );
}

/** Counts strongly red pixels — the arrival pulse's default color (#ff3b30). */
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

/** Same red-pulse heuristic, restricted to a CSS-pixel rectangle of the canvas. */
async function redPixelCountInRegion(
  page: Page,
  region: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate((r) => {
    const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const dpr = canvas.width / canvas.clientWidth;
    const data = ctx.getImageData(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rr = data[i] ?? 0;
      const gg = data[i + 1] ?? 0;
      const bb = data[i + 2] ?? 0;
      if (rr > 200 && gg < 60 && bb < 60) count += 1;
    }
    return count;
  }, region);
}

test.describe('camera focus animation', () => {
  test('animated focus reaches the target view', async ({ canvasPage }) => {
    const start = await captureView(canvasPage.page);
    // Same w/h as the start view (same aspect as the canvas) so the target
    // resolves to a pure pan — isolates "did it arrive" from zoom math.
    const target: CameraView = {
      x: start.x + 2000,
      y: start.y + 1500,
      w: start.w,
      h: start.h,
    };

    expect(await focusTo(canvasPage.page, target)).toBe(true);
    await canvasPage.page.waitForTimeout(700); // well past the 400ms default duration

    const rect = await getVisibleRect(canvasPage.page);
    const gotCenter = centerOf(rect);
    const wantCenter = centerOf(target);
    // A camera that never moved (or an unwired focus) would leave gotCenter
    // near start's center, thousands of world units away from wantCenter.
    expect(Math.abs(gotCenter.x - wantCenter.x)).toBeLessThan(3);
    expect(Math.abs(gotCenter.y - wantCenter.y)).toBeLessThan(3);
  });

  test('pointerdown mid-flight freezes the camera and panning resumes', async ({ canvasPage }) => {
    await canvasPage.selectTool('hand'); // navigation tool: pointer-drag pans
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const start = await captureView(canvasPage.page);
    const target: CameraView = {
      x: start.x + 6000,
      y: start.y + 4000,
      w: start.w,
      h: start.h,
    };
    expect(await focusTo(canvasPage.page, target)).toBe(true);

    await canvasPage.page.waitForTimeout(100); // mid-flight (< 400ms duration)
    // Self-check: genuinely still animating before we interrupt it.
    expect(await isAnimating(canvasPage.page)).toBe(true);

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down(); // pointerdown: must freeze the animator
    // Primary discriminator: the freeze is synchronous, so this must already
    // read false. A broken freeze leaves it true here.
    expect(await isAnimating(canvasPage.page)).toBe(false);
    const frozenRect = await getVisibleRect(canvasPage.page);

    // Total elapsed since the focus call is now well past the 400ms
    // duration; a broken freeze would let the animator keep converging.
    await canvasPage.page.waitForTimeout(500);
    expect(await isAnimating(canvasPage.page)).toBe(false); // never resumed on its own
    const stillFrozenRect = await getVisibleRect(canvasPage.page);
    expect(Math.abs(stillFrozenRect.x - frozenRect.x)).toBeLessThan(1);
    expect(Math.abs(stillFrozenRect.y - frozenRect.y)).toBeLessThan(1);

    await canvasPage.page.mouse.up(); // end the (motionless) hand-tool gesture

    // Normal panning resumes with a fresh drag.
    const beforePan = await getVisibleRect(canvasPage.page);
    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 120, cy + 60, { steps: 6 });
    await canvasPage.page.mouse.up();
    const afterPan = await getVisibleRect(canvasPage.page);
    const panned = distance(centerOf(afterPan), centerOf(beforePan));
    expect(panned).toBeGreaterThan(20);
  });

  test('two-finger pinch mid-flight takes over cleanly', async ({ canvasPage }) => {
    await canvasPage.selectTool('hand');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const start = await captureView(canvasPage.page);
    // A large zoom-out target, well clear of anything a pinch alone would
    // produce.
    const target: CameraView = {
      x: start.x + 6000,
      y: start.y + 4000,
      w: start.w * 4,
      h: start.h * 4,
    };
    expect(await focusTo(canvasPage.page, target)).toBe(true);

    await canvasPage.page.waitForTimeout(100); // mid-flight
    // Self-check: genuinely still animating before the pinch begins.
    expect(await isAnimating(canvasPage.page)).toBe(true);

    // touchStart alone (pointerdown) freezes the animator; the subsequent
    // touchMove sequence then drives zoom normally through the pinch handler.
    await pinchGesture(canvasPage.page, { x: cx, y: cy }, 100, 300, 8);
    // Primary discriminator: the gesture must have ended the animation, not
    // merely written over it for one frame.
    expect(await isAnimating(canvasPage.page)).toBe(false);
    const afterPinch = await getVisibleRect(canvasPage.page);

    // Pinch actually changed the zoom (rect width differs from the start) —
    // it took hold, rather than the animator winning silently. The bar is
    // low deliberately: `isAnimating` above is the real discriminator for
    // "did the takeover happen"; this only rules out a total no-op.
    expect(Math.abs(afterPinch.w - start.w)).toBeGreaterThan(0.5);

    // Elapsed time since the focus call is now well past the 400ms
    // duration. No snap-back: the camera must stay exactly where the pinch
    // left it, not creep toward the target.
    await canvasPage.page.waitForTimeout(500);
    expect(await isAnimating(canvasPage.page)).toBe(false); // never resumed on its own
    const afterWait = await getVisibleRect(canvasPage.page);
    expect(Math.abs(afterWait.x - afterPinch.x)).toBeLessThan(1);
    expect(Math.abs(afterWait.y - afterPinch.y)).toBeLessThan(1);
    expect(Math.abs(afterWait.w - afterPinch.w)).toBeLessThan(1);
  });

  test('wheel mid-flight cancels', async ({ canvasPage }) => {
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const start = await captureView(canvasPage.page);
    const target: CameraView = {
      x: start.x + 6000,
      y: start.y + 4000,
      w: start.w,
      h: start.h,
    };
    expect(await focusTo(canvasPage.page, target)).toBe(true);

    await canvasPage.page.waitForTimeout(100); // mid-flight
    // Self-check: genuinely still animating before the wheel event.
    expect(await isAnimating(canvasPage.page)).toBe(true);

    await canvasPage.page.mouse.move(cx, cy);
    await canvasPage.page.mouse.wheel(0, 100); // wheel: must cancel the animator
    // Primary discriminator: cancellation is synchronous.
    expect(await isAnimating(canvasPage.page)).toBe(false);
    const afterWheel = await getVisibleRect(canvasPage.page);

    // Well past the 400ms duration; a broken cancel would keep converging.
    await canvasPage.page.waitForTimeout(500);
    expect(await isAnimating(canvasPage.page)).toBe(false); // never resumed on its own
    const afterWait = await getVisibleRect(canvasPage.page);
    expect(Math.abs(afterWait.x - afterWheel.x)).toBeLessThan(1);
    expect(Math.abs(afterWait.y - afterWheel.y)).toBeLessThan(1);
  });

  test('the arrival pulse is drawn at the target', async ({ canvasPage }) => {
    await canvasPage.selectTool('pencil'); // active tool is irrelevant to the pulse
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const start = await captureView(canvasPage.page);
    // Same aspect as the start view: the camera lands exactly centered, so
    // the pulse (drawn at the target's world center) projects to the
    // canvas's screen center — a known, checkable location.
    const target: CameraView = {
      x: start.x + 500,
      y: start.y + 300,
      w: start.w,
      h: start.h,
    };
    expect(await focusTo(canvasPage.page, target)).toBe(true);
    await canvasPage.page.waitForTimeout(700); // past the 400ms animation

    // A corner, far from the pulse, must stay background-colored...
    const cornerRegion = {
      x: 0,
      y: 0,
      w: Math.min(80, box.width / 4),
      h: Math.min(80, box.height / 4),
    };
    expect(await redPixelCountInRegion(canvasPage.page, cornerRegion)).toBe(0);
    // ...while the canvas center, where the target now sits, is red.
    const centerRegion = {
      x: box.width / 2 - 40,
      y: box.height / 2 - 40,
      w: 80,
      h: 80,
    };
    expect(await redPixelCountInRegion(canvasPage.page, centerRegion)).toBeGreaterThan(10);
    expect(await redPixelCount(canvasPage.page)).toBeGreaterThan(10);

    // The pulse self-expires (default 1800ms after arrival).
    await canvasPage.page.waitForTimeout(2200);
    expect(await redPixelCount(canvasPage.page)).toBe(0);
  });

  test('a cross-aspect focus frames the same world content', async ({ canvasPage }) => {
    // A rect whose aspect (900:700 ≈ 1.29) sits between desktop-chrome's
    // (1280:720 ≈ 1.78) and iPad's (834:1194 ≈ 0.70): contain-fit pads a
    // different axis on each device, so this genuinely exercises both.
    const target: CameraView = { x: 1000, y: 500, w: 900, h: 700 };
    expect(await focusTo(canvasPage.page, target)).toBe(true);
    await canvasPage.page.waitForTimeout(700); // past the 400ms animation

    const rect = await getVisibleRect(canvasPage.page);
    // Full containment on every edge: contain-fit never crops, only pads.
    // A crop bug would fail at least one of these on one of the two devices.
    expect(rect.x).toBeLessThanOrEqual(target.x + 0.5);
    expect(rect.y).toBeLessThanOrEqual(target.y + 0.5);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(target.x + target.w - 0.5);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(target.y + target.h - 0.5);
  });
});
