import type { Viewport } from '@fieldnotes/core';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, singleFingerDraw, touchSwipe } from './helpers';

declare global {
  interface Window {
    __docsBoards: Record<string, Viewport>;
  }
}

const BOARD = 'figure[data-live-board="getting-started"]';
const WRAPPER = `${BOARD} [data-live-board-mount] > div[tabindex]`;

async function openBoard(page: Page): Promise<void> {
  await page.goto('/docs/getting-started/?debug-boards');
  await page.locator(BOARD).scrollIntoViewIfNeeded();
  await expect(page.locator(BOARD).getByRole('button', { name: 'Clear board' })).toBeVisible();
}

function strokeCount(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__docsBoards['getting-started']?.store.getElementsByType('stroke').length ?? -1,
  );
}

function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

async function boardCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(WRAPPER).boundingBox();
  if (!box) throw new Error('board is not mounted');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('the live board draws a mouse stroke and Clear board empties it', async ({ page }) => {
  await openBoard(page);
  await expect(page.locator(`${BOARD} .board-placeholder`)).toBeHidden();
  const { x, y } = await boardCentre(page);
  await page.mouse.move(x - 60, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x - 60 + i * 15, y + (i % 2) * 8);
  await page.mouse.up();
  await expect.poll(() => strokeCount(page)).toBe(1);

  await page.locator(BOARD).getByRole('button', { name: 'Clear board' }).click();
  await expect.poll(() => strokeCount(page)).toBe(0);
  await expect(page.locator(WRAPPER)).toHaveCount(1);
});

test('a plain wheel over the board scrolls the page', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'a phone has no wheel');
  await openBoard(page);
  await page.evaluate(() => window.scrollBy(0, -200));
  const { x, y } = await boardCentre(page);
  await page.mouse.move(x, y);
  const before = await scrollY(page);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction((start) => window.scrollY > start, before);
  expect(await page.evaluate(() => window.__docsBoards['getting-started']?.camera.zoom)).toBe(1);
});

test('Tab leaves the board', async ({ page }) => {
  await openBoard(page);
  const focusable = await page
    .locator(`${BOARD} [data-live-board-mount]`)
    .evaluate(
      (mount) =>
        mount.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])').length,
    );
  const insideBoard = (): Promise<boolean> =>
    page.evaluate(() => document.activeElement?.closest('[data-live-board-mount]') !== null);

  await page.locator(WRAPPER).focus();
  for (let i = 0; i <= focusable && (await insideBoard()); i++) await page.keyboard.press('Tab');
  expect(await insideBoard()).toBe(false);
});

test('touch scrolls past the board until Draw on this board engages it', async ({ page }) => {
  test.skip(test.info().project.name !== 'ipad', 'iPad touch only');
  await openBoard(page);
  await page.evaluate(() => window.scrollBy(0, -200));
  const start = await boardCentre(page);
  const before = await scrollY(page);
  await touchSwipe(page, start, { x: start.x, y: start.y - 150 });
  await page.waitForFunction((y) => window.scrollY > y, before);
  expect(await strokeCount(page)).toBe(0);

  const draw = page.locator(BOARD).getByRole('button', { name: 'Draw on this board' });
  await draw.tap();
  const from = await boardCentre(page);
  await singleFingerDraw(
    page,
    Array.from({ length: 9 }, (_, i) => ({ x: from.x - 40 + i * 10, y: from.y + (i % 2) * 6 })),
  );
  await expect.poll(() => strokeCount(page)).toBe(1);

  const done = page.locator(BOARD).getByRole('button', { name: 'Done' });
  // Chrome can drop the click of a tap soon after the stroke; a dropped tap toggles nothing, so retry.
  await expect(async () => {
    await done.tap();
    await expect(draw).toBeVisible({ timeout: 500 });
  }).toPass();
  expect(
    await page.evaluate(() => window.__docsBoards['getting-started']?.isEmbeddedEngaged()),
  ).toBe(false);
});

test('search lists docs results and Enter opens the selected one', async ({ page }) => {
  await page.goto('/docs/using-react/');
  await page.getByRole('searchbox', { name: 'Search the docs' }).fill('viewport');
  const results = page.getByRole('list', { name: 'Search results' }).getByRole('link');
  await expect(results.first()).toHaveAttribute('href', /^\/docs\//);
  const href = await results.first().getAttribute('href');

  await page.keyboard.press('ArrowDown');
  await expect(results.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${href ?? ''}$`));
});

test('search results close on Escape, when focus leaves the box, and when the input clears', async ({
  page,
}) => {
  await page.goto('/docs/getting-started/');
  const input = page.getByRole('searchbox', { name: 'Search the docs' });
  const list = page.locator('[data-search-results]');

  await input.fill('viewport');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(input).toBeFocused();

  await input.fill('viewport');
  await expect(list).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(list).toBeHidden();

  await input.fill('viewport');
  await expect(list).toBeVisible();
  // The page's left padding at the bottom edge is clear of the results list and every link.
  await page.mouse.click(1, (page.viewportSize()?.height ?? 1) - 1);
  await expect(list).toBeHidden();

  await input.fill('viewport');
  await expect(list).toBeVisible();
  await input.fill('');
  await expect(list).toBeHidden();
});

test('only the latest query renders its results', async ({ page }) => {
  await page.goto('/docs/getting-started/');
  const input = page.getByRole('searchbox', { name: 'Search the docs' });
  const links = page.getByRole('list', { name: 'Search results' }).getByRole('link');

  // Hold the first query's result fragment until the second query has rendered.
  const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
  let first = true;
  await page.route('**/pagefind/fragment/*', async (route) => {
    if (first) {
      first = false;
      await held;
    }
    await route.continue();
  });

  const stale = page.waitForResponse('**/pagefind/fragment/*');
  await input.fill('debounced');
  await page.waitForRequest('**/pagefind/fragment/*');
  await input.fill('container');
  await expect(links).toHaveCount(1);
  await expect(links.first()).toHaveAttribute('href', '/docs/getting-started/');

  release(undefined);
  await (await stale).finished();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));
  expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))).toEqual([
    '/docs/getting-started/',
  ]);
});

test('a docs page has no horizontal scroll on a phone', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone width only');
  await page.goto('/docs/getting-started/');
  await page.getByRole('searchbox', { name: 'Search the docs' }).waitFor();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // `isMobile` widens `innerWidth` to fit overflowing content, so compare with the device width.
  expect(scrollWidth).toBeLessThanOrEqual(360);
});

test('a mounted board with search results has no axe violations', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('searchbox', { name: 'Search the docs' }).fill('viewport');
  await expect(
    page.getByRole('list', { name: 'Search results' }).getByRole('link').first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});
