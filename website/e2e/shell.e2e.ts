import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test.describe('site shell without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('home page renders the wordmark and the nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Field Notes' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    const hrefs = await nav
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs).toEqual([
      '/docs/',
      '/playground/',
      '/api/',
      '/changelog/',
      'https://github.com/IrakliDevelop/fieldnotes',
    ]);
  });
});

test('home page has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test('home page has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expectNoAxeViolations(page);
});
