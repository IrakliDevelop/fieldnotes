import type { Page } from '@playwright/test';

export async function singleFingerDraw(
  page: Page,
  points: { x: number; y: number }[],
): Promise<void> {
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

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}
