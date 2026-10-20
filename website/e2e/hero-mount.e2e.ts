import { expect, test, type ElementHandle, type Page } from '@playwright/test';
import { HERO_WRAPPER, openHero } from './helpers';

declare global {
  interface Window {
    __bottomBeforeMount?: number;
  }
}

const HEADLINE = 'Put an infinite canvas in your app.';

function elementCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__hero.viewport.store.getAll().length);
}

function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__hero.viewport.getSelectedIds());
}

async function expectHeadlineIntact(page: Page, h1: ElementHandle): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  expect(await h1.evaluate((node) => node.isConnected)).toBe(true);
  expect(await h1.textContent()).toBe(HEADLINE);
}

async function headlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page
    .locator('[data-element-id]:has(> [data-hero-node="headline"])')
    .boundingBox();
  if (!box) throw new Error('headline is not on the board');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function selectHeadline(page: Page): Promise<void> {
  const centre = await headlineCentre(page);
  await page.mouse.click(centre.x, centre.y);
}

test.describe('hero keeps its server-rendered nodes', () => {
  let h1: ElementHandle;

  test.beforeEach(async ({ page }) => {
    await openHero(page);
    const handle = await page.$('h1');
    if (!handle) throw new Error('no h1');
    h1 = handle;
  });

  test.afterEach(async ({ page }) => {
    await expectHeadlineIntact(page, h1);
  });

  test('undo with no visitor action keeps the seed', async ({ page }) => {
    await page.locator(HERO_WRAPPER).focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ControlOrMeta+z');

    const strokes = await page.evaluate(() => ({
      now: window.__hero.viewport.store.getElementsByType('stroke').length,
      seed: window.__hero.seed.elements.filter((el) => el.type === 'stroke').length,
    }));
    expect(strokes.seed).toBeGreaterThan(0);
    expect(strokes.now).toBe(strokes.seed);
  });

  test('delete, backspace and cut leave the headline', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'the headline is static on phones');
    const before = await elementCount(page);
    await selectHeadline(page);
    for (const key of ['Delete', 'Backspace', 'ControlOrMeta+x']) await page.keyboard.press(key);
    expect(await elementCount(page)).toBe(before);
  });

  test('copy, paste and duplicate add nothing', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'the headline is static on phones');
    const before = await elementCount(page);
    await selectHeadline(page);
    const headlineId = await page.evaluate(() => window.__hero.headlineId);
    expect(
      await page.evaluate(() => document.activeElement?.closest('[data-hero-board]') !== null),
    ).toBe(true);
    expect(await selectedIds(page)).toEqual([headlineId]);

    await page.keyboard.press('ControlOrMeta+c');
    await page
      .locator(HERO_WRAPPER)
      .evaluate((wrapper) => wrapper.dispatchEvent(new ClipboardEvent('paste', { bubbles: true })));
    await page.keyboard.press('ControlOrMeta+d');
    expect(await elementCount(page)).toBe(before);
  });

  test('dragging the headline is one undo step', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'the headline is static on phones');
    const headlineX = (): Promise<number | undefined> =>
      page.evaluate(() => {
        const id = window.__hero.headlineId;
        return id === undefined ? undefined : window.__hero.viewport.store.getById(id)?.position.x;
      });
    const start = await headlineX();
    const centre = await headlineCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 80, centre.y, { steps: 8 });
    await page.mouse.up();
    expect(await headlineX()).toBeCloseTo((start ?? 0) + 80, 0);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await headlineX()).toBe(start);
  });

  test('put it back keeps the nodes', async ({ page }) => {
    await page.evaluate(() => window.__hero.putBack());
  });
});

test('checkbox works on first click', async ({ page }) => {
  await openHero(page);
  const box = page.getByLabel('Install the package');
  await box.click();
  await expect(box).toBeChecked();

  await page.evaluate(() => window.__hero.putBack());
  await expect(box).not.toBeChecked();
});

test('Tab leaves the board', async ({ page }) => {
  await openHero(page);
  const focusable = await page
    .locator('[data-hero-board]')
    .evaluate(
      (board) =>
        board.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])').length,
    );
  const selection = await selectedIds(page);
  const insideBoard = (): Promise<boolean> =>
    page.evaluate(() => document.activeElement?.closest('[data-hero-board]') !== null);

  await page.locator(HERO_WRAPPER).focus();
  for (let i = 0; i <= focusable && (await insideBoard()); i++) {
    await page.keyboard.press('Tab');
    expect(await selectedIds(page)).toEqual(selection);
  }
  expect(await insideBoard()).toBe(false);
});

test('phone keeps text static', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone layout only');
  await openHero(page);
  await expect(page.locator('[data-element-id] h1')).toHaveCount(0);
  const board = await page.locator('[data-hero-board]').boundingBox();
  expect(board?.height).toBeGreaterThanOrEqual(420);
});

test('no layout shift on mount', async ({ page }) => {
  // Registered before the page's own load listener, and fonts.ready settles before mount reads it.
  await page.addInitScript(() => {
    addEventListener('load', () => {
      void document.fonts.ready.then(() => {
        const section = document.querySelector('[data-hero]');
        if (section) window.__bottomBeforeMount = section.getBoundingClientRect().bottom + scrollY;
      });
    });
  });
  await openHero(page);
  const { before, after } = await page.evaluate(() => ({
    before: window.__bottomBeforeMount,
    after: (document.querySelector('[data-hero]')?.getBoundingClientRect().bottom ?? 0) + scrollY,
  }));
  expect(before).toBeDefined();
  expect(Math.abs((before ?? 0) - after)).toBeLessThan(1);
});
