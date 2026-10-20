import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test.describe('landing without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('landing renders without JavaScript', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Put an infinite canvas in your app.',
    );
    await expect(
      main.getByText(
        'Freehand pens, shapes, sticky notes, arrows and live HTML elements on one zoomable board.',
        { exact: false },
      ),
    ).toBeVisible();
    await expect(main.getByRole('button', { name: /npm install @fieldnotes\/core/ })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Try it in the playground' })).toHaveAttribute(
      'href',
      /\/playground\/$/,
    );

    const facts = main.locator('dl');
    await expect(facts.locator('dt')).toHaveText(['Licence', 'Framework', 'Multiplayer', 'Input']);
    await expect(facts.locator('dd')).toHaveText([
      'MIT. No licence key, no watermark.',
      'None needed. React bindings if you want them.',
      'Your own WebSocket relay, Redis optional.',
      'Mouse, touch and pen with pressure.',
    ]);

    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Ten lines to a board that saves',
      'Live HTML on the board',
      'It already runs a D&D table',
      'How it compares',
      'Not built yet',
      'Why this exists',
    ]);

    const notBuilt = page.getByRole('region', { name: 'Not built yet' }).getByRole('listitem');
    await expect(notBuilt).toHaveText([
      'Frames that group and clip content',
      'Find text on the canvas',
      'Command palette',
      'Elbow arrows that route around shapes',
      'Text inside shapes',
    ]);

    const packages = page.getByRole('contentinfo').getByRole('row');
    await expect(packages.getByRole('link')).toHaveText([
      '@fieldnotes/core',
      '@fieldnotes/react',
      '@fieldnotes/sync',
      '@fieldnotes/sync-server',
      '@fieldnotes/sync-redis',
      '@fieldnotes/vtt',
    ]);
    await expect(packages.locator('td:last-child')).toHaveText(Array(6).fill(/^\d+\.\d+\.\d+/));

    await expect(page.locator('[data-hero-frame]')).toBeVisible();
  });
});

test('forwards old playground links', async ({ page, baseURL }) => {
  await page.goto('/?scene=tabletop&room=r1&guest#x');
  await page.waitForURL('**/playground/**');
  expect(page.url()).toBe(`${baseURL}/playground/?scene=tabletop&room=r1&guest#x`);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(page.url()).toBe(`${baseURL}/`);
});

test('copy button writes the install command to the clipboard', async ({ page, context }) => {
  test.skip(
    test.info().project.name !== 'desktop-chrome',
    'clipboard permissions are Chromium desktop only',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const button = page
    .getByRole('main')
    .getByRole('button', { name: /npm install @fieldnotes\/core/ });
  await button.click();
  await expect(button).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm install @fieldnotes/core',
  );
});

test('landing has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expectNoAxeViolations(page);
});

test('landing has no horizontal scroll on a phone', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone width only');
  await page.goto('/');
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // `isMobile` widens `innerWidth` to fit overflowing content, so compare with the device width.
  expect(scrollWidth).toBeLessThanOrEqual(360);
});
