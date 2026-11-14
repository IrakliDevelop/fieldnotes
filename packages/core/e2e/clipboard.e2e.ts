import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/canvas-page';

interface Point {
  x: number;
  y: number;
}

interface TestElement {
  id: string;
  type: string;
  link?: string;
  position: Point;
  size: { w: number; h: number };
}

interface TestWindow {
  __fieldnotes_viewport: {
    store: {
      count: number;
      clear: () => void;
      add: (element: unknown) => void;
      getAll: () => TestElement[];
    };
    camera: { screenToWorld: (point: Point) => Point };
    layerManager: { activeLayerId: string };
    exportJSON: () => string;
  };
}

async function clearBoard(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as TestWindow).__fieldnotes_viewport.store.clear();
  });
}

async function addShape(page: Page, id: string, index: string, position: Point): Promise<void> {
  await page.evaluate(
    ({ id, index, position }) => {
      const vp = (window as unknown as TestWindow).__fieldnotes_viewport;
      vp.store.add({
        id,
        type: 'shape',
        shape: 'rectangle',
        position,
        size: { w: 120, h: 80 },
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: 'none',
        index,
        version: 1,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
      });
    },
    { id, index, position },
  );
}

async function paste(page: Page, data: Record<string, string>): Promise<void> {
  await page.locator('#canvas > div').evaluate((wrapper, data) => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(data)) dt.setData(type, value);
    wrapper.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, data);
}

test.describe('clipboard', () => {
  test('pasting a URL creates a linked text element that one undo removes', async ({
    canvasPage,
  }) => {
    const { page } = canvasPage;
    await clearBoard(page);
    await canvasPage.wrapper().focus();

    await paste(page, { 'text/plain': 'https://example.com' });
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__fieldnotes_viewport.store.count === 1,
    );
    const pasted = await page.evaluate(() =>
      (window as unknown as TestWindow).__fieldnotes_viewport.store
        .getAll()
        .map(({ type, link }) => ({ type, link })),
    );
    expect(pasted).toEqual([{ type: 'text', link: 'https://example.com' }]);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__fieldnotes_viewport.store.count === 0,
    );
  });

  test('copy then paste round-trips through the vendor format with new ids', async ({
    canvasPage,
  }) => {
    const { page } = canvasPage;
    await clearBoard(page);
    await addShape(page, 'copy-a', 'a0', { x: 0, y: 0 });
    await addShape(page, 'copy-b', 'a1', { x: 200, y: 40 });
    await canvasPage.selectTool('select');
    await canvasPage.wrapper().focus();
    await page.keyboard.press('Control+a');

    const vendor = await canvasPage.wrapper().evaluate((wrapper) => {
      const dt = new DataTransfer();
      wrapper.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      return dt.getData('fieldnotes/clipboard');
    });
    const envelope = JSON.parse(vendor) as { type: string; elements: { id: string }[] };
    expect(envelope.type).toBe('fieldnotes/clipboard');
    expect(envelope.elements.map((el) => el.id).sort()).toEqual(['copy-a', 'copy-b']);

    await clearBoard(page);
    await paste(page, { 'fieldnotes/clipboard': vendor });
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__fieldnotes_viewport.store.count === 2,
    );
    const ids = await page.evaluate(() =>
      (window as unknown as TestWindow).__fieldnotes_viewport.store.getAll().map((el) => el.id),
    );
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('copy-a');
    expect(ids).not.toContain('copy-b');
  });

  test('dropping a .fieldnotes file inserts at the pointer', async ({ canvasPage }) => {
    const { page } = canvasPage;
    await clearBoard(page);
    await addShape(page, 'drop-source', 'a0', { x: 0, y: 0 });
    const json = await page.evaluate(() =>
      (window as unknown as TestWindow).__fieldnotes_viewport.exportJSON(),
    );
    await clearBoard(page);

    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    // Off-centre, so a centred fallback anchor cannot pass.
    const client = { x: box.x + 150, y: box.y + 120 };
    await canvasPage.wrapper().evaluate(
      (wrapper, { json, client }) => {
        const dt = new DataTransfer();
        dt.items.add(
          new File([json], 'board.fieldnotes', { type: 'application/vnd.fieldnotes+json' }),
        );
        wrapper.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: dt,
            clientX: client.x,
            clientY: client.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { json, client },
    );
    await page.waitForFunction(
      () => (window as unknown as TestWindow).__fieldnotes_viewport.store.count === 1,
    );

    const { centre, pointer } = await canvasPage.wrapper().evaluate((wrapper, client) => {
      const vp = (window as unknown as TestWindow).__fieldnotes_viewport;
      const rect = wrapper.getBoundingClientRect();
      const [el] = vp.store.getAll();
      if (!el) throw new Error('No element inserted');
      return {
        centre: { x: el.position.x + el.size.w / 2, y: el.position.y + el.size.h / 2 },
        pointer: vp.camera.screenToWorld({ x: client.x - rect.left, y: client.y - rect.top }),
      };
    }, client);
    expect(Math.abs(centre.x - pointer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - pointer.y)).toBeLessThanOrEqual(1);
  });
});
