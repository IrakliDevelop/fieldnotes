import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface Box {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Bounding boxes of the visible chrome zones and the minimap. */
export async function zoneBoxes(page: Page): Promise<Box[]> {
  const boxes: Box[] = [];
  for (const zone of await page.locator('[data-chrome], [data-fieldnotes-minimap]').all()) {
    if (!(await zone.isVisible())) continue;
    const box = await zone.boundingBox();
    const name = (await zone.getAttribute('data-chrome')) ?? 'minimap';
    if (box) boxes.push({ name, ...box });
  }
  return boxes;
}

/** Asserts no two visible zones overlap and the page does not scroll horizontally. */
export async function expectNoOverlap(page: Page): Promise<void> {
  const boxes = await zoneBoxes(page);
  const overlaps: string[] = [];
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) overlaps.push(`${a.name} × ${b.name}`);
    }
  }
  expect(overlaps).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
