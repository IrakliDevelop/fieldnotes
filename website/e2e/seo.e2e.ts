import { expect, test } from '@playwright/test';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop-chrome', 'the built HTML is the same everywhere');
});

test('the home page carries a canonical URL and a preview image', async ({ page }) => {
  await page.goto('/?ref=test');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://fieldnotesjs.dev/',
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://fieldnotesjs.dev/og.png',
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
});

test('the preview image is a 1200 by 630 PNG', async ({ request }) => {
  const response = await request.get('/og.png');
  expect(response.headers()['content-type']).toBe('image/png');
  const header = await response.body();
  expect([header.readUInt32BE(16), header.readUInt32BE(20)]).toEqual([1200, 630]);
});

test('the sitemap lists a docs page and robots.txt names the sitemap', async ({ request }) => {
  expect(await (await request.get('/sitemap.xml')).text()).toContain(
    '<loc>https://fieldnotesjs.dev/docs/getting-started/</loc>',
  );
  expect(await (await request.get('/robots.txt')).text()).toContain(
    'Sitemap: https://fieldnotesjs.dev/sitemap.xml',
  );
});

test('the 404 page is not indexed', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});
