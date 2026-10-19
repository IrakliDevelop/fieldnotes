import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { TemplateTool } from '@fieldnotes/vtt';
import { gotoBlank } from './helpers/board';
import { singleFingerDraw } from './helpers/touch';

async function openSample(page: Page): Promise<void> {
  await page.goto('/?scene=tabletop');
  await page.waitForFunction(() => window.__playground !== undefined);
}

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name);

const count = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

const viewMode = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.fog?.getViewMode());

const fogState = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify(window.__playground.fog?.getState() ?? null));

const gridData = (page: Page): Promise<unknown[]> =>
  page.evaluate(() =>
    window.__playground.viewport.store
      .getAll()
      .flatMap((el) =>
        el.type === 'extension' && el.extensionType === 'vtt:grid' ? [el.data] : [],
      ),
  );

const tokens = (page: Page): Promise<{ id: string; data: unknown }[]> =>
  page.evaluate(() =>
    window.__playground.viewport.store
      .getAll()
      .flatMap((el) => (el.type === 'html' && el.htmlType === 'pg:token' ? [el] : []))
      .map((el) => ({ id: el.id, data: el.data })),
  );

async function drag(
  page: Page,
  testInfo: TestInfo,
  points: { x: number; y: number }[],
): Promise<void> {
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
    return;
  }
  const [first, ...rest] = points;
  if (!first) throw new Error('drag needs points');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
}

/** Screen points along a horizontal line through world `(x0..x1, y)`. */
const worldLine = (
  page: Page,
  x0: number,
  x1: number,
  y: number,
): Promise<{ x: number; y: number }[]> =>
  page.evaluate(
    ({ x0, x1, y }) => {
      const { viewport } = window.__playground;
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('no stage');
      const rect = stage.getBoundingClientRect();
      return [0, 1, 2, 3, 4, 5].map((i) => {
        const p = viewport.camera.worldToScreen({ x: x0 + ((x1 - x0) * i) / 5, y });
        return { x: rect.left + p.x, y: rect.top + p.y };
      });
    },
    { x0, x1, y },
  );

const saved = (page: Page): Promise<string> =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('fieldnotes-playground');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('state')) {
            db.close();
            resolve('');
            return;
          }
          const get = db
            .transaction('state', 'readonly')
            .objectStore('state')
            .get('scene:tabletop');
          get.onsuccess = () => {
            db.close();
            resolve(typeof get.result === 'string' ? get.result : '');
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );

test('loads with grid, tokens and fog, zero console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openSample(page);
  await expect.poll(async () => (await gridData(page)).length).toBe(1);
  await expect.poll(async () => (await tokens(page)).length).toBe(3);
  await expect(page.locator('.pg-token')).toHaveCount(3);
  expect(await fogState(page)).not.toBe('null');
  expect(await viewMode(page)).toBe('editor');

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  expect(await viewMode(page)).toBe('editor');
  expect(errors).toEqual([]);
});

test('View as player', async ({ page }) => {
  await openSample(page);
  await page
    .locator('[data-chrome="tools"]')
    .getByRole('button', { name: 'Fog', exact: true })
    .click();
  const toggle = page
    .locator('[data-chrome="style"]')
    .getByRole('switch', { name: 'View as player' });
  await toggle.click();
  await expect.poll(() => viewMode(page)).toBe('player');
  await toggle.click();
  await expect.poll(() => viewMode(page)).toBe('editor');
});

test('token HP', async ({ page }, testInfo) => {
  await openSample(page);
  await expect.poll(async () => (await tokens(page)).length).toBe(3);
  const goblin = (await tokens(page)).find(
    (token) => token.data && Reflect.get(token.data, 'name') === 'Goblin',
  );
  if (!goblin) throw new Error('no goblin');
  const node = page.locator(`[data-element-id="${goblin.id}"]`);
  const box = await node.boundingBox();
  if (!box) throw new Error('goblin not visible');
  const point = { x: box.x + 12, y: box.y + 8 };
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, [point]);
    await singleFingerDraw(page, [point]);
  } else {
    await page.mouse.dblclick(point.x, point.y);
  }
  await expect.poll(() => node.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');

  const hp = async (): Promise<unknown> => {
    const token = (await tokens(page)).find((t) => t.id === goblin.id);
    return token?.data && Reflect.get(token.data, 'hp');
  };
  await node.getByRole('button', { name: 'Decrease HP' }).click();
  await expect.poll(hp).toBe(6);
  await expect(node.locator('.pg-token-hp')).toHaveText('6 / 7');

  await page.keyboard.press('Control+z');
  await expect.poll(hp).toBe(7);
  await expect(node.locator('.pg-token-hp')).toHaveText('7 / 7');
});

test('grid type', async ({ page }) => {
  await openSample(page);
  await page.locator('[data-chrome="style"]').getByRole('button', { name: 'Square grid' }).click();
  await expect
    .poll(async () => {
      const [grid] = await gridData(page);
      return grid && Reflect.get(grid, 'gridType');
    })
    .toBe('square');
});

test('measure adds nothing; pencil + undo works', async ({ page }, testInfo) => {
  await gotoBlank(page, 'tabletop');
  const line = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 400 + i * 30, y: 260 + i * 6 }));

  await page.keyboard.press('4');
  await expect.poll(() => activeTool(page)).toBe('measure');
  await drag(page, testInfo, line);
  expect(await count(page)).toBe(0);

  await page.keyboard.press('3');
  await expect.poll(() => activeTool(page)).toBe('pencil');
  await drag(page, testInfo, line);
  await expect.poll(() => count(page)).toBe(1);

  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page)).toBe(0);
});

test('fog reveal survives reload', async ({ page }, testInfo) => {
  await openSample(page);
  const before = await fogState(page);
  const savedBefore = await saved(page);

  await page.keyboard.press('6');
  await expect.poll(() => activeTool(page)).toBe('fog');
  // Below the revealed corridor, inside the covered fog bounds.
  await drag(page, testInfo, await worldLine(page, 450, 750, 600));
  await expect.poll(() => fogState(page)).not.toBe(before);
  const after = await fogState(page);
  await expect.poll(() => saved(page)).not.toBe(savedBefore);

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  expect(await fogState(page)).toBe(after);
  expect(after).not.toBe(before);
});

test('picking a flyout item returns focus to the canvas', async ({ page }) => {
  await gotoBlank(page, 'tabletop');
  const tools = page.locator('[data-chrome="tools"]');
  await tools.getByRole('button', { name: 'Template', exact: true }).click();
  await tools.getByRole('menuitemradio', { name: 'Cone' }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.matches('#stage [tabindex]') ?? false))
    .toBe(true);

  await page.keyboard.press('Escape');
  expect(await activeTool(page)).toBe('template');
  expect(
    await page.evaluate(
      () =>
        window.__playground.viewport.toolManager.getTool<TemplateTool>('template')?.getOptions()
          .templateShape,
    ),
  ).toBe('cone');
  expect(await count(page)).toBe(0);
});
