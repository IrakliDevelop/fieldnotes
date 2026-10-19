import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { singleFingerDraw } from './helpers/touch';
import { gotoBlank } from './helpers/board';
import { expectNoOverlap } from './helpers/layout';

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name);

async function drag(
  page: Page,
  isTouch: boolean,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({
    x: from.x + ((to.x - from.x) * i) / 5,
    y: from.y + ((to.y - from.y) * i) / 5,
  }));
  if (isTouch) {
    await singleFingerDraw(page, points);
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [834, 1194],
  [390, 844],
] as const) {
  test(`chrome zones do not overlap at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoBlank(page);
    await page.keyboard.press('3');
    const style = page.locator('[data-chrome="style"]');
    await expect(style).toBeVisible();
    await expectNoOverlap(page);

    const toggle = page.locator('[data-chrome="top-right"]').getByRole('button', {
      name: 'Layers',
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-chrome="layers"]')).toBeVisible();
    await expectNoOverlap(page);
  });
}

test('style applies to selection', async ({ page }, testInfo) => {
  await gotoBlank(page);
  const isTouch = testInfo.project.name === 'ipad';
  await page.keyboard.press('7');
  await drag(page, isTouch, { x: 300, y: 300 }, { x: 500, y: 450 });
  const strokeColor = (): Promise<string | undefined> =>
    page.evaluate(() => {
      const shape = window.__playground.viewport.store.getAll().find((el) => el.type === 'shape');
      return shape?.type === 'shape' ? shape.strokeColor : undefined;
    });
  const original = await strokeColor();
  expect(original).not.toBe('#e03131');

  await page.keyboard.press('1');
  await page.mouse.click(300, 375);
  await expect
    .poll(() => page.evaluate(() => window.__playground.viewport.getSelectedIds().length))
    .toBe(1);
  await page
    .locator('[data-chrome="style"]')
    .getByRole('group', { name: 'Stroke' })
    .getByRole('button', { name: '#e03131' })
    .click();
  await expect.poll(strokeColor).toBe('#e03131');

  await page.keyboard.press('Control+z');
  await expect.poll(strokeColor).toBe(original);
});

test('layers', async ({ page }) => {
  await gotoBlank(page);
  await page.keyboard.press('4');
  await expect.poll(() => activeTool(page)).toBe('highlighter');
  const layerNames = (): Promise<string[]> =>
    page.evaluate(() => window.__playground.viewport.layerManager.getLayers().map((l) => l.name));

  await page.locator('[data-chrome="top-right"]').getByRole('button', { name: 'Layers' }).click();
  const drawer = page.locator('[data-chrome="layers"]');
  await drawer.getByRole('button', { name: 'Add layer' }).click();
  await expect.poll(layerNames).toEqual(['Layer 1', 'Layer 2']);

  await drawer.getByText('Layer 2', { exact: true }).dblclick();
  const input = drawer.getByRole('textbox', { name: 'Layer name' });
  await expect(input).toBeFocused();
  await input.fill('');
  await page.keyboard.type('Ink123');
  await page.keyboard.press('Enter');
  await expect.poll(layerNames).toEqual(['Layer 1', 'Ink123']);
  expect(await activeTool(page)).toBe('highlighter');

  await drawer.getByRole('button', { name: 'Hide Ink123' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__playground.viewport.layerManager.getLayers().find((l) => l.name === 'Ink123')
            ?.visible,
      ),
    )
    .toBe(false);

  await drawer.getByRole('button', { name: 'Delete Ink123' }).click();
  await expect.poll(layerNames).toEqual(['Layer 1']);
  await expect(drawer.getByRole('button', { name: 'Delete Layer 1' })).toBeDisabled();
});

for (const [width, height] of [
  [1024, 768],
  [960, 720],
] as const) {
  test(`header row never overlaps when the pill is wide at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'wide layout needs a fine pointer');
    await page.setViewportSize({ width, height });
    await gotoBlank(page);
    await page.evaluate(() => {
      const pill = document.querySelector('[data-chrome="tools"]');
      const first = pill?.querySelector('button');
      if (!pill || !first) throw new Error('No tool pill');
      for (let i = 0; i < 8; i++) pill.append(first.cloneNode(true));
    });
    await expectNoOverlap(page);
    expect(
      await page
        .locator('[data-chrome="tools"]')
        .evaluate((pill) => pill.scrollWidth > pill.clientWidth),
    ).toBe(true);
  });
}

test('style panel reflects undo', async ({ page }, testInfo) => {
  await gotoBlank(page);
  await page.keyboard.press('7');
  await drag(page, testInfo.project.name === 'ipad', { x: 300, y: 300 }, { x: 500, y: 450 });
  const original = await page.evaluate(() => {
    const shape = window.__playground.viewport.store.getAll().find((el) => el.type === 'shape');
    return shape?.type === 'shape' ? shape.strokeColor : undefined;
  });
  await page.keyboard.press('1');
  await page.mouse.click(300, 375);
  await expect
    .poll(() => page.evaluate(() => window.__playground.viewport.getSelectedIds().length))
    .toBe(1);
  const stroke = page.locator('[data-chrome="style"]').getByRole('group', { name: 'Stroke' });
  const red = stroke.getByRole('button', { name: '#e03131' });
  await red.click();
  await expect(red).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Control+z');
  await expect(red).toHaveAttribute('aria-pressed', 'false');
  const originalSwatch = stroke.getByRole('button', { name: original ?? '', exact: true });
  if ((await originalSwatch.count()) > 0) {
    await expect(originalSwatch).toHaveAttribute('aria-pressed', 'true');
  }
});

test('style panel resyncs at most once per frame while dragging a large selection', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'mouse drag');
  await gotoBlank(page);
  await page.keyboard.press('7');
  await drag(page, false, { x: 300, y: 300 }, { x: 500, y: 450 });
  await page.keyboard.press('1');
  await page.evaluate(() => {
    const { viewport } = window.__playground;
    const shape = viewport.store.getAll().find((el) => el.type === 'shape');
    if (!shape) throw new Error('No shape');
    viewport.transaction(() => {
      for (let i = 0; i < 200; i++) {
        viewport.store.add({
          ...shape,
          id: `bulk-${i}`,
          position: { x: 600 + (i % 20) * 30, y: 100 + Math.floor(i / 20) * 30 },
        });
      }
    });
    viewport.actions.run('select.all', { source: 'api' });
  });
  await expect
    .poll(() => page.evaluate(() => window.__playground.viewport.getSelectedIds().length))
    .toBe(201);
  const calls = await page.evaluateHandle(() => {
    const { viewport } = window.__playground;
    const counter = { n: 0 };
    const original = viewport.getSelectionStyleDetails.bind(viewport);
    viewport.getSelectionStyleDetails = () => {
      counter.n++;
      return original();
    };
    return counter;
  });
  await page.mouse.move(300, 375);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(300 + i * 4, 375);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.__playground.viewport.store.getById('bulk-0')?.position.x ?? 0),
    )
    .toBeGreaterThan(600);
  expect(await calls.evaluate((counter) => counter.n)).toBeLessThan(50);
});

async function openLayers(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-chrome="top-right"]').getByRole('button', { name: 'Layers' }).click();
  return page.locator('[data-chrome="layers"]');
}

const layerNames = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__playground.viewport.layerManager.getLayers().map((l) => l.name));

test('layer names stay unique', async ({ page }) => {
  await gotoBlank(page);
  const drawer = await openLayers(page);
  const add = drawer.getByRole('button', { name: 'Add layer' });
  await add.click();
  await add.click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
  await drawer.getByRole('button', { name: 'Delete Layer 2' }).click();
  await add.click();
  await expect.poll(async () => (await layerNames(page)).length).toBe(3);
  const names = await layerNames(page);
  expect(new Set(names).size).toBe(names.length);
});

test('rename an inactive layer with the keyboard', async ({ page }) => {
  await gotoBlank(page);
  const drawer = await openLayers(page);
  await drawer.getByRole('button', { name: 'Add layer' }).click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2']);

  const name = drawer.getByRole('button', { name: 'Layer 1', exact: true });
  await name.focus();
  await page.keyboard.press('F2');
  const input = drawer.getByRole('textbox', { name: 'Layer name' });
  await expect(input).toBeFocused();
  await input.fill('Ink');
  await page.keyboard.press('Enter');
  await expect.poll(() => layerNames(page)).toEqual(['Ink', 'Layer 2']);

  await drawer.getByRole('button', { name: 'Ink', exact: true }).focus();
  await page.keyboard.press('F2');
  await expect(input).toBeFocused();
  await input.fill('x');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  expect(await layerNames(page)).toEqual(['Ink', 'Layer 2']);
});

test('undo right after a layer action', async ({ page }) => {
  await gotoBlank(page);
  await page.mouse.click(400, 400);
  const drawer = await openLayers(page);
  await drawer.getByRole('button', { name: 'Add layer' }).click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1']);
});
