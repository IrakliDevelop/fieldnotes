import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { captureExportedBlobs, gotoBlank } from './helpers/board';
import { openStyle } from './helpers/layout';
import { singleFingerDraw } from './helpers/touch';

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

const widgets = (page: Page, htmlType: string): Promise<{ id: string; data: unknown }[]> =>
  page.evaluate(
    (type) =>
      window.__playground.viewport.store
        .getAll()
        .flatMap((el) => (el.type === 'html' && el.htmlType === type ? [el] : []))
        .map((el) => ({ id: el.id, data: el.data })),
    htmlType,
  );

async function insert(page: Page, label: string, htmlType: string): Promise<string> {
  const tools = page.locator('[data-chrome="tools"]');
  await tools.getByRole('button', { name: 'Insert', exact: true }).click();
  await tools.getByRole('menuitemradio', { name: label }).click();
  await page.mouse.click(400, 500);
  await expect.poll(async () => (await widgets(page, htmlType)).length).toBe(1);
  await expect.poll(() => activeTool(page)).toBe('select');
  const [widget] = await widgets(page, htmlType);
  if (!widget) throw new Error(`no ${htmlType}`);
  return widget.id;
}

/** Double-click (double-tap on iPad) a widget's top edge to enter it. */
async function interact(page: Page, testInfo: TestInfo, id: string): Promise<void> {
  const node = page.locator(`[data-element-id="${id}"]`);
  const box = await node.boundingBox();
  if (!box) throw new Error('widget not visible');
  const point = { x: box.x + 12, y: box.y + 8 };
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, [point]);
    await singleFingerDraw(page, [point]);
  } else {
    await page.mouse.dblclick(point.x, point.y);
  }
  await expect.poll(() => node.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
}

const counterValue = async (page: Page): Promise<unknown> => {
  const [counter] = await widgets(page, 'pg:counter');
  return counter?.data && Reflect.get(counter.data, 'value');
};

test('insert a counter and click + twice', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Counter', 'pg:counter');
  await interact(page, testInfo, id);
  const node = page.locator(`[data-element-id="${id}"]`);
  const plus = node.getByRole('button', { name: 'Increase' });

  await plus.click();
  await plus.click();
  await expect.poll(() => counterValue(page)).toBe(2);

  await page.keyboard.press('Control+z');
  await expect.poll(() => counterValue(page)).toBe(1);
  await expect(node.locator('.pg-counter-value')).toHaveText('1');

  await plus.click();
  await expect.poll(() => counterValue(page)).toBe(2);
  await expect(node.locator('.pg-counter-value')).toHaveText('2');
});

test('widgets survive reload', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Checklist', 'pg:checklist');
  await interact(page, testInfo, id);
  const firstBox = page.locator(`[data-element-id="${id}"] input[type="checkbox"]`).first();
  await firstBox.click();
  await expect(firstBox).toBeChecked();

  // 'state' is IndexedDBAdapter's default store name.
  const saved = (): Promise<string> =>
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
              .get('scene:embeds');
            get.onsuccess = () => {
              db.close();
              resolve(typeof get.result === 'string' ? get.result : '');
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
  await expect.poll(async () => (await saved()).includes('"done":true')).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  await expect(
    page.locator(`[data-element-id="${id}"] input[type="checkbox"]`).first(),
  ).toBeChecked();
});

test('checklist keeps checkbox focus when a remote edit removes the row above', async ({
  page,
}) => {
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Checklist', 'pg:checklist');
  const node = page.locator(`[data-element-id="${id}"]`);
  const [a, b] = await node
    .locator('[data-item-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-item-id')));
  if (!a || !b) throw new Error('expected two checklist items');
  const boxB = node.locator(`[data-item-id="${b}"] input[type="checkbox"]`);
  await boxB.focus();
  await expect(boxB).toBeFocused();

  await page.evaluate(
    ({ id, a }) => {
      const store = window.__playground.viewport.store;
      const el = store.getById(id);
      if (el?.type !== 'html' || typeof el.data !== 'object' || el.data === null) {
        throw new Error('no checklist');
      }
      const items: unknown = Reflect.get(el.data, 'items');
      if (!Array.isArray(items)) throw new Error('no items');
      const kept = items.filter((item: unknown) => Reflect.get(Object(item), 'id') !== a);
      store.update(id, { data: { ...el.data, items: kept } });
    },
    { id, a },
  );

  await expect(node.locator('[data-item-id]')).toHaveCount(1);
  await expect(boxB).toBeFocused();
});

test('typing in a widget never switches tools', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Text card', 'pg:text');
  await interact(page, testInfo, id);
  const node = page.locator(`[data-element-id="${id}"]`);
  await node.getByRole('button', { name: 'Edit' }).click();
  const textarea = node.locator('textarea');
  await expect(textarea).toBeFocused();
  await page.keyboard.type('123abc');
  expect(await activeTool(page)).toBe('select');
  await textarea.blur();
  await expect
    .poll(async () => {
      const [card] = await widgets(page, 'pg:text');
      return String(card?.data && Reflect.get(card.data, 'text'));
    })
    .toContain('123abc');
  expect(await activeTool(page)).toBe('select');
});

test('keys on a non-editable widget target never switch tools', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Counter', 'pg:counter');
  await interact(page, testInfo, id);
  const selector = `[data-element-id="${id}"] button[aria-label="Increase"]`;
  await page.focus(selector);
  await page.keyboard.press('3');
  expect(await activeTool(page)).toBe('select');
});

test('malformed data falls back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoBlank(page, 'embeds');
  await page.evaluate(() => {
    const { viewport } = window.__playground;
    const state: unknown = JSON.parse(viewport.exportJSON());
    if (typeof state !== 'object' || state === null) throw new Error('bad state');
    viewport.loadJSON(
      JSON.stringify({
        ...state,
        elements: [
          {
            id: 'html-bad-chart',
            type: 'html',
            position: { x: 100, y: 100 },
            size: { w: 280, h: 220 },
            zIndex: 0,
            locked: false,
            layerId: viewport.layerManager.activeLayerId,
            htmlType: 'pg:chart',
            data: { bars: 'x' },
          },
        ],
      }),
    );
  });
  await expect(page.locator('[data-element-id="html-bad-chart"] .pg-chart-bar')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('embeds smoke', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/?scene=embeds');
  await page.waitForFunction(() => window.__playground !== undefined);
  for (const type of ['pg:checklist', 'pg:counter', 'pg:palette', 'pg:chart', 'pg:text']) {
    await expect.poll(async () => (await widgets(page, type)).length).toBe(1);
  }
  const count = (): Promise<number> =>
    page.evaluate(() => window.__playground.viewport.store.count);
  const before = await count();

  await page.keyboard.press('6');
  await expect.poll(() => activeTool(page)).toBe('pencil');
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 200 + i * 30, y: 640 + i * 6 }));
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
  await expect.poll(count).toBe(before + 1);
  await page.keyboard.press('Control+z');
  await expect.poll(count).toBe(before);
  expect(errors).toEqual([]);
});

test('export includes widgets', async ({ page }) => {
  const errors = collectErrors(page);
  await captureExportedBlobs(page);
  await page.goto('/?scene=embeds');
  await page.waitForFunction(() => window.__playground !== undefined);
  await expect.poll(async () => (await widgets(page, 'pg:chart')).length).toBe(1);

  const download = page.waitForEvent('download');
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  await page.locator('[data-menu-item="export-png"]').click();
  expect((await download).suggestedFilename()).toBe('fieldnotes-embeds.png');
  const size = await page.evaluate(
    () => (Reflect.get(window, 'exportedBlobs') as Blob[]).at(-1)?.size ?? 0,
  );
  expect(size).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('PNG export paints widget pixels', async ({ page }) => {
  await captureExportedBlobs(page);
  await gotoBlank(page, 'embeds');
  await insert(page, 'Checklist', 'pg:checklist');

  const download = page.waitForEvent('download');
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  await page.locator('[data-menu-item="export-png"]').click();
  await download;
  const { width, painted, total } = await page.evaluate(async () => {
    const blob = (Reflect.get(window, 'exportedBlobs') as Blob[]).at(-1);
    if (!blob) throw new Error('no export');
    const bitmap = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(80, 80, 488, 488);
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) painted++;
    }
    return { width: bitmap.width, painted, total: data.length / 4 };
  });
  expect(width).toBe(648);
  expect(painted / total).toBeGreaterThanOrEqual(0.9);
});

test('palette swatch copies the colour', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoBlank(page, 'embeds');
  const id = await insert(page, 'Palette', 'pg:palette');
  await interact(page, testInfo, id);
  await page
    .locator(`[data-element-id="${id}"]`)
    .getByRole('button', { name: 'Copy #1e88e5' })
    .click();
  await expect(page.locator('[data-chrome="toast"]')).toHaveText('Copied #1e88e5');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#1e88e5');
});

async function pickWidget(page: Page, label: string): Promise<void> {
  const tools = page.locator('[data-chrome="tools"]');
  await tools.getByRole('button', { name: 'Insert', exact: true }).click();
  await tools.getByRole('menuitemradio', { name: label }).click();
  await expect.poll(() => activeTool(page)).toBe('insert');
}

const elementCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

test('Escape cancels insert without adding anything', async ({ page }) => {
  await gotoBlank(page, 'embeds');
  await pickWidget(page, 'Counter');
  // Core keyboard shortcuts and tool keys are scoped to the focused viewport.
  await page.locator('#stage [tabindex]').first().focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => activeTool(page)).toBe('select');
  expect(await elementCount(page)).toBe(0);
});

test('dragging with insert places nothing', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  await pickWidget(page, 'Counter');
  const points = [0, 1, 2, 3, 4].map((i) => ({ x: 300 + i * 20, y: 500 }));
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
  expect(await elementCount(page)).toBe(0);
  expect(await activeTool(page)).toBe('insert');
});

test('pencil in embeds shows the stroke colour control', async ({ page }) => {
  await gotoBlank(page, 'embeds');
  await page.keyboard.press('6');
  await expect.poll(() => activeTool(page)).toBe('pencil');
  await expect((await openStyle(page)).getByRole('group', { name: 'Stroke' })).toBeVisible();
});
