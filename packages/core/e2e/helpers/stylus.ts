import type { Page } from '@playwright/test';

export async function stylusDraw(
  page: Page,
  points: { x: number; y: number; pressure?: number }[],
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  if (points.length === 0) return;

  const first = points[0];
  if (!first) return;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: first.x, y: first.y, id: 1, force: first.pressure ?? 0.5 }],
  });

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x, y: p.y, id: 1, force: p.pressure ?? 0.5 }],
    });
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}
