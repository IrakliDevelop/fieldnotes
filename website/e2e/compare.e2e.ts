import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test('the comparison page lists every row with its sources', async ({ page }) => {
  await page.goto('/compare/');
  await expect(page).toHaveTitle('Field Notes compared with tldraw and Excalidraw');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Field Notes compared with tldraw and Excalidraw',
  );
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'When tldraw is the better choice',
    'When Excalidraw is the better choice',
    'When Field Notes fits',
  ]);
  const table = page.getByRole('region', {
    name: 'Field Notes compared with tldraw and Excalidraw',
  });
  await expect(table.getByRole('rowheader')).toHaveCount(14);
  const refs = await table
    .locator('sup a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(refs.length).toBeGreaterThan(20);
  for (const ref of refs) await expect(page.locator(ref ?? '')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://fieldnotesjs.dev/compare/',
  );
});

test('the footer links to the comparison page', async ({ page }) => {
  await page.goto('/docs/');
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'Compare with tldraw and Excalidraw' }),
  ).toHaveAttribute('href', '/compare/');
});

test('the comparison page fits a phone and has no axe violations', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone width only');
  await page.goto('/compare/');
  await expectNoAxeViolations(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // `isMobile` widens `innerWidth` to fit overflowing content; the configured width does not move.
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
});
