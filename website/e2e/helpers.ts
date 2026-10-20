import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { HeroHandle } from '../src/hero/mount';

declare global {
  interface Window {
    __hero: HeroHandle;
  }
}

interface Point {
  x: number;
  y: number;
}

/** Core's hero wrapper; the hidden static picture is the board's other child div. */
export const HERO_WRAPPER = '[data-hero-board] > div[tabindex]';

/** Opens the landing page with the hero handle on `window.__hero` and waits for the mount. */
export async function openHero(page: Page): Promise<void> {
  await page.goto('/?debug-hero');
  await page.locator('[data-hero][data-hero-ready="true"]').waitFor();
}

/** The page's vertical scroll offset. */
export function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/** Fails the test when axe finds any WCAG 2 A or AA violation on the page. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations).toEqual([]);
}

/** Drags one finger along `points` through CDP touch events. */
export async function singleFingerDraw(page: Page, points: Point[]): Promise<void> {
  const first = points[0];
  if (!first) throw new Error('singleFingerDraw requires at least one point');
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: first.x, y: first.y, id: 1 }],
  });
  for (const point of points.slice(1)) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Swipes one finger in a straight line from `from` to `to`. */
export async function touchSwipe(page: Page, from: Point, to: Point): Promise<void> {
  const steps = 8;
  const points = Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));
  await singleFingerDraw(page, points);
}
