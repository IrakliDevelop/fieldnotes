import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShapeTool } from '@fieldnotes/core';
import { singleFingerDraw } from './helpers/touch';
import { captureExportedBlobs, gotoBlank } from './helpers/board';

const zoom = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.camera.zoom);

test('zoom buttons change zoom and undo button reflects history', async ({ page }, testInfo) => {
  await gotoBlank(page);
  const bar = page.locator('[data-chrome="zoom"]');
  const zoomIn = bar.getByRole('button', { name: 'Zoom in' });
  const undo = bar.getByRole('button', { name: 'Undo' });

  if (testInfo.project.name === 'ipad') {
    await expect(zoomIn).toBeHidden();
  } else {
    await zoomIn.click();
    await expect.poll(() => zoom(page)).toBeGreaterThan(1);
    await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('120%');
    await bar.getByRole('button', { name: 'Reset zoom' }).click();
    await expect.poll(() => zoom(page)).toBe(1);
  }

  await expect(undo).toBeDisabled();
  await page.keyboard.press('3');
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
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(bar.getByRole('button', { name: 'Redo' })).toBeEnabled();
});

test('menu opens, closes on Escape and links resolve', async ({ page }) => {
  await gotoBlank(page);
  const menu = page.locator('[data-chrome="menu"]');
  const button = menu.getByRole('button', { name: 'Menu' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const links = menu.getByRole('link');
  await expect(links).toHaveText([
    'Field Notes home',
    'Docs',
    'Dev playground',
    'API reference',
    'GitHub',
  ]);
  await expect(menu.getByRole('link', { name: 'Field Notes home' })).toHaveAttribute('href', '../');
  await expect(menu.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '../docs/');
  await expect(menu.getByRole('link', { name: 'Dev playground' })).toHaveAttribute(
    'href',
    '../dev/',
  );
  await expect(menu.getByRole('link', { name: 'API reference' })).toHaveAttribute(
    'href',
    '../api/',
  );
  const github = menu.getByRole('link', { name: 'GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/IrakliDevelop/fieldnotes');
  await expect(github).toHaveAttribute('target', '_blank');
  await expect(menu.getByText(/^Field Notes v\d+\.\d+\.\d+$/)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu.getByRole('link', { name: 'GitHub' })).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('toast zone is present and empty at start', async ({ page }) => {
  await gotoBlank(page);
  const toast = page.locator('[data-chrome="toast"]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveText('');
});

test('board theme persists and PNG export follows it', async ({ page }, testInfo) => {
  await captureExportedBlobs(page);
  await gotoBlank(page);
  const menu = page.locator('[data-chrome="menu"]');
  await menu.getByRole('button', { name: 'Menu' }).click();
  await menu.getByRole('button', { name: 'Dark board' }).click();
  await expect(page.locator('#stage [data-fieldnotes-theme="dark"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Tabletop', exact: true }).click();
  await page.waitForFunction(() => window.__playground?.sceneId === 'tabletop');
  await expect(page.locator('#stage [data-fieldnotes-theme="dark"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await page.waitForFunction(() => window.__playground?.sceneId === 'whiteboard');
  await expect(page.locator('#stage [data-fieldnotes-theme="dark"]')).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => window.__playground?.sceneId === 'whiteboard');
  await expect(page.locator('#stage [data-fieldnotes-theme="dark"]')).toHaveCount(1);

  await page.keyboard.press('3');
  const points = [0, 1, 2, 3].map((index) => ({ x: 300 + index * 30, y: 400 + index * 10 }));
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
  await page.waitForFunction(() => window.__playground.viewport.store.count === 1);

  const download = page.waitForEvent('download');
  await menu.getByRole('button', { name: 'Menu' }).click();
  await menu.locator('[data-menu-item="export-png"]').click();
  await download;
  const background = await page.evaluate(async () => {
    const blob = (Reflect.get(window, 'exportedBlobs') as Blob[]).at(-1);
    if (!blob) throw new Error('Missing downloaded PNG');
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing PNG context');
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(5, 5, 1, 1).data];
  });
  expect(background.slice(0, 3)).toEqual([30, 31, 34]);

  await menu.getByRole('button', { name: 'Menu' }).click();
  await menu.getByRole('button', { name: 'Light board' }).click();
  await expect(page.locator('#stage [data-fieldnotes-theme="dark"]')).toHaveCount(0);
});

test('flyout keyboard', async ({ page }) => {
  await gotoBlank(page);
  const tools = page.locator('[data-chrome="tools"]');
  await expect(tools.getByRole('toolbar', { name: 'Tools' })).toHaveClass('tool-strip');
  const shape = tools.getByRole('button', { name: 'Shape', exact: true });
  await expect(shape).toHaveAttribute('aria-haspopup', 'menu');
  await shape.focus();
  await page.keyboard.press('Enter');
  await expect(shape).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__playground.viewport.toolManager.getTool<ShapeTool>('shape')?.getOptions().shape,
      ),
    )
    .toBe('ellipse');

  await shape.focus();
  await page.keyboard.press('Enter');
  await expect(tools.getByRole('menuitemradio', { name: 'Ellipse' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(tools.getByRole('menu')).toHaveCount(0);
  await expect(shape).toHaveAttribute('aria-expanded', 'false');
  await expect(shape).toBeFocused();
});

test('flyout ArrowUp with nothing focused wraps to the last item', async ({ page }) => {
  await gotoBlank(page);
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.getByRole('menu').dispatchEvent('keydown', { key: 'ArrowUp' });
  await expect(page.getByRole('menuitemradio', { name: 'Line' })).toBeFocused();
});

test.describe('narrow', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Style toggle is not inside the Tools toolbar', async ({ page }) => {
    await gotoBlank(page);
    await expect(
      page.getByRole('toolbar', { name: 'Tools' }).locator('[data-style-toggle]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-style-toggle]')).toBeVisible();
  });
});
