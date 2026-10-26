import { expect, test } from './fixtures/canvas-page';
import { singleFingerDraw } from './helpers/touch';

interface DemoViewport {
  setParent(childId: string, parentId: string | null): void;
  setTool(name: string): void;
  getSelectedIds(): string[];
  store: {
    add(element: unknown): void;
    getById(id: string): { position: { x: number; y: number } };
  };
}

test('parent drag moves its locked subtree and selection stays literal', async ({
  canvasPage,
}, testInfo) => {
  const page = canvasPage.page;
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
    viewport.store.add(base('parent', 100, 100));
    viewport.store.add(base('child', 120, 120));
    viewport.store.add(base('grandchild', 140, 140, undefined, true));
    viewport.setParent('child', 'parent');
    viewport.setParent('grandchild', 'child');
    viewport.setTool('select');
  });
  await canvasPage.selectTool('select');
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Canvas wrapper not found');
  const from = { x: box.x + 110, y: box.y + 110 };
  const to = { x: from.x + 30, y: from.y + 20 };
  if (testInfo.project.name === 'ipad') await singleFingerDraw(page, [from, to]);
  else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
  }
  await page.waitForFunction(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return viewport.store.getById('parent').position.x === 130;
  });
  const state = await page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return {
      selected: viewport.getSelectedIds(),
      positions: ['parent', 'child', 'grandchild'].map((id) => viewport.store.getById(id).position),
    };
  });
  expect(state.selected).toEqual(['parent']);
  expect(state.positions).toEqual([
    { x: 130, y: 120 },
    { x: 150, y: 140 },
    { x: 170, y: 160 },
  ]);
  await page.click('#undo');
  await page.waitForFunction(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: DemoViewport })
      .__fieldnotes_viewport;
    return viewport.store.getById('parent').position.x === 100;
  });
});
