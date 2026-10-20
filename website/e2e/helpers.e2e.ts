import { expect, test } from '@playwright/test';
import { singleFingerDraw } from './helpers';

test('a tap right after singleFingerDraw on a touch-action none surface clicks', async ({
  page,
}) => {
  test.skip(test.info().project.name === 'desktop-chrome', 'touch projects only');
  await page.setContent(`
    <div style="touch-action: none; width: 400px; height: 300px"></div>
    <button type="button" onclick="this.textContent = 'Clicked'">Done</button>
  `);
  const button = page.getByRole('button');
  const target = await button.boundingBox();
  if (!target) throw new Error('button is not rendered');

  await singleFingerDraw(
    page,
    Array.from({ length: 9 }, (_, i) => ({ x: 100 + i * 10, y: 150 + (i % 2) * 6 })),
  );
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await expect(button).toHaveText('Clicked');
});
