import type { Page } from '@playwright/test';

export interface ColorRange {
  r: [number, number];
  g: [number, number];
  b: [number, number];
}

export const LASER_RED: ColorRange = { r: [201, 255], g: [0, 59], b: [0, 59] };
export const SELECTION_BLUE: ColorRange = { r: [0, 99], g: [101, 199], b: [201, 255] };

export async function colorPixelCount(page: Page, range: ColorRange): Promise<number> {
  return page.evaluate((colorRange) => {
    const canvas = window.__fnCompositeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (
        r >= colorRange.r[0] &&
        r <= colorRange.r[1] &&
        g >= colorRange.g[0] &&
        g <= colorRange.g[1] &&
        b >= colorRange.b[0] &&
        b <= colorRange.b[1]
      ) {
        count += 1;
      }
    }
    return count;
  }, range);
}
