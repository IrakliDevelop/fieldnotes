import { test, expect, CanvasPage } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';

async function gotoDemo(page: Page, query = ''): Promise<CanvasPage> {
  await page.goto(`/${query}`);
  await page.waitForSelector('#canvas canvas');
  return new CanvasPage(page);
}

test.describe('bench mode', () => {
  test('?bench=300 seeds strokes and shows the HUD', async ({ page }) => {
    const canvasPage = await gotoDemo(page, '?bench=300');
    expect(await canvasPage.getElementsByType('stroke')).toHaveLength(300);
    expect(await canvasPage.getElementsByType('note')).toHaveLength(10);
    const hud = page.locator('#bench-hud');
    await expect(hud).toBeVisible();
    await expect(hud).toContainText(/fps/);
    await expect(hud).toContainText('311');
  });

  test('?bench without a value seeds 500', async ({ page }) => {
    const canvasPage = await gotoDemo(page, '?bench');
    expect(await canvasPage.getElementsByType('stroke')).toHaveLength(500);
  });

  test('?bench=999999 is clamped to 20000', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'ipad', 'parse-only check; desktop covers it');
    test.slow();
    const canvasPage = await gotoDemo(page, '?bench=999999');
    expect(await canvasPage.getElementsByType('stroke')).toHaveLength(20000);
  });

  test('?bench=0 is clamped to 1', async ({ page }) => {
    const canvasPage = await gotoDemo(page, '?bench=0');
    expect(await canvasPage.getElementsByType('stroke')).toHaveLength(1);
  });

  test('no bench param: no HUD', async ({ page }) => {
    await gotoDemo(page);
    await expect(page.locator('#bench-hud')).toBeHidden();
  });
});
