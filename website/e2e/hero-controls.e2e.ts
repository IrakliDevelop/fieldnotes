import { expect, test, type Locator, type Page } from '@playwright/test';
import type { HeroHandle } from '../src/hero/mount';
import { expectNoAxeViolations, singleFingerDraw, touchSwipe } from './helpers';

declare global {
  interface Window {
    __hero: HeroHandle;
  }
}

const WRAPPER = '[data-hero-board] > div[tabindex]';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openHero(page: Page): Promise<void> {
  await page.goto('/?debug-hero');
  await page.locator('[data-hero][data-hero-ready="true"]').waitFor();
}

function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

function strokeCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__hero.viewport.store.getElementsByType('stroke').length);
}

function miraCursor(page: Page): Promise<{ x: number; y: number } | null | undefined> {
  return page.evaluate(() => window.__hero.roster.getPeer('mira')?.cursor);
}

async function box(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('control is not rendered');
  return rect;
}

/** A point on the board below the checklist, clear of every adopted node and control. */
async function emptyBoardPoint(page: Page): Promise<{ x: number; y: number }> {
  const checklist = await box(page.locator('[data-hero-node="checklist"]'));
  return { x: checklist.x + checklist.width / 2, y: checklist.y + checklist.height + 40 };
}

/** Resolves once `scrollY` holds for ten frames, so a fling cannot swallow the next touch. */
function scrollSettled(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = scrollY;
        let still = 0;
        const check = (): void => {
          still = scrollY === last ? still + 1 : 0;
          last = scrollY;
          if (still >= 10) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
}

test('plain wheel scrolls the page', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'a phone has no wheel');
  await openHero(page);
  const zoom = page.locator('[data-hero-zoom]');
  const board = await box(page.locator(WRAPPER));
  await page.mouse.move(board.x + board.width / 2, board.y + 120);

  const before = await scrollY(page);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction((y) => window.scrollY > y, before);
  await expect(zoom).toHaveText('100%');
  await expect(page.getByText(/^Hold (⌘|Ctrl) to zoom$/)).toBeVisible();

  await scrollSettled(page);
  const scrolled = await scrollY(page);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText('100%');
  await expect(zoom).toHaveText(/^\d+%$/);
  expect(await scrollY(page)).toBe(scrolled);
});

test('touch swipe scrolls when disengaged', async ({ page }) => {
  test.skip(test.info().project.name !== 'ipad', 'iPad touch only');
  await openHero(page);
  const strokes = await strokeCount(page);

  const start = await emptyBoardPoint(page);
  const before = await scrollY(page);
  await touchSwipe(page, start, { x: start.x, y: start.y - 200 });
  await page.waitForFunction((y) => window.scrollY > y, before);
  await scrollSettled(page);
  expect(await strokeCount(page)).toBe(strokes);

  const draw = page.getByRole('button', { name: 'Draw on this board' });
  const done = page.getByRole('button', { name: 'Done' });
  await draw.tap();
  const from = await emptyBoardPoint(page);
  const scrolled = await scrollY(page);
  await singleFingerDraw(
    page,
    Array.from({ length: 9 }, (_, i) => ({ x: from.x - 40 + i * 10, y: from.y + (i % 2) * 6 })),
  );
  await expect.poll(() => strokeCount(page)).toBe(strokes + 1);
  expect(await scrollY(page)).toBe(scrolled);

  await done.tap();
  await expect(draw).toBeVisible();
  expect(await page.evaluate(() => window.__hero.viewport.toolManager.activeTool?.name)).toBe(
    'select',
  );
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('toolbar follows shortcuts', async ({ page }) => {
  await openHero(page);
  await page.locator(WRAPPER).focus();
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Pencil' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('toolbar buttons set the tool', async ({ page }) => {
  await openHero(page);
  await page.getByRole('button', { name: 'Arrow' }).click();
  expect(await page.evaluate(() => window.__hero.viewport.toolManager.activeTool?.name)).toBe(
    'arrow',
  );
  await expect(page.getByRole('button', { name: 'Arrow' })).toHaveAttribute('aria-pressed', 'true');
});

test('install button copies on first click', async ({ page, context }) => {
  test.skip(
    test.info().project.name !== 'desktop-chrome',
    'clipboard permissions are Chromium desktop only',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openHero(page);
  const button = page
    .locator('[data-hero-board]')
    .getByRole('button', { name: /npm install @fieldnotes\/core/ });
  await button.click();
  await expect(button).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm install @fieldnotes/core',
  );
});

test('Mira wanders without reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHero(page);
  const start = await miraCursor(page);
  expect(start).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  await page.waitForFunction((from) => {
    const cursor = window.__hero.roster.getPeer('mira')?.cursor;
    return cursor !== undefined && cursor !== null && cursor.x !== from?.x;
  }, start);
});

test('reduced motion keeps Mira still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHero(page);
  const start = await miraCursor(page);
  expect(start).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  // Samples every frame for one second; a moving Mira yields more than one position.
  const positions = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen = new Set<string>();
        const end = performance.now() + 1000;
        const sample = (now: number): void => {
          seen.add(JSON.stringify(window.__hero.roster.getPeer('mira')?.cursor));
          if (now < end) requestAnimationFrame(sample);
          else resolve([...seen]);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(positions).toEqual([JSON.stringify(start)]);
});

test('hero has no axe violations with the board mounted', async ({ page }) => {
  await openHero(page);
  await expect(
    page.getByText('The cursor labelled Mira is a scripted demonstration, not another visitor.'),
  ).toBeAttached();
  await expectNoAxeViolations(page);
});

test('adopted headline keeps its size after a resize', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-chrome', 'desktop resize only');
  await page.setViewportSize({ width: 1000, height: 800 });
  await openHero(page);
  const read = (): Promise<{ fontSize: string; clipped: boolean }> =>
    page.locator('h1').evaluate((h1) => {
      const box = h1.closest('[data-element-id]');
      if (!box) throw new Error('the headline is not on the board');
      // Core's element box clips; the h1's own scrollHeight counts glyph overflow, so it cannot.
      return {
        fontSize: getComputedStyle(h1).fontSize,
        clipped: box.scrollHeight > box.clientHeight,
      };
    });
  const before = await read();
  expect(before.clipped).toBe(false);

  await page.setViewportSize({ width: 1400, height: 800 });
  expect(await read()).toEqual(before);
});

test('a failed mount leaves the static hero', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('hero-fail'))
      errors.push(message.text());
  });
  await page.goto('/?debug-hero&hero-fail');
  await expect.poll(() => errors.length).toBe(1);

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('[data-hero-sketch]')).toBeVisible();
  await expect(page.locator('[data-hero]')).not.toHaveAttribute('data-hero-ready');
  await expect(page.locator('[data-hero-controls]')).toBeHidden();
});

test('controls stay apart on a phone', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone width only');
  await openHero(page);
  const controls = await Promise.all(
    [
      page.getByRole('toolbar', { name: 'Canvas tools' }),
      page.getByRole('button', { name: 'Draw on this board' }),
      page.getByRole('button', { name: 'Put it back' }),
      page.locator('[data-hero-zoom]'),
    ].map(box),
  );
  const checklist = await box(page.locator('[data-hero-node="checklist"]'));
  const overlaps = (a: Box, b: Box): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  for (const [i, control] of controls.entries()) {
    expect(overlaps(control, checklist)).toBe(false);
    expect(control.x + control.width).toBeLessThanOrEqual(360);
    for (const other of controls.slice(i + 1)) expect(overlaps(control, other)).toBe(false);
  }
});

test('controls are 44px targets under a coarse pointer', async ({ page }) => {
  await openHero(page);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const draw = page.getByRole('button', { name: 'Draw on this board' });
  if (!coarse) {
    await expect(draw).toBeHidden();
    return;
  }
  const buttons = page.locator('[data-hero-controls] button');
  await expect(buttons).toHaveCount(7);
  for (const button of await buttons.all()) {
    const { width, height } = await box(button);
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
});
