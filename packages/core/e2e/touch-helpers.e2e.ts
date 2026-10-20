import { test, expect } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';
import { singleFingerDraw, twoFingerPan } from './helpers/touch';

interface Point {
  x: number;
  y: number;
}

const gestures: [string, (page: Page, center: Point) => Promise<void>][] = [
  [
    'singleFingerDraw',
    (page, c) =>
      singleFingerDraw(
        page,
        Array.from({ length: 9 }, (_, i) => ({ x: c.x + i * 10, y: c.y + (i % 2) * 6 })),
      ),
  ],
  ['twoFingerPan', (page, c) => twoFingerPan(page, c, { x: 120, y: 60 })],
];

test.describe('touch helpers', () => {
  for (const [name, gesture] of gestures) {
    test(`a tap right after ${name} clicks`, async ({ canvasPage }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'ipad',
        "needs the ipad project's touch emulation for page.touchscreen.tap",
      );
      const { page } = canvasPage;
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.id = 'tap-counter';
        button.type = 'button';
        button.textContent = '0';
        button.style.cssText = 'position: fixed; right: 16px; bottom: 16px; z-index: 10000';
        button.addEventListener('click', () => {
          button.textContent = String(Number(button.textContent) + 1);
        });
        document.body.append(button);
      });
      const counter = page.locator('#tap-counter');
      const target = await counter.boundingBox();
      const board = await canvasPage.wrapper().boundingBox();
      if (!target || !board) throw new Error('counter or board is not rendered');

      await gesture(page, { x: board.x + board.width / 2, y: board.y + board.height / 2 });
      await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
      await expect(counter).toHaveText('1');
    });
  }
});
