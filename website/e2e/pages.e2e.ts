import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { displayName, parseChangelog } from '../src/lib/changelog';
import { repoFile } from '../src/lib/versions';
import { expectNoAxeViolations } from './helpers';

const [newest] = parseChangelog(readFileSync(repoFile('CHANGELOG.md'), 'utf8'));
if (!newest) throw new Error('CHANGELOG.md has no release');
const NEWEST = `${displayName(newest)} ${newest.version}`;

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
    NEWEST,
  );
  const core = page.getByRole('article', { name: 'Core 0.91.0' });
  await expect(core).toContainText(
    "interactive surface, render slots, renderMode 'dom' · F4, F5, C20",
  );
  await expect(core.locator('strong', { hasText: 'Added' })).toBeVisible();
  await expect(core.locator('code', { hasText: 'Viewport.requestOverlayRender()' })).toBeVisible();
  // Lines show only when npm answered, so an offline build has none.
  for (const line of await page.locator('article .status').allTextContents()) {
    expect(line).toMatch(/^(Released \d{4}-\d{2}-\d{2}|Not published yet)$/);
  }
});

test('every changelog heading uses the package display name', async ({ page }) => {
  await page.goto('/changelog/');
  await expect(page.locator('h2[id="react-0.14.0"]')).toHaveText('React 0.14.0');
  await expect(page.locator('h2[id="sync-server-0.19.1"]')).toHaveText('Sync server 0.19.1');
  await expect(page.locator('main h2', { hasText: '@fieldnotes/' })).toHaveCount(0);
  await expect(page.locator('main h2[id^="-"]')).toHaveCount(0);
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
    await expect(page.getByRole('article', { name: 'Core 0.91.0' })).toContainText(
      'Viewport.requestOverlayRender()',
    );
    await page.goto('/roadmap/');
    await expect(page.getByRole('region', { name: 'Not built yet' })).toContainText(
      'Text inside shapes',
    );
  });
});
