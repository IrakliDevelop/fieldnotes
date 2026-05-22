import type { Page } from '@playwright/test';

export async function pinchGesture(
  page: Page,
  center: { x: number; y: number },
  startDistance: number,
  endDistance: number,
  steps = 5,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const halfStart = startDistance / 2;
  const halfEnd = endDistance / 2;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: center.x - halfStart, y: center.y, id: 1 },
      { x: center.x + halfStart, y: center.y, id: 2 },
    ],
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const half = halfStart + (halfEnd - halfStart) * t;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: center.x - half, y: center.y, id: 1 },
        { x: center.x + half, y: center.y, id: 2 },
      ],
    });
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

export async function twoFingerPan(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  steps = 5,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const spacing = 40;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: from.x - spacing, y: from.y, id: 1 },
      { x: from.x + spacing, y: from.y, id: 2 },
    ],
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const dx = delta.x * t;
    const dy = delta.y * t;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x - spacing + dx, y: from.y + dy, id: 1 },
        { x: from.x + spacing + dx, y: from.y + dy, id: 2 },
      ],
    });
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}
