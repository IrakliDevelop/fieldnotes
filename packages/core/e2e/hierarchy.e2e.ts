import { expect, test } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';
import { singleFingerDraw } from './helpers/touch';

interface Position {
  x: number;
  y: number;
}

interface DemoViewport {
  setParent(childId: string, parentId: string | null): void;
  setTool(name: string): void;
  getSelectedIds(): string[];
  camera: { worldToScreen(point: Position): Position };
  store: {
    add(element: unknown): void;
    getById(id: string): { position: Position; layerId: string };
    update(id: string, patch: Record<string, unknown>): void;
  };
  elementRegistry: { register(definition: Record<string, unknown>): void };
  addHtmlElement(
    node: HTMLElement,
    position: Position,
    size: { w: number; h: number },
    options: { interactive: boolean },
  ): string;
  getElementAt(point: Position): { id: string } | null;
  requestRender(): void;
}

async function samplePixel(page: Page, world: Position): Promise<number[]> {
  return page.evaluate((point) => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const base = document.querySelector('#canvas canvas');
    if (!(base instanceof HTMLCanvasElement)) throw new Error('canvas not found');
    const composite = window.__fnCompositeCanvas();
    const context = composite.getContext('2d');
    if (!context) throw new Error('composite canvas has no 2d context');
    const screen = viewport.camera.worldToScreen(point);
    const dpr = composite.width / base.clientWidth;
    const x = Math.max(0, Math.min(composite.width - 1, Math.round(screen.x * dpr)));
    const y = Math.max(0, Math.min(composite.height - 1, Math.round(screen.y * dpr)));
    return [...context.getImageData(x, y, 1, 1).data];
  }, world);
}

function isDominant(pixel: readonly number[], channel: 0 | 1 | 2): boolean {
  const value = pixel[channel] ?? 0;
  return (
    value > 140 &&
    value > (pixel[(channel + 1) % 3] ?? 0) + 60 &&
    value > (pixel[(channel + 2) % 3] ?? 0) + 60
  );
}

async function touchTap(page: Page, point: Position): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

function expectSameDelta(before: Position[], after: Position[]): void {
  const firstBefore = before[0];
  const firstAfter = after[0];
  if (!firstBefore || !firstAfter) throw new Error('Expected subtree positions');
  const delta = { x: firstAfter.x - firstBefore.x, y: firstAfter.y - firstBefore.y };
  expect(delta).not.toEqual({ x: 0, y: 0 });
  for (const [index, position] of after.entries()) {
    if (index === 0) continue;
    const original = before[index];
    if (!original) throw new Error('Expected matching subtree position');
    expect({
      x: position.x - original.x,
      y: position.y - original.y,
    }).toEqual(delta);
  }
}

test('parent drag moves its locked subtree and selection stays literal', async ({
  canvasPage,
}, testInfo) => {
  const page = canvasPage.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const base = (id: string, x: number, y: number, parentId?: string, locked = false) => ({
      id,
      type: 'note',
      position: { x, y },
      size: { w: 80, h: 60 },
      text: id,
      backgroundColor: '#fff',
      textColor: '#000',
      fontSize: 18,
      index: id,
      version: 1,
      locked,
      layerId: '',
      ...(parentId ? { parentId } : {}),
    });
    viewport.store.add(base('parent', 300, 300));
    viewport.store.add(base('child', 320, 320));
    viewport.store.add(base('grandchild', 340, 340, undefined, true));
    viewport.setParent('child', 'parent');
    viewport.setParent('grandchild', 'child');
    viewport.setTool('select');
  });
  await canvasPage.selectTool('select');
  const before = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position);
  });
  const screen = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const parent = viewport.store.getById('parent').position;
    return viewport.camera.worldToScreen({ x: parent.x + 10, y: parent.y + 10 });
  });
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Canvas wrapper not found');
  const from = { x: box.x + screen.x, y: box.y + screen.y };
  const to = { x: from.x + 30, y: from.y + 20 };
  if (testInfo.project.name === 'ipad') await singleFingerDraw(page, [from, to]);
  else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { __fieldnotes_viewport: DemoViewport }
          ).__fieldnotes_viewport.getSelectedIds(),
        ),
      )
      .toEqual(['parent']);
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
  }
  await page.waitForFunction((original) => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return ['parent', 'child', 'grandchild']
      .map((id) => viewport.store.getById(id).position)
      .some(
        (position, index) => position.x !== original[index].x || position.y !== original[index].y,
      );
  }, before);
  const state = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return {
      selected: viewport.getSelectedIds(),
      positions: ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position),
    };
  });
  expect(state.selected).toEqual(['parent']);
  expectSameDelta(before, state.positions);
  await page.click('#undo');
  await page.waitForFunction((original) => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return (
      JSON.stringify(
        ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position),
      ) === JSON.stringify(original)
    );
  }, before);
  expect(errors).toEqual([]);
});

test('desktop keyboard nudge moves and undoes the complete subtree', async ({
  canvasPage,
}, testInfo) => {
  test.skip(testInfo.project.name === 'ipad', 'keyboard scenario is desktop-only');
  const page = canvasPage.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const base = (id: string, x: number, y: number, locked = false) => ({
      id,
      type: 'note',
      position: { x, y },
      size: { w: 80, h: 60 },
      text: id,
      backgroundColor: '#fff',
      textColor: '#000',
      fontSize: 18,
      index: id,
      version: 1,
      locked,
      layerId: '',
    });
    viewport.store.add(base('parent', 300, 300));
    viewport.store.add(base('child', 320, 320));
    viewport.store.add(base('grandchild', 340, 340, true));
    viewport.setParent('child', 'parent');
    viewport.setParent('grandchild', 'child');
    viewport.setTool('select');
  });
  await canvasPage.selectTool('select');
  const before = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position);
  });
  const screen = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const parent = viewport.store.getById('parent').position;
    return viewport.camera.worldToScreen({ x: parent.x + 10, y: parent.y + 10 });
  });
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Canvas wrapper not found');
  await page.mouse.click(box.x + screen.x, box.y + screen.y);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __fieldnotes_viewport: DemoViewport }
        ).__fieldnotes_viewport.getSelectedIds(),
      ),
    )
    .toEqual(['parent']);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((original) => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const parent = original[0];
    return parent !== undefined && viewport.store.getById('parent').position.x !== parent.x;
  }, before);
  const moved = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position);
  });
  expectSameDelta(before, moved);
  await page.click('#undo');
  await page.waitForFunction((original) => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return (
      JSON.stringify(
        ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position),
      ) === JSON.stringify(original)
    );
  }, before);
  expect(errors).toEqual([]);
});

test('nested extension clips constrain canvas, hit testing, and a rotated native DOM child', async ({
  canvasPage,
}, testInfo) => {
  const page = canvasPage.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const ids = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    viewport.elementRegistry.register({
      type: 'e2e:clip',
      legacyTypes: [],
      renderMode: 'canvas',
      validateData: () => true,
      decodeLegacy: (raw: unknown) => raw,
      unwrap: (element: Record<string, unknown>) => element,
      wrap: (element: Record<string, unknown>) => element,
      bounds: (element: { data: { bounds: { x: number; y: number; w: number; h: number } } }) =>
        element.data.bounds,
      clipBounds: (element: { data: { clip: { x: number; y: number; w: number; h: number } } }) =>
        element.data.clip,
      render: (
        context: CanvasRenderingContext2D,
        element: {
          data: { bounds: { x: number; y: number; w: number; h: number }; color: string };
        },
      ) => {
        const { bounds, color } = element.data;
        context.fillStyle = color;
        context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      },
    });
    const button = document.createElement('button');
    button.id = 'clipped-button';
    button.style.cssText = 'width:100%;height:100%';
    button.dataset['clicks'] = '0';
    button.addEventListener('click', () => {
      button.dataset['clicks'] = String(Number(button.dataset['clicks']) + 1);
    });
    const htmlId = viewport.addHtmlElement(
      button,
      { x: 300, y: 300 },
      { w: 80, h: 80 },
      { interactive: true },
    );
    const layerId = viewport.store.getById(htmlId).layerId;
    const extension = (
      id: string,
      color: string,
      clip: { x: number; y: number; w: number; h: number },
    ) => ({
      id,
      type: 'extension',
      extensionType: 'e2e:clip',
      position: { x: 200, y: 200 },
      index: id,
      version: 1,
      locked: false,
      layerId,
      data: { bounds: { x: 200, y: 200, w: 220, h: 220 }, clip, color },
    });
    viewport.store.add(extension('clip-root', '#e53935', { x: 240, y: 240, w: 140, h: 140 }));
    viewport.store.add(extension('clip-child', '#43a047', { x: 300, y: 300, w: 60, h: 60 }));
    viewport.store.add({
      id: 'clip-grandchild',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 200, y: 200 },
      size: { w: 220, h: 220 },
      strokeColor: '#1e88e5',
      fillColor: '#1e88e5',
      strokeWidth: 1,
      index: 'z',
      version: 1,
      locked: false,
      layerId,
    });
    viewport.setParent('clip-child', 'clip-root');
    viewport.setParent('clip-grandchild', 'clip-child');
    viewport.setParent(htmlId, 'clip-child');
    viewport.store.update(htmlId, { rotation: Math.PI / 4 });
    viewport.requestRender();
    return { htmlId };
  });
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('#clipped-button');
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return (
      button?.parentElement?.style.clipPath.startsWith('polygon') === true &&
      viewport.getElementAt({ x: 330, y: 330 })?.id === 'clip-grandchild'
    );
  });
  expect(isDominant(await samplePixel(page, { x: 220, y: 220 }), 0)).toBe(true);
  expect(isDominant(await samplePixel(page, { x: 270, y: 270 }), 1)).toBe(true);
  expect(isDominant(await samplePixel(page, { x: 330, y: 330 }), 2)).toBe(true);
  expect(
    await page.evaluate(() => {
      const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
        .__fieldnotes_viewport;
      return viewport.getElementAt({ x: 370, y: 330 })?.id ?? null;
    }),
  ).not.toBe('clip-grandchild');
  const button = page.locator('#clipped-button');
  expect(
    await button.evaluate((node) => getComputedStyle(node.parentElement as Element).clipPath),
  ).toMatch(/^polygon\(.+\)$/);
  const points = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    const wrapper = document.querySelector('#canvas > div');
    if (!wrapper) throw new Error('canvas wrapper not found');
    const box = wrapper.getBoundingClientRect();
    const pagePoint = (world: Position) => {
      const screen = viewport.camera.worldToScreen(world);
      return { x: box.x + screen.x, y: box.y + screen.y };
    };
    return { inside: pagePoint({ x: 330, y: 330 }), outside: pagePoint({ x: 370, y: 330 }) };
  });
  if (testInfo.project.name === 'ipad') await touchTap(page, points.inside);
  else await page.mouse.click(points.inside.x, points.inside.y);
  await expect.poll(() => button.getAttribute('data-clicks')).toBe('1');
  if (testInfo.project.name === 'ipad') await touchTap(page, points.outside);
  else await page.mouse.click(points.outside.x, points.outside.y);
  expect(await button.getAttribute('data-clicks')).toBe('1');
  expect(ids.htmlId).toBeTruthy();
  expect(errors).toEqual([]);
});
