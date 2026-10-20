import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

const NOT_BUILT = [
  'Frames that group and clip content',
  'Find text on the canvas',
  'Command palette',
  'Elbow arrows that route around shapes',
  'Text inside shapes',
];

test('the changelog lists the newest release first with its rendered body', async ({ page }) => {
  await page.goto('/changelog/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changelog');
  await expect(page.getByRole('main').getByRole('heading', { level: 2 }).first()).toHaveText(
    'Core 0.97.0',
  );
  const newest = page.getByRole('article', { name: 'Core 0.97.0' });
  await expect(newest).toContainText('selection colour');
  await expect(newest).toContainText('A2');
  await expect(newest).toContainText('Not published yet');
  await expect(newest.locator('strong', { hasText: 'Added' })).toBeVisible();
  await expect(newest.locator('code', { hasText: 'ViewportOptions.selectionColor' })).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Core 0.91.0' }).getByText(/^Released \d{4}-\d{2}-\d{2}$/),
  ).toBeVisible();
});

test('the roadmap shows its three sections and the not built list', async ({ page }) => {
  await page.goto('/roadmap/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2 })).toHaveText([
    'Built',
    'Next',
    'Not built yet',
  ]);
  await expect(
    page.getByRole('region', { name: 'Not built yet' }).getByRole('listitem'),
  ).toHaveText(NOT_BUILT);
});

for (const path of ['/changelog/', '/roadmap/']) {
  test(`${path} has no axe violations`, async ({ page }) => {
    await page.goto(path);
    await expectNoAxeViolations(page);
  });
}

test.describe('changelog and roadmap without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('both pages render their text', async ({ page }) => {
    await page.goto('/changelog/');
    await expect(page.getByRole('article', { name: 'Core 0.97.0' })).toContainText(
      'ViewportOptions.selectionColor',
    );
    await page.goto('/roadmap/');
    await expect(page.getByRole('region', { name: 'Not built yet' })).toContainText(
      'Text inside shapes',
    );
  });
});
