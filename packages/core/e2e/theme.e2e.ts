import type { Page } from '@playwright/test';
import type { CanvasPage } from './fixtures/canvas-page';
import { test, expect } from './fixtures/canvas-page';

type Pixel = readonly [number, number, number, number];
interface Position {
  x: number;
  y: number;
}

declare global {
  interface Window {
    __fieldnotesExportBlob?: Blob;
  }
}

const readBoardPixels = (page: Page, x: number, y: number): Promise<Pixel[]> =>
  page.evaluate(
    ({ x, y }) => {
      const canvas = window.__fnCompositeCanvas();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing composite context');
      const base = document.querySelector<HTMLCanvasElement>(
        '#canvas canvas:not([data-paint-order])',
      );
      if (!base) throw new Error('Missing board canvas');
      const dpr = canvas.width / base.getBoundingClientRect().width;
      return [-2, 0, 2].map(
        (offset) =>
          [
            ...context.getImageData(Math.round((x + offset) * dpr), Math.round(y * dpr), 1, 1).data,
          ] as Pixel,
      );
    },
    { x, y },
  );

function agreesWith(pixels: readonly Pixel[], expected: readonly number[]): boolean {
  return (
    pixels.filter((pixel) => {
      const rgb = pixel[3] === 0 ? [255, 255, 255] : pixel.slice(0, 3);
      return rgb.every((value, index) => value === expected[index]);
    }).length >= 2
  );
}

function expectPixelNear(
  pixel: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void {
  expect(pixel).toHaveLength(4);
  for (const [index, value] of expected.entries()) {
    expect(Math.abs((pixel[index] ?? 0) - value)).toBeLessThanOrEqual(tolerance);
  }
}

const readLiveWorldPixel = (page: Page, world: Position): Promise<Pixel> =>
  page.evaluate((point) => {
    const viewport = window.__fieldnotes_viewport;
    const canvas = window.__fnCompositeCanvas();
    const context = canvas.getContext('2d');
    const base = document.querySelector<HTMLCanvasElement>(
      '#canvas canvas:not([data-paint-order])',
    );
    if (!context || !base) throw new Error('Missing composite canvas');
    const screen = viewport.camera.worldToScreen(point);
    const dpr = canvas.width / base.getBoundingClientRect().width;
    return [
      ...context.getImageData(Math.round(screen.x * dpr), Math.round(screen.y * dpr), 1, 1).data,
    ] as Pixel;
  }, world);

const readExportWorldPixel = (page: Page, world: Position): Promise<Pixel> =>
  page.evaluate(async (point) => {
    const scale = 2;
    const region = { x: point.x - 12, y: point.y - 12, w: 24, h: 24 };
    const blob = await window.__fieldnotes_viewport.exportImage({ region, scale });
    if (!blob) throw new Error('Missing image export');
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing export context');
    context.drawImage(bitmap, 0, 0);
    const x = Math.round((point.x - region.x) * scale);
    const y = Math.round((point.y - region.y) * scale);
    return [...context.getImageData(x, y, 1, 1).data] as Pixel;
  }, world);

const readDemoExportColors = (page: Page): Promise<{ dark: number; custom: number }> =>
  page.evaluate(async () => {
    const blob = window.__fieldnotesExportBlob;
    if (!blob) throw new Error('Missing demo PNG export');
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing export context');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    let custom = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 30 && data[index + 1] === 31 && data[index + 2] === 34) dark += 1;
      if (data[index] === 51 && data[index + 1] === 102 && data[index + 2] === 153) custom += 1;
    }
    return { dark, custom };
  });

async function draw(
  canvasPage: CanvasPage,
  tool: string,
  from = { x: 220, y: 220 },
  to = { x: 420, y: 220 },
): Promise<Position> {
  await canvasPage.selectTool(tool);
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Wrapper not found');
  await canvasPage.page.mouse.move(box.x + from.x, box.y + from.y);
  await canvasPage.page.mouse.down();
  await canvasPage.page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await canvasPage.page.mouse.up();
  await canvasPage.page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return canvasPage.page.evaluate(() => {
    const stroke = window.__fieldnotes_viewport.store.getElementsByType('stroke').at(-1);
    const point = stroke?.points.at(Math.floor(stroke.points.length / 2));
    if (!point) throw new Error('Missing stroke midpoint');
    return { x: point.x, y: point.y };
  });
}

const waitForRender = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

test.describe('themes', () => {
  test('dark board adapts drawing without changing serialized state', async ({ canvasPage }) => {
    await canvasPage.page.goto('/?theme=dark');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    expect(agreesWith(await readBoardPixels(canvasPage.page, 100, 100), [30, 31, 34])).toBe(true);

    await draw(canvasPage, 'pencil');
    await canvasPage.page.waitForFunction(() => window.__fieldnotes_viewport.store.count === 1);
    const darkPixels = await canvasPage.page.evaluate(() => {
      const canvas = window.__fnCompositeCanvas();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing composite context');
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let light = 0;
      let black = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        if (r >= 210 && r <= 220 && g >= 210 && g <= 220 && b >= 210 && b <= 220) light += 1;
        if (r < 30 && g < 30 && b < 30) black += 1;
      }
      return { light, black, state: window.__fieldnotes_viewport.exportState() };
    });
    expect(darkPixels.light).toBeGreaterThan(20);
    expect(darkPixels.black).toBe(0);

    const lightState = await canvasPage.page.evaluate(() => {
      window.__fieldnotes_viewport.setTheme('light');
      return window.__fieldnotes_viewport.exportState();
    });
    await waitForRender(canvasPage.page);
    expect(JSON.stringify(lightState)).toBe(JSON.stringify(darkPixels.state));
    expect(agreesWith(await readBoardPixels(canvasPage.page, 100, 100), [255, 255, 255])).toBe(
      true,
    );
    const blackStroke = await canvasPage.page.evaluate(() => {
      const canvas = window.__fnCompositeCanvas();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing composite context');
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return [...data].some((value, index) => index % 4 === 0 && value < 30);
    });
    expect(blackStroke).toBe(true);
  });

  test('dark highlighter, note and text use the themed composite surfaces', async ({
    canvasPage,
  }) => {
    await canvasPage.page.goto('/?theme=dark');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    const highlighterPoint = await draw(
      canvasPage,
      'highlighter',
      { x: 220, y: 320 },
      { x: 420, y: 320 },
    );
    await canvasPage.page.waitForFunction(() => window.__fieldnotes_viewport.store.count === 1);
    expectPixelNear(await readLiveWorldPixel(canvasPage.page, highlighterPoint), [120, 113, 44], 2);
    expectPixelNear(
      await readExportWorldPixel(canvasPage.page, highlighterPoint),
      [120, 113, 44],
      2,
    );

    await draw(canvasPage, 'pencil', { x: 320, y: 170 }, { x: 320, y: 270 });
    await draw(canvasPage, 'highlighter');
    const crossingPoint = await canvasPage.page.evaluate(() =>
      window.__fieldnotes_viewport.camera.screenToWorld({ x: 320, y: 220 }),
    );
    expectPixelNear(await readLiveWorldPixel(canvasPage.page, crossingPoint), [231, 230, 219], 3);

    await canvasPage.selectTool('note');
    await canvasPage.page.mouse.click(500, 300);
    const note = canvasPage.page.locator('[data-element-id]').filter({ hasText: '' }).last();
    await expect(note).toHaveCSS('background-color', 'rgb(92, 84, 13)');
    await expect(note).toHaveCSS('color', 'rgb(237, 237, 237)');

    await canvasPage.selectTool('text');
    const minimapBefore = await canvasPage.page.evaluate(() => {
      const minimap = document.querySelector<HTMLCanvasElement>('canvas[data-fieldnotes-minimap]');
      const context = minimap?.getContext('2d');
      if (!minimap || !context) throw new Error('Missing minimap');
      const data = context.getImageData(0, 0, minimap.width, minimap.height).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          (data[index] ?? 0) > 210 &&
          (data[index + 1] ?? 0) > 210 &&
          (data[index + 2] ?? 0) > 210
        )
          count += 1;
      }
      return count;
    });
    await canvasPage.page.mouse.click(600, 400);
    await canvasPage.page.keyboard.type('themed text');
    await canvasPage.page.keyboard.press('Control+Enter');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.store.getElementsByType('text').length === 1,
    );
    await canvasPage.page.waitForFunction((before) => {
      const minimap = document.querySelector<HTMLCanvasElement>('canvas[data-fieldnotes-minimap]');
      const context = minimap?.getContext('2d');
      if (!minimap || !context) return false;
      const data = context.getImageData(0, 0, minimap.width, minimap.height).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          (data[index] ?? 0) > 210 &&
          (data[index + 1] ?? 0) > 210 &&
          (data[index + 2] ?? 0) > 210
        )
          count += 1;
      }
      return count > before;
    }, minimapBefore);
    const minimapLightPixels = await canvasPage.page.evaluate(() => {
      const minimap = document.querySelector<HTMLCanvasElement>('canvas[data-fieldnotes-minimap]');
      const context = minimap?.getContext('2d');
      if (!minimap || !context) throw new Error('Missing minimap');
      const data = context.getImageData(0, 0, minimap.width, minimap.height).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          (data[index] ?? 0) > 210 &&
          (data[index + 1] ?? 0) > 210 &&
          (data[index + 2] ?? 0) > 210
        )
          count += 1;
      }
      return count;
    });
    expect(minimapLightPixels).toBeGreaterThan(minimapBefore);
  });

  test('dark low-lightness highlighter matches its live and PNG-exported screen result', async ({
    canvasPage,
  }) => {
    await canvasPage.page.goto('/?theme=dark');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    await canvasPage.page.evaluate(() => {
      const tool = window.__fieldnotes_viewport.toolManager.getTool('highlighter');
      if (!tool || !('setOptions' in tool)) throw new Error('Missing highlighter');
      tool.setOptions({ color: '#1e1e1e', opacity: 0.4 });
    });
    const midpoint = await draw(canvasPage, 'highlighter');
    await canvasPage.page.waitForFunction(() => window.__fieldnotes_viewport.store.count === 1);
    const live = await readLiveWorldPixel(canvasPage.page, midpoint);
    const exported = await readExportWorldPixel(canvasPage.page, midpoint);
    expectPixelNear(live, [104, 105, 107], 3);
    expectPixelNear(exported, [104, 105, 107], 3);
    expectPixelNear(live, exported, 2);
  });

  test('demo theme button keeps its dark-board label while it changes theme', async ({
    canvasPage,
  }) => {
    await canvasPage.page.goto('/?theme=light');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'light',
    );
    const button = canvasPage.page.getByRole('button', { name: 'Dark board' });
    await expect(button).toHaveAttribute('title', 'Switch the board between light and dark');
    await expect(button).toHaveAttribute('aria-pressed', 'false');

    await button.click();
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await button.click();
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'light',
    );
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('demo PNG export follows dark theme until a background is chosen', async ({
    canvasPage,
  }) => {
    const errors: string[] = [];
    canvasPage.page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    canvasPage.page.on('pageerror', (error) => errors.push(error.message));
    await canvasPage.page.addInitScript(() => {
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (value) => {
        if (value instanceof Blob && value.type === 'image/png')
          window.__fieldnotesExportBlob = value;
        return createObjectURL(value);
      };
    });
    await canvasPage.page.goto('/?theme=dark');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    await canvasPage.page.locator('#sample').click();
    await canvasPage.page.waitForFunction(() => window.__fieldnotes_viewport.store.count > 0);

    await canvasPage.page.locator('#export-png').click();
    await canvasPage.page.waitForFunction(() => Boolean(window.__fieldnotesExportBlob));
    const dark = await readDemoExportColors(canvasPage.page);
    expect(dark.dark).toBeGreaterThan(0);

    await canvasPage.page.locator('#export-bg').evaluate((input) => {
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing export background input');
      input.value = '#336699';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await canvasPage.page.evaluate(() => {
      window.__fieldnotesExportBlob = undefined;
    });
    await canvasPage.page.locator('#export-png').click();
    await canvasPage.page.waitForFunction(() => Boolean(window.__fieldnotesExportBlob));
    const custom = await readDemoExportColors(canvasPage.page);
    expect(custom.custom).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('system follows media and exports a dark board', async ({ canvasPage }) => {
    await canvasPage.page.emulateMedia({ colorScheme: 'dark' });
    await canvasPage.page.goto('/?theme=system');
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'dark',
    );
    expect(agreesWith(await readBoardPixels(canvasPage.page, 100, 100), [30, 31, 34])).toBe(true);
    await canvasPage.page.emulateMedia({ colorScheme: 'light' });
    await canvasPage.page.waitForFunction(
      () => window.__fieldnotes_viewport.getTheme().base === 'light',
    );
    await waitForRender(canvasPage.page);
    expect(agreesWith(await readBoardPixels(canvasPage.page, 100, 100), [255, 255, 255])).toBe(
      true,
    );

    await canvasPage.page.evaluate(() => window.__fieldnotes_viewport.setTheme('dark'));
    await waitForRender(canvasPage.page);
    await draw(canvasPage, 'pencil');
    const exported = await canvasPage.page.evaluate(async () => {
      const viewport = window.__fieldnotes_viewport;
      const read = async (theme?: 'light') => {
        const blob = await viewport.exportImage({
          region: { x: 0, y: 0, w: 100, h: 100 },
          scale: 1,
          ...(theme ? { theme } : {}),
        });
        if (!blob) throw new Error('Missing image export');
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing export context');
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        let light = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index] === 30 && data[index + 1] === 31 && data[index + 2] === 34) dark += 1;
          if (data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255) light += 1;
        }
        return theme ? light : dark;
      };
      return { dark: await read(), light: await read('light'), svg: await viewport.exportSVG() };
    });
    expect(exported.dark).toBeGreaterThan(0);
    expect(exported.light).toBeGreaterThan(0);
    expect(exported.svg).toContain('fill="#1e1f22"');
  });
});
