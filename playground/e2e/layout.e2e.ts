import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { singleFingerDraw } from './helpers/touch';

interface Box {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__playground !== undefined);
}

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name);

async function expectNoOverlap(page: Page): Promise<void> {
  const boxes: Box[] = [];
  for (const zone of await page.locator('[data-chrome], [data-fieldnotes-minimap]').all()) {
    if (!(await zone.isVisible())) continue;
    const box = await zone.boundingBox();
    const name = (await zone.getAttribute('data-chrome')) ?? 'minimap';
    if (box) boxes.push({ name, ...box });
  }
  const overlaps: string[] = [];
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) overlaps.push(`${a.name} × ${b.name}`);
    }
  }
  expect(overlaps).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

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
    await open(page);
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
  await open(page);
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
  await open(page);
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
    await open(page);
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
  await open(page);
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

async function openLayers(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-chrome="top-right"]').getByRole('button', { name: 'Layers' }).click();
  return page.locator('[data-chrome="layers"]');
}

const layerNames = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__playground.viewport.layerManager.getLayers().map((l) => l.name));

test('layer names stay unique', async ({ page }) => {
  await open(page);
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
  await open(page);
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
  await open(page);
  await page.mouse.click(400, 400);
  const drawer = await openLayers(page);
  await drawer.getByRole('button', { name: 'Add layer' }).click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Layer 2']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1']);
});
