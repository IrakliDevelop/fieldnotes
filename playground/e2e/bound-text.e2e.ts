import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface BoundTextState {
  ellipse: { id: string; position: { x: number; y: number } };
  text:
    | {
        text: string;
        parentId: string | undefined;
        containerId: string | undefined;
        position: { x: number; y: number };
      }
    | undefined;
  sampleText: string[];
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function state(page: Page, ellipseId?: string): Promise<BoundTextState> {
  return page.evaluate((id) => {
    const elements = window.__playground.viewport.store.getAll();
    const ellipse = elements.find(
      (element) =>
        element.type === 'shape' &&
        element.shape === 'ellipse' &&
        (id === undefined ? element.position.x === 480 : element.id === id),
    );
    if (!ellipse || ellipse.type !== 'shape') throw new Error('Sample ellipse is missing');
    const text = elements.find(
      (element) =>
        element.type === 'text' &&
        element.parentId === ellipse.id &&
        element.containerId === ellipse.id,
    );
    return {
      ellipse: { id: ellipse.id, position: ellipse.position },
      text:
        text && text.type === 'text'
          ? {
              text: text.text,
              parentId: text.parentId,
              containerId: text.containerId,
              position: text.position,
            }
          : undefined,
      sampleText: elements
        .filter((element) => element.type === 'text')
        .map((element) => element.text),
    };
  }, ellipseId);
}

async function ellipseCenter(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const point = window.__playground.viewport.camera.worldToScreen({ x: 570, y: 415 });
    const stage = document.querySelector('#stage')?.getBoundingClientRect();
    if (!stage) throw new Error('Stage is missing');
    return { x: stage.x + point.x, y: stage.y + point.y };
  });
}

async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...from, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: from.x + dx, y: from.y + dy, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function isSaved(page: Page, expected: BoundTextState): Promise<boolean> {
  return page.evaluate(
    (expectedState) =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open('fieldnotes-playground');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction('state', 'readonly')
            .objectStore('state')
            .get('scene:whiteboard');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            if (typeof get.result !== 'string' || !expectedState.text) return resolve(false);
            const board: unknown = JSON.parse(get.result);
            if (
              !board ||
              typeof board !== 'object' ||
              !('elements' in board) ||
              !Array.isArray(board.elements)
            ) {
              return resolve(false);
            }
            const ellipse = board.elements.find(
              (element) =>
                element &&
                typeof element === 'object' &&
                'id' in element &&
                element.id === expectedState.ellipse.id &&
                'position' in element &&
                JSON.stringify(element.position) === JSON.stringify(expectedState.ellipse.position),
            );
            const text = board.elements.find(
              (element) =>
                element &&
                typeof element === 'object' &&
                'type' in element &&
                element.type === 'text' &&
                'text' in element &&
                element.text === expectedState.text.text &&
                'parentId' in element &&
                element.parentId === expectedState.text.parentId &&
                'containerId' in element &&
                element.containerId === expectedState.text.containerId &&
                'position' in element &&
                JSON.stringify(element.position) === JSON.stringify(expectedState.text.position),
            );
            resolve(ellipse !== undefined && text !== undefined);
          };
        };
      }),
    expected,
  );
}

test('whiteboard bound text edits, moves, and persists', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__playground?.sceneId === 'whiteboard');
  expect((await state(page)).sampleText).toEqual(expect.arrayContaining(['Rectangle', 'connects']));

  const center = await ellipseCenter(page);
  if (testInfo.project.name === 'ipad') {
    await touchDrag(page, center, 0, 0);
    await touchDrag(page, center, 0, 0);
  } else {
    await page.mouse.dblclick(center.x, center.y);
  }
  const editor = page.locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await page.keyboard.type('Ellipse');
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toMatchObject({ text: { text: 'Ellipse' } });

  const before = await state(page);
  if (testInfo.project.name === 'ipad') {
    await touchDrag(page, center, 40, 30);
  } else {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 30, { steps: 4 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => (await state(page, before.ellipse.id)).ellipse.position)
    .not.toEqual(before.ellipse.position);
  const moved = await state(page, before.ellipse.id);
  if (!moved.text || !before.text) throw new Error('Expected ellipse bound text');
  expect(moved.text.position.x - before.text.position.x).toBeCloseTo(
    moved.ellipse.position.x - before.ellipse.position.x,
  );
  expect(moved.text.position.y - before.text.position.y).toBeCloseTo(
    moved.ellipse.position.y - before.ellipse.position.y,
  );
  await expect.poll(() => isSaved(page, moved)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__playground?.sceneId === 'whiteboard');
  await page.waitForFunction(
    (id) => window.__playground.viewport.store.getById(id) !== undefined,
    before.ellipse.id,
  );
  await expect.poll(() => state(page, before.ellipse.id)).toEqual(moved);
  expect(errors).toEqual([]);
});
