import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';

interface Point {
  x: number;
  y: number;
}

interface FixtureWindow {
  __fieldnotes_viewport: {
    camera: { zoom: number; worldToScreen: (p: Point) => Point };
    store: { getElementsByType: (type: string) => { position: Point }[] };
    setTool: (name: string) => void;
  };
  __fn_passthrough: number;
  __fn_engaged: boolean;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/embedded.html');
  await page.waitForSelector('#canvas #live-btn');
  await page.evaluate(() => document.getElementById('canvas')?.scrollIntoView({ block: 'center' }));
}

async function boardBox(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#canvas > div').boundingBox();
  if (!box) throw new Error('board wrapper not found');
  return box;
}

function setTool(page: Page, name: string): Promise<void> {
  return page.evaluate(
    (n) => (window as unknown as FixtureWindow).__fieldnotes_viewport.setTool(n),
    name,
  );
}

function livePosition(page: Page): Promise<Point | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as FixtureWindow).__fieldnotes_viewport.store.getElementsByType('html')[0]
        ?.position,
  );
}

function strokeCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as FixtureWindow).__fieldnotes_viewport.store.getElementsByType('stroke')
        .length,
  );
}

function readState(page: Page): Promise<{ scrollY: number; zoom: number; passthrough: number }> {
  return page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    return {
      scrollY: window.scrollY,
      zoom: w.__fieldnotes_viewport.camera.zoom,
      passthrough: w.__fn_passthrough,
    };
  });
}

async function waitEngaged(page: Page, engaged: boolean): Promise<void> {
  await page.waitForFunction(
    (e) => (window as unknown as FixtureWindow).__fn_engaged === e,
    engaged,
  );
}

test.describe('embedded board with mouse and wheel', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'ipad', 'mouse and wheel run on desktop projects');
    await openBoard(page);
  });

  for (const tool of ['select', 'pencil']) {
    test(`first click on a live button counts under the ${tool} tool`, async ({ page }) => {
      await setTool(page, tool);
      await page.locator('#live-btn').click();
      await expect(page.locator('#live-count')).toHaveText('1');
      expect(await strokeCount(page)).toBe(0);
    });
  }

  test('first click toggles a live checkbox', async ({ page }) => {
    await page.locator('#live-check').click();
    await expect(page.locator('#live-check')).toBeChecked();
  });

  test('first click on a live link follows it', async ({ page }) => {
    await page.locator('#live-link').click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#linked');
  });

  for (const start of ['#live-title', '#live-img']) {
    test(`padding drag from ${start} moves the element without selecting text`, async ({
      page,
    }) => {
      const before = await livePosition(page);
      const box = await page.locator(start).boundingBox();
      if (!before || !box) throw new Error('live element not found');
      await page.mouse.move(box.x + 8, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 68, box.y + box.height / 2 + 40, { steps: 6 });
      await page.mouse.up();

      expect(await livePosition(page)).toEqual({ x: before.x + 60, y: before.y + 40 });
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
    });
  }

  test('plain wheel over the board scrolls the page and leaves zoom alone', async ({ page }) => {
    const before = await readState(page);
    const board = await boardBox(page);
    await page.mouse.move(board.x + 120, board.y + 200);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((y) => window.scrollY > y, before.scrollY);

    const after = await readState(page);
    expect(after.passthrough).toBeGreaterThanOrEqual(1);
    expect(after.zoom).toBe(before.zoom);
  });

  test('Ctrl+wheel over the board zooms and leaves the page scroll alone', async ({ page }) => {
    const before = await readState(page);
    const board = await boardBox(page);
    await page.mouse.move(board.x + 120, board.y + 200);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForFunction(
      (z) => (window as unknown as FixtureWindow).__fieldnotes_viewport.camera.zoom !== z,
      before.zoom,
    );

    const after = await readState(page);
    expect(after.scrollY).toBe(before.scrollY);
    expect(after.passthrough).toBe(0);
  });

  test('plain wheel still scrolls the page after engaging', async ({ page }) => {
    await page.locator('#engage').click();
    await waitEngaged(page, true);
    const before = await readState(page);
    const board = await boardBox(page);
    await page.mouse.move(board.x + 120, board.y + 200);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((y) => window.scrollY > y, before.scrollY);

    expect((await readState(page)).zoom).toBe(before.zoom);
  });

  test('typing in a live input at the board edge keeps the DOM layer aligned', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__fn_wrapper_scrolls = 0;
      document.querySelector('#canvas > div')?.addEventListener('scroll', () => {
        w.__fn_wrapper_scrolls = Number(w.__fn_wrapper_scrolls) + 1;
      });
    });
    await page.locator('#live-text').click();
    await page.keyboard.type('a long line of text that runs past the edge of the board');

    // The wrapper resets on its scroll event, one frame after the focus or caret scroll.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as unknown as FixtureWindow & { __fn_wrapper_scrolls: number };
          const wrapper = document.querySelector('#canvas > div');
          const node = document.querySelector('#canvas [data-element-id]');
          const position = w.__fieldnotes_viewport.store.getElementsByType('html')[0]?.position;
          if (!wrapper || !node || !position) throw new Error('fixture not ready');
          const expected = w.__fieldnotes_viewport.camera.worldToScreen(position);
          const wrapperRect = wrapper.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          return {
            scrollTop: wrapper.scrollTop,
            scrollLeft: wrapper.scrollLeft,
            dy: Math.round(nodeRect.top - wrapperRect.top - expected.y),
            dx: Math.round(nodeRect.left - wrapperRect.left - expected.x),
            scrolled: w.__fn_wrapper_scrolls > 0,
          };
        }),
      )
      .toEqual({ scrollTop: 0, scrollLeft: 0, dx: 0, dy: 0, scrolled: true });
  });
});

test.describe('embedded board with touch', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad', 'CDP touch emulation is Chromium-only');
    await openBoard(page);
  });

  function swipe(from: Point, dy: number): Point[] {
    return Array.from({ length: 11 }, (_, i) => ({ x: from.x, y: from.y + (dy * i) / 10 }));
  }

  test('one-finger swipe on a disengaged board scrolls the page and draws nothing', async ({
    page,
  }) => {
    await setTool(page, 'pencil');
    const before = await readState(page);
    const board = await boardBox(page);
    await singleFingerDraw(page, swipe({ x: board.x + 120, y: board.y + 350 }, -250));
    await page.waitForFunction((y) => window.scrollY > y, before.scrollY);

    expect(await strokeCount(page)).toBe(0);
  });

  test('tap on a live checkbox toggles it while disengaged', async ({ page }) => {
    await page.locator('#live-check').tap();
    await expect(page.locator('#live-check')).toBeChecked();
  });

  test('one-finger drag after engaging draws a stroke', async ({ page }) => {
    await page.locator('#engage').tap();
    await waitEngaged(page, true);
    await setTool(page, 'pencil');
    const before = await readState(page);
    const board = await boardBox(page);
    await singleFingerDraw(page, swipe({ x: board.x + 120, y: board.y + 350 }, -250));

    await expect.poll(() => strokeCount(page)).toBe(1);
    expect((await readState(page)).scrollY).toBe(before.scrollY);
  });

  test('Escape after engaging disengages the board', async ({ page }) => {
    await page.locator('#engage').tap();
    await waitEngaged(page, true);
    await page.keyboard.press('Escape');
    await waitEngaged(page, false);

    await expect(page.locator('#canvas > div')).toHaveCSS('touch-action', 'manipulation');
  });
});
