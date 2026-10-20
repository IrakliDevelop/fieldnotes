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
      'None needed. React, Vue and Svelte bindings if you want them.',
      'Your own WebSocket relay, Redis optional.',
      'Mouse, touch and pen with pressure.',
    ]);
    await expect(facts.locator('dd a')).toHaveText([
      'None needed. React, Vue and Svelte bindings if you want them.',
      'Your own WebSocket relay, Redis optional.',
      'Mouse, touch and pen with pressure.',
    ]);
    expect(
      await facts.locator('dd a').evaluateAll((all) => all.map((a) => a.getAttribute('href'))),
    ).toEqual([
      '/docs/using-react/',
      '/docs/multiplayer/',
      '/docs/tools-and-input/#mouse-touch-and-pen',
    ]);
    await expect(
      main.getByRole('link', { name: 'Tell the sync server which elements each player may see' }),
    ).toHaveAttribute('href', '/docs/multiplayer/#send-each-person-only-what-they-may-see');

    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Ten lines to a board that saves',
      'Live HTML on the board',
      'It already runs a D&D table',
      'How it compares',
      'Not built yet',
      'Why this exists',
    ]);

    await expect(
      page.getByRole('region', { name: 'How it compares' }).getByRole('link', {
        name: 'MIT. No licence key, no watermark.',
      }),
    ).toHaveAttribute('href', 'https://github.com/IrakliDevelop/fieldnotes/blob/master/LICENSE');

    const notBuilt = page.getByRole('region', { name: 'Not built yet' }).getByRole('listitem');
    await expect(notBuilt).toHaveText([
      'Frames that group and clip elements',
      'Find text on the board',
      'Command palette',
      'Elbow arrows that route around shapes',
      'Text inside shapes',
    ]);

    const packages = page.getByRole('contentinfo').getByRole('row');
    await expect(packages.getByRole('link')).toHaveText([
      '@fieldnotes/core',
      '@fieldnotes/react',
      '@fieldnotes/vue',
      '@fieldnotes/svelte',
      '@fieldnotes/sync',
      '@fieldnotes/sync-server',
      '@fieldnotes/sync-redis',
      '@fieldnotes/vtt',
    ]);
    await expect(packages.locator('td:last-child')).toHaveText(Array(8).fill(/^\d+\.\d+\.\d+/));

    // Below 820px the headline is not on the board, so nothing claims it can be dragged.
    const frame = page.locator('[data-hero-frame]');
    const annotation = page.getByText('This headline is on the canvas too. Drag it.');
    if (test.info().project.name === 'phone') {
      await expect(frame).toBeHidden();
      await expect(annotation).toBeHidden();
    } else {
      await expect(frame).toBeVisible();
      await expect(annotation).toBeVisible();
    }
  });
});

test('forwards old playground links', async ({ page, baseURL }) => {
  for (const query of ['?scene=tabletop&room=r1&guest#x', '?room=r1&guest', '?blank']) {
    await page.goto(`/${query}`);
    await page.waitForURL('**/playground/**');
    expect(page.url()).toBe(`${baseURL}/playground/${query}`);
  }

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

test('copy button selects the command when the clipboard refuses', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-chrome', 'one desktop run covers the fallback');
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied'));
  });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto('/');
  const button = page
    .getByRole('main')
    .getByRole('button', { name: /npm install @fieldnotes\/core/ });
  await button.click();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('npm install @fieldnotes/core');
  await expect(button).toContainText('Copy');
  await expect(button).not.toContainText('Copied');
  expect(errors).toEqual([]);
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
