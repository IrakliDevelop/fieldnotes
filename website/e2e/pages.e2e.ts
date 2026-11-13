import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { displayName, parseChangelog } from '../src/lib/changelog';
import { parseRoadmap } from '../src/lib/roadmap';
import { repoFile } from '../src/lib/versions';
import { expectNoAxeViolations } from './helpers';

const [newest] = parseChangelog(readFileSync(repoFile('CHANGELOG.md'), 'utf8'));
if (!newest) throw new Error('CHANGELOG.md has no release');
const NEWEST = `${displayName(newest)} ${newest.version}`;

const ROADMAP = parseRoadmap(readFileSync(repoFile('website', 'content', 'roadmap.md'), 'utf8'));
const [oldestBuilt] = ROADMAP.built;
const newestBuilt = ROADMAP.built.at(-1);
if (!oldestBuilt || !newestBuilt) throw new Error('roadmap.md has no Built item');

const NOT_BUILT = [
  'Exporting a board or a selected frame as PDF, and SVG export that matches the canvas drawing',
];

const BUILT = [
  'Command palette on Ctrl or ⌘+K to search and run actions',
  'Find text on the board: notes, text, arrow labels and frame titles, with the camera moved to the match',
  'Shortcuts help on the ? key, generated from the current bindings',
  'React props and hooks for autosave, export and load, camera control, shortcuts, element activation and presence',
  'Text inside shapes and arrow labels as text elements, with wrapping and auto-resize',
  'Elbow arrows that route around shapes',
];

const NEXT = ["I'm adding PDF export and making SVG export match what the canvas draws."];

const BUILT_FRAMES = 'Frames that group and clip elements';

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

test('the roadmap shows its three sections with frames built and the not built list', async ({
  page,
}) => {
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
  await expect(
    page.getByRole('region', { name: 'Built' }).getByText(BUILT_FRAMES, { exact: true }),
  ).toHaveText(BUILT_FRAMES);
  for (const item of BUILT) {
    await expect(
      page.getByRole('region', { name: 'Built' }).getByText(item, { exact: true }),
    ).toHaveText(item);
  }
  await expect(page.getByRole('region', { name: 'Next' }).getByRole('listitem')).toHaveText(NEXT);
  await expect(page.getByRole('region', { name: 'Next' })).not.toContainText(BUILT_FRAMES);
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(`roadmap fold with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, () => {
    test.use({ javaScriptEnabled });

    test('shows the five newest Built items and opens the earlier ones in place', async ({
      page,
    }) => {
      await page.goto('/roadmap/');
      const built = page.getByRole('region', { name: 'Built', exact: true });
      const fold = built.locator('details > summary');
      await expect(fold).toHaveText(/Show items 1–\d+/, { useInnerText: true });
      await expect(built.getByText(oldestBuilt, { exact: true })).toBeHidden();
      await expect(built.getByText(newestBuilt, { exact: true })).toBeVisible();
      await fold.click();
      await expect(fold).toHaveText(/Hide items 1–\d+/, { useInnerText: true });
      await expect(built.getByText(oldestBuilt, { exact: true })).toBeVisible();
      await fold.click();
      await expect(built.getByText(oldestBuilt, { exact: true })).toBeHidden();
    });
  });
}

test('the roadmap numbers its sections as one list', async ({ page }) => {
  await page.goto('/roadmap/');
  await expect(
    page.getByRole('region', { name: 'Built', exact: true }).locator('ol').last(),
  ).toHaveAttribute('start', String(ROADMAP.built.length - 4));
  await expect(page.getByRole('region', { name: 'Not built yet' }).locator('ol')).toHaveAttribute(
    'start',
    String(ROADMAP.built.length + ROADMAP.next.length + 1),
  );
});

test('the roadmap map is decorative and drawn from the list', async ({ page }) => {
  await page.goto('/roadmap/');
  const map = page.locator('[data-trail-map]');
  await expect(map).toHaveAttribute('aria-hidden', 'true');
  const total = ROADMAP.built.length + ROADMAP.next.length + ROADMAP.notBuilt.length;
  await expect(map.locator('circle')).toHaveCount(total);
  const unexplored = map.locator('path.unexplored');
  const unexploredNote = map.locator('text.note.unexplored');
  await expect(unexplored).toHaveCSS('fill', 'none');
  await expect(unexplored).toHaveCSS('stroke', 'rgb(95, 101, 108)');
  await expect(unexplored).toHaveCSS('stroke-dasharray', '2px, 7px');
  await expect(unexploredNote).toHaveCSS('stroke', 'none');
  if (test.info().project.name === 'desktop-chrome') await expect(map).toBeVisible();
  else await expect(map).toBeHidden();
});

test('the roadmap has no horizontal scroll on a phone', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone width only');
  await page.goto('/roadmap/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
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
      'Exporting a board or a selected frame as PDF, and SVG export that matches the canvas drawing',
    );
  });
});
