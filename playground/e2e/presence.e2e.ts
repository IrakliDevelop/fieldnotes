import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { gotoBlank } from './helpers/board';
import { expectNoOverlap, openStyle, zoneBoxes } from './helpers/layout';
import { singleFingerDraw } from './helpers/touch';

/** Clicks Collaborate and returns the guest tab it opens. */
async function collaborate(page: Page): Promise<Page> {
  const [guest] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('[data-collaborate]').click(),
  ]);
  await guest.waitForFunction(() => window.__playground !== undefined);
  // Collaborate leaves its popover open after starting a room.
  await page.keyboard.press('Escape');
  return guest;
}

/** Opens one more guest tab on the host's room link. */
async function joinAnother(page: Page): Promise<Page> {
  const guest = await page.context().newPage();
  await guest.goto(page.url());
  await guest.waitForFunction(() => window.__playground !== undefined);
  return guest;
}

const avatars = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-chrome="top-right"] [data-peer]');

async function hover(page: Page): Promise<void> {
  await page.mouse.move(400, 500);
  await page.mouse.move(420, 520, { steps: 3 });
}

async function drag(page: Page, testInfo: TestInfo): Promise<void> {
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 300 + i * 40, y: 500 + i * 10 }));
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
    return;
  }
  const [first, ...rest] = points;
  if (!first) throw new Error('drag needs points');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

test('cursor presence shows an avatar', async ({ page }) => {
  await gotoBlank(page);
  const guest = await collaborate(page);
  await hover(page);
  await hover(guest);
  await expect(avatars(guest)).toHaveCount(1);
  await expect(avatars(page)).toHaveCount(1);
});

test('laser crosses tabs', async ({ page }, testInfo) => {
  await gotoBlank(page);
  const guest = await collaborate(page);
  await page.keyboard.press('l');
  await drag(page, testInfo);
  await expect
    .poll(() => guest.evaluate(() => window.__playground.laserSenders?.()), { timeout: 1500 })
    .toBe(1);
});

/** Presses at `points[0]` and moves through the rest; the returned function lifts the pointer. */
async function holdStroke(
  page: Page,
  testInfo: TestInfo,
  points: { x: number; y: number }[],
): Promise<() => Promise<void>> {
  const [first, ...rest] = points;
  if (!first) throw new Error('holdStroke needs points');
  if (testInfo.project.name === 'ipad') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...first, id: 1 }],
    });
    for (const point of rest) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...point, id: 1 }],
      });
    }
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
  }
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
  return () => page.mouse.up();
}

test('a stroke previews on the peer before pointer-up, then commits', async ({
  page,
}, testInfo) => {
  await gotoBlank(page);
  const guest = await collaborate(page);
  await page.keyboard.press('3');
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 300 + i * 40, y: 500 + i * 10 }));
  const release = await holdStroke(page, testInfo, points);
  const previews = (): Promise<number | undefined> =>
    guest.evaluate(() => window.__playground.strokePreviews?.());
  const strokes = (): Promise<number> =>
    guest.evaluate(() => window.__playground.viewport.store.getElementsByType('stroke').length);
  await expect.poll(previews, { timeout: 1500 }).toBe(1);
  expect(await strokes()).toBe(0);
  await release();
  await expect.poll(strokes, { timeout: 1500 }).toBe(1);
  expect(await previews()).toBe(0);
});

test('collaborate before the board loads keeps the laser hook', async ({ page }) => {
  await gotoBlank(page);
  // Switching scenes then collaborating in one task joins before IndexedDB restores the board.
  await Promise.all([
    page.context().waitForEvent('page'),
    page.evaluate(() => {
      const topRight = document.querySelector('[data-chrome="top-right"]');
      const tabletop = [...(topRight?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Tabletop',
      );
      tabletop?.click();
      document.querySelector<HTMLElement>('[data-collaborate]')?.click();
    }),
  ]);
  await expect.poll(() => page.evaluate(() => window.__playground.sceneId)).toBe('tabletop');
  expect(await page.evaluate(() => typeof window.__playground.laserSenders)).toBe('function');
});

test('tabletop roles', async ({ page }) => {
  await gotoBlank(page, 'tabletop');
  const guest = await collaborate(page);
  const fogButton = (p: Page): ReturnType<Page['locator']> =>
    p.locator('[data-chrome="tools"]').getByRole('button', { name: 'Fog', exact: true });
  const viewMode = (p: Page): Promise<string | undefined> =>
    p.evaluate(() => window.__playground.fog?.getViewMode());

  await expect(fogButton(page)).toHaveCount(1);
  expect(await viewMode(page)).toBe('editor');
  await expect(fogButton(guest)).toHaveCount(0);
  expect(await viewMode(guest)).toBe('player');
  await expect(guest.getByRole('switch', { name: 'View as player' })).toHaveCount(0);
});

test('guest leaving drops its avatar', async ({ page }) => {
  await gotoBlank(page);
  const guest = await collaborate(page);
  await hover(guest);
  await expect(avatars(page)).toHaveCount(1);
  await guest.close();
  await expect(avatars(page)).toHaveCount(0, { timeout: 3000 });
});

test('avatars do not break the layout', async ({ page }) => {
  await gotoBlank(page);
  await collaborate(page);
  for (let i = 0; i < 3; i++) await joinAnother(page);
  await expect(avatars(page)).toHaveCount(4);
  for (const [width, height] of [
    [1024, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.keyboard.press('3');
    await expect(await openStyle(page)).toBeVisible();
    await expectNoOverlap(page);
  }
});

test('a phone shows a peer count badge with room to spare', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoBlank(page);
  await collaborate(page);
  const toggle = page.locator('[data-collaborate]');
  await expect(toggle).toHaveAttribute('data-peer-count', '1');
  expect(await toggle.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"1"');
  await expect(avatars(page).first()).toBeAttached();
  await expect(toggle.locator('.collab-label')).toBeHidden();
  await expectNoOverlap(page);
  const boxes = await zoneBoxes(page);
  const zoom = boxes.find((b) => b.name === 'zoom');
  const topRight = boxes.find((b) => b.name === 'top-right');
  if (!zoom || !topRight) throw new Error('missing zone');
  expect(topRight.x - (zoom.x + zoom.width)).toBeGreaterThanOrEqual(8);
});
