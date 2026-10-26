import { expect, test } from './fixtures/canvas-page';
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
    getById(id: string): { position: Position };
  };
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

test('nested extension clips constrain an interactive DOM descendant', async ({ canvasPage }) => {
  const page = canvasPage.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.evaluate(() => {
    const viewport = (
      window as unknown as {
        __fieldnotes_viewport: {
          elementRegistry: { register: (definition: Record<string, unknown>) => void };
          store: {
            add: (element: Record<string, unknown>) => void;
            getById: (id: string) => { layerId: string } | undefined;
          };
          setParent: (child: string, parent: string | null) => void;
          addHtmlElement: (
            node: HTMLElement,
            position: Position,
            size: { w: number; h: number },
            options: { interactive: boolean },
          ) => string;
          requestRender: () => void;
        };
      }
    ).__fieldnotes_viewport;
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
      render: () => undefined,
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
      { w: 120, h: 120 },
      { interactive: true },
    );
    const layerId = viewport.store.getById(htmlId)?.layerId;
    if (!layerId) throw new Error('html layer missing');
    const extension = (id: string, clip: { x: number; y: number; w: number; h: number }) => ({
      id,
      type: 'extension',
      extensionType: 'e2e:clip',
      position: { x: 300, y: 300 },
      index: id,
      version: 1,
      locked: false,
      layerId,
      data: { bounds: { x: 300, y: 300, w: 120, h: 120 }, clip },
    });
    viewport.store.add(extension('clip-root', { x: 320, y: 320, w: 80, h: 80 }));
    viewport.store.add(extension('clip-child', { x: 340, y: 340, w: 40, h: 40 }));
    viewport.setParent('clip-child', 'clip-root');
    viewport.setParent(htmlId, 'clip-child');
    viewport.requestRender();
  });
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('#clipped-button');
    return button?.parentElement?.style.clipPath.startsWith('polygon') ?? false;
  });
  const button = page.locator('#clipped-button');
  const box = await button.boundingBox();
  if (!box) throw new Error('clipped button not mounted');
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, {
      x: box.x + 60,
      y: box.y + 60,
    }),
  ).toBe('clipped-button');
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.mouse.click(box.x + 10, box.y + 10);
  expect(await button.getAttribute('data-clicks')).toBe('1');
  expect(errors).toEqual([]);
});
