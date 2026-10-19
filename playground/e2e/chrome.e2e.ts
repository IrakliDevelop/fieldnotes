import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShapeTool } from '@fieldnotes/core';
import { singleFingerDraw } from './helpers/touch';

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__playground !== undefined);
}

const zoom = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.camera.zoom);

test('zoom buttons change zoom and undo button reflects history', async ({ page }, testInfo) => {
  await open(page);
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
  await open(page);
  const menu = page.locator('[data-chrome="menu"]');
  const button = menu.getByRole('button', { name: 'Menu' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Dev playground' })).toHaveAttribute(
    'href',
    './dev/',
  );
  await expect(menu.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', './api/');
  const github = menu.getByRole('link', { name: 'GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/IrakliDevelop/fieldnotes');
  await expect(github).toHaveAttribute('target', '_blank');
  await expect(menu.getByText(/^Field Notes v\d+\.\d+\.\d+$/)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu.getByRole('link', { name: 'GitHub' })).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('toast zone is present and empty at start', async ({ page }) => {
  await open(page);
  const toast = page.locator('[data-chrome="toast"]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveText('');
});

test('flyout keyboard', async ({ page }) => {
  await open(page);
  const tools = page.locator('[data-chrome="tools"]');
  await expect(tools).toHaveAttribute('role', 'toolbar');
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
