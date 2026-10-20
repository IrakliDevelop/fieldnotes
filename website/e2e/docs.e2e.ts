import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

const MOUNT_CODE = `\`\`\`ts
import { Viewport, type ViewportOptions } from '@fieldnotes/core';

export function createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport {
  return new Viewport(container, { tools: 'default', ...extra });
}
\`\`\``;

test('getting started renders the sidebar with aria-current', async ({ page }) => {
  await page.goto('/docs/getting-started/');
  const side = page.getByRole('navigation', { name: 'Docs' });
  await expect(side.getByRole('link', { name: 'Getting started' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(side.locator('[aria-current]')).toHaveCount(1);
  await expect(side.getByRole('link', { name: 'API reference' })).toHaveAttribute(
    'href',
    /\/api\/$/,
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting started');
});

test('margin note sits in the gutter at 1280px and inline at 800px', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-chrome', 'layout widths are set explicitly');
  const note = page.locator('aside.margin-note').first();
  const code = page.locator('main pre[data-language="ts"]').first();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/docs/getting-started/');
  const wideNote = await note.boundingBox();
  const wideCode = await code.boundingBox();
  if (!wideNote || !wideCode) throw new Error('margin note or code block not rendered');
  expect(wideNote.x).toBeGreaterThanOrEqual(wideCode.x + wideCode.width);
  expect(Math.round(wideNote.width)).toBe(220);
  await expect(note).toHaveCSS('border-left-style', 'none');

  await page.setViewportSize({ width: 800, height: 900 });
  const narrowNote = await note.boundingBox();
  const narrowCode = await code.boundingBox();
  if (!narrowNote || !narrowCode) throw new Error('margin note or code block not rendered');
  expect(narrowNote.x).toBeCloseTo(narrowCode.x, 0);
  expect(narrowNote.x + narrowNote.width).toBeLessThanOrEqual(narrowCode.x + narrowCode.width + 1);
  await expect(note).toHaveCSS('border-left-style', 'solid');
});

test('the code block shows the named region only', async ({ page }) => {
  await page.goto('/docs/getting-started/');
  const code = page.locator('main pre[data-language="ts"]').first();
  await expect(code).toContainText(
    "return new Viewport(container, { tools: 'default', ...extra });",
  );
  await expect(code).not.toContainText('#region');
  await expect(code).not.toContainText('persist');
});

test('previous and next links move through the docs', async ({ page }) => {
  await page.goto('/docs/getting-started/');
  const pager = page.getByRole('navigation', { name: 'Previous and next page' });
  await expect(pager.getByRole('link', { name: /Previous/ })).toHaveCount(0);
  await pager.getByRole('link', { name: /Next.*Using React/ }).click();
  await expect(page).toHaveURL(/\/docs\/using-react\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Using React');
  await page
    .getByRole('navigation', { name: 'Previous and next page' })
    .getByRole('link', { name: /Previous.*Getting started/ })
    .click();
  await expect(page).toHaveURL(/\/docs\/getting-started\/$/);
});

test('the Markdown twin starts with the title and holds the fenced mount code', async ({
  request,
}) => {
  const response = await request.get('/docs/getting-started.md');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text.startsWith('# Getting started\n\n')).toBe(true);
  expect(text).toContain(MOUNT_CODE);
  expect(text).not.toContain('::code');
});

test('llms.txt lists getting started with an absolute twin URL', async ({ request }) => {
  const text = await (await request.get('/llms.txt')).text();
  expect(text.startsWith('# Field Notes\n')).toBe(true);
  expect(text).toMatch(
    /^- \[Getting started\]\(https:\/\/iraklidevelop\.github\.io\/docs\/getting-started\.md\): /m,
  );
  const full = await (await request.get('/llms-full.txt')).text();
  expect(full).toContain(MOUNT_CODE);
});

test('the docs index shows the facts and the nav groups', async ({ page }) => {
  await page.goto('/docs/');
  const facts = page.getByRole('main').locator('dl');
  await expect(facts.locator('dt')).toHaveText([
    'Licence',
    'Framework',
    'Multiplayer',
    'Input',
    'Browsers',
    'Packages',
    'Not built yet',
  ]);
  await expect(page.getByRole('region', { name: 'Start' }).getByRole('link')).toHaveText([
    'Getting started',
    'Using React',
    'Saving and loading',
  ]);
  await expect(
    page.getByRole('region', { name: 'Reference' }).getByRole('link', { name: 'Roadmap' }),
  ).toHaveAttribute('href', /\/roadmap\/$/);
  await expectNoAxeViolations(page);
});

test('every docs page in the sidebar is served', async ({ page, request }) => {
  await page.goto('/docs/getting-started/');
  // Reference links leave the docs collection, and /api/ exists only in the Pages build.
  const hrefs = await page
    .getByRole('navigation', { name: 'Docs' })
    .locator('a[href*="/docs/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs).toContain('/docs/saving-and-loading/');
  for (const href of hrefs) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
});

test('getting started has no axe violations', async ({ page }) => {
  await page.goto('/docs/getting-started/');
  await expectNoAxeViolations(page);
});

test.describe('docs without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the code and the board placeholder render', async ({ page }) => {
    await page.goto('/docs/getting-started/');
    await expect(page.locator('main pre[data-language="ts"]').first()).toContainText(
      'new Viewport(container',
    );
    const board = page.locator('figure[data-live-board="getting-started"]');
    await expect(board.locator('.board-placeholder')).toBeVisible();
    await expect(board.locator('.live-board-clear')).toBeHidden();
    await expect(board.locator('.live-board-engage')).toBeHidden();
    await expect(page.locator('input[type="search"]')).toBeHidden();
    await expect(board.locator('figcaption')).toHaveText('A live board running the snippet above.');
  });
});
