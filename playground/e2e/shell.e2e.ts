import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { singleFingerDraw } from './helpers/touch';
import { gotoBlank } from './helpers/board';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name);

const elementCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

test('loads the whiteboard with zero console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoBlank(page);
  expect(await page.evaluate(() => window.__playground.sceneId)).toBe('whiteboard');
  expect(errors).toEqual([]);
});

test('keys switch tools', async ({ page }) => {
  await gotoBlank(page);
  for (const [key, name, label] of [
    ['3', 'pencil', 'Pencil'],
    ['7', 'shape', 'Shape'],
    ['l', 'laser', 'Laser'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => activeTool(page)).toBe(name);
    await expect(
      page.locator('[data-chrome="tools"]').getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
});

test('draw then undo', async ({ page }, testInfo) => {
  await gotoBlank(page);
  await page.keyboard.press('3');
  await expect.poll(() => activeTool(page)).toBe('pencil');
  const before = await elementCount(page);

  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 300 + i * 30, y: 400 + i * 10 }));
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
  } else {
    const [first, ...rest] = points;
    if (!first) throw new Error('no points');
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
    await page.mouse.up();
  }
  await expect.poll(() => elementCount(page)).toBe(before + 1);

  await page.keyboard.press('Control+z');
  await expect.poll(() => elementCount(page)).toBe(before);
});

test('shortcut guard', async ({ page }) => {
  await gotoBlank(page);
  await page.keyboard.press('8');
  await expect.poll(() => activeTool(page)).toBe('note');
  await page.mouse.click(400, 400);
  await expect.poll(() => elementCount(page)).toBe(1);
  const afterPlacement = await activeTool(page);

  await page.keyboard.type('123');
  expect(await activeTool(page)).toBe(afterPlacement);
});

test('scene switching does not leak', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoBlank(page);
  const topRight = page.locator('[data-chrome="top-right"]');
  for (let round = 0; round < 2; round++) {
    for (const [id, label] of [
      ['tabletop', 'Tabletop'],
      ['embeds', 'Embeds'],
      ['whiteboard', 'Whiteboard'],
    ] as const) {
      await topRight.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__playground.sceneId)).toBe(id);
      expect(new URL(page.url()).searchParams.get('scene')).toBe(id);
      expect(await page.locator('#stage > *').count()).toBe(1);
    }
  }
  expect(errors).toEqual([]);
});
