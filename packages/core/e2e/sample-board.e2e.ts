import { test, expect, CanvasPage } from './fixtures/canvas-page';
import type { Page } from '@playwright/test';

const SAMPLE_TYPE_COUNTS = { text: 1, note: 4, shape: 2, arrow: 1, stroke: 1 };
const SAMPLE_TOTAL = 9;

async function gotoDemo(page: Page, query = ''): Promise<CanvasPage> {
  await page.goto(`/${query}`);
  await page.waitForSelector('#canvas canvas');
  return new CanvasPage(page);
}

async function waitForCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (n) =>
      (
        (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
          store: { count: number };
        }
      ).store.count === n,
    count,
  );
}

async function storeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: { getAll(): { id: string }[] };
      }
    ).store
      .getAll()
      .map((element) => element.id),
  );
}

async function savedBoard(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('fieldnotes', 1);
        open.onsuccess = () => {
          const get = open.result
            .transaction('state', 'readonly')
            .objectStore('state')
            .get('fieldnotes-autosave');
          get.onsuccess = () => {
            const saved: unknown = get.result;
            open.result.close();
            resolve(typeof saved === 'string' ? saved : '');
          };
        };
      }),
  );
}

async function expectSampleCounts(canvasPage: CanvasPage): Promise<void> {
  expect(await canvasPage.getElementCount()).toBe(SAMPLE_TOTAL);
  for (const [type, count] of Object.entries(SAMPLE_TYPE_COUNTS)) {
    expect(await canvasPage.getElementsByType(type), type).toHaveLength(count);
  }
}

test.describe('sample board', () => {
  test('Sample button replaces the board in one undo step', async ({ canvasPage }) => {
    const { page } = canvasPage;
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    await canvasPage.selectTool('shape');
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height * 0.7 - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height * 0.7 + 40, {
      steps: 5,
    });
    await page.mouse.up();
    await waitForCount(page, 1);
    const original = await storeIds(page);

    await page.click('#sample');
    await waitForCount(page, SAMPLE_TOTAL);
    await expectSampleCounts(canvasPage);
    expect(await storeIds(page)).not.toContain(original[0]);

    await page.click('#undo');
    await waitForCount(page, 1);
    expect(await storeIds(page)).toEqual(original);
  });

  test('?sample loads the sample at start', async ({ page }) => {
    const canvasPage = await gotoDemo(page, '?sample');
    await waitForCount(page, SAMPLE_TOTAL);
    await expectSampleCounts(canvasPage);
  });

  test('?sample leaves the saved board intact', async ({ canvasPage }) => {
    const { page } = canvasPage;
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    await canvasPage.selectTool('shape');
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height * 0.7 - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height * 0.7 + 40, {
      steps: 5,
    });
    await page.mouse.up();
    await waitForCount(page, 1);
    const original = await storeIds(page);
    await expect.poll(() => savedBoard(page)).toContain(original[0]);

    await page.clock.install();
    const samplePage = await gotoDemo(page, '?sample');
    await waitForCount(page, SAMPLE_TOTAL);
    await expectSampleCounts(samplePage);
    const sampleBox = await samplePage.wrapper().boundingBox();
    if (!sampleBox) throw new Error('Wrapper not found');
    await page.mouse.move(sampleBox.x + sampleBox.width / 2, sampleBox.y + sampleBox.height / 2);
    await page.mouse.wheel(0, 200);
    await page.clock.runFor(2000);
    expect(await savedBoard(page)).toContain(original[0]);

    await gotoDemo(page);
    await waitForCount(page, 1);
    expect(await storeIds(page)).toEqual(original);
  });
});
