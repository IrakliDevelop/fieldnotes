import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { gotoBlank } from './helpers/board';
import { singleFingerDraw } from './helpers/touch';

const SAMPLE = { text: 1, note: 4, shape: 2, arrow: 1, stroke: 1 } as const;

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__playground !== undefined);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const count = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

const typeCounts = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const el of window.__playground.viewport.store.getAll()) {
      counts[el.type] = (counts[el.type] ?? 0) + 1;
    }
    return counts;
  });

async function expectSample(page: Page): Promise<void> {
  await expect.poll(() => typeCounts(page)).toMatchObject(SAMPLE);
  expect(
    await page.evaluate(() =>
      window.__playground.viewport.layerManager.getLayers().map((l) => l.name),
    ),
  ).toEqual(['Sketch', 'Notes']);
}

async function drawStroke(page: Page, testInfo: TestInfo, y = 560): Promise<void> {
  await page.keyboard.press('3');
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 200 + i * 30, y: y + i * 6 }));
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
    return;
  }
  const [first, ...rest] = points;
  if (!first) throw new Error('no points');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

async function runMenuItem(page: Page, id: string): Promise<void> {
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  await page.locator(`[data-menu-item="${id}"]`).click();
}

test('first visit loads the sample', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => window.__playground.sceneId)).toBe('whiteboard');
  await expectSample(page);
});

test('edits survive reload', async ({ page }, testInfo) => {
  await open(page);
  await expectSample(page);
  const before = await count(page);
  await drawStroke(page, testInfo);
  await expect.poll(() => count(page)).toBe(before + 1);
  const ids = await page.evaluate(() =>
    window.__playground.viewport.store.getAll().map((el) => el.id),
  );

  // 'state' is IndexedDBAdapter's default store name (packages/core/src/core/storage).
  const saved = (): Promise<string | null> =>
    page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      // Opening a DB the app has not created yet would create it without the store.
      if (!dbs.some((db) => db.name === 'fieldnotes-playground')) return null;
      return new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open('fieldnotes-playground');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const get = db
            .transaction('state', 'readonly')
            .objectStore('state')
            .get('scene:whiteboard');
          get.onsuccess = () => {
            db.close();
            resolve(typeof get.result === 'string' ? get.result : null);
          };
          get.onerror = () => reject(get.error);
        };
      });
    });
  await expect
    .poll(async () => {
      const json = await saved();
      return json !== null && ids.every((id) => json.includes(id));
    })
    .toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  await expect.poll(() => count(page)).toBe(before + 1);
});

test('Reset is one undo step', async ({ page }, testInfo) => {
  await open(page);
  await expectSample(page);
  const before = await count(page);
  await drawStroke(page, testInfo);
  await expect.poll(() => count(page)).toBe(before + 1);

  await runMenuItem(page, 'reset-board');
  await expectSample(page);
  await expect.poll(() => count(page)).toBe(before);

  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page)).toBe(before + 1);
});

test('IndexedDB failure falls back', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error('blocked');
    };
    // Toasts expire after 3 s, so log every one shown instead of sampling the zone.
    const log: string[] = [];
    Object.assign(window, { toastLog: log });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('toast')) {
            log.push(node.textContent ?? '');
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await open(page);
  await expectSample(page);
  const before = await count(page);
  await drawStroke(page, testInfo, 520);
  await drawStroke(page, testInfo, 600);
  await expect.poll(() => count(page)).toBe(before + 2);
  // Wait past AutoSave's 1 s debounce so a failing save would have had its chance to toast.
  await page.waitForTimeout(1500);

  const toasts = await page.evaluate(() =>
    (Reflect.get(window, 'toastLog') as string[]).filter((t) =>
      t.includes('Saving is unavailable'),
    ),
  );
  expect(toasts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Save then Open JSON round-trips', async ({ page }, testInfo) => {
  await open(page);
  await expectSample(page);
  const saved = await count(page);

  const downloading = page.waitForEvent('download');
  await runMenuItem(page, 'save-json');
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('fieldnotes-whiteboard.json');
  const path = testInfo.outputPath('board.json');
  await download.saveAs(path);

  await drawStroke(page, testInfo);
  await expect.poll(() => count(page)).toBe(saved + 1);

  const choosing = page.waitForEvent('filechooser');
  await runMenuItem(page, 'open-json');
  await (await choosing).setFiles(path);
  await expect.poll(() => count(page)).toBe(saved);
});

test('Export PNG and SVG download non-empty files', async ({ page }) => {
  // The tsconfig has no Node types, so read the downloaded blobs in the page instead of from disk.
  await page.addInitScript(() => {
    const blobs: Blob[] = [];
    Object.assign(window, { exportedBlobs: blobs });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) blobs.push(blob);
      return create(blob);
    };
  });
  await open(page);
  await expectSample(page);
  const lastBlob = (): Promise<{ size: number; text: string }> =>
    page.evaluate(async () => {
      const blob = (Reflect.get(window, 'exportedBlobs') as Blob[]).at(-1);
      return { size: blob?.size ?? 0, text: (await blob?.text()) ?? '' };
    });

  const png = page.waitForEvent('download');
  await runMenuItem(page, 'export-png');
  expect((await png).suggestedFilename()).toBe('fieldnotes-whiteboard.png');
  expect((await lastBlob()).size).toBeGreaterThan(0);

  const svg = page.waitForEvent('download');
  await runMenuItem(page, 'export-svg');
  expect((await svg).suggestedFilename()).toBe('fieldnotes-whiteboard.svg');
  const { size, text } = await lastBlob();
  expect(size).toBeGreaterThan(0);
  expect(text.startsWith('<svg')).toBe(true);
});

test('menu items follow the scene and close on outside click', async ({ page }) => {
  await open(page);
  const menu = page.locator('[data-chrome="menu"]');
  const button = menu.getByRole('button', { name: 'Menu' });
  const ids = ['open-json', 'save-json', 'export-png', 'export-svg', 'load-sample', 'reset-board'];

  await button.click();
  for (const id of ids) await expect(page.locator(`[data-menu-item="${id}"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');

  const topRight = page.locator('[data-chrome="top-right"]');
  for (const [id, label] of [
    ['tabletop', 'Tabletop'],
    ['whiteboard', 'Whiteboard'],
  ] as const) {
    await topRight.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__playground.sceneId)).toBe(id);
  }

  await button.click();
  for (const id of ids) await expect(page.locator(`[data-menu-item="${id}"]`)).toHaveCount(1);
  await page.mouse.click(700, 500);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-menu-item]')).toHaveCount(0);
});

test('an unreadable saved board falls back to the sample', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await expectSample(page);
  // The app has created the DB and its 'state' store by now.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('fieldnotes-playground');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('state', 'readwrite');
          tx.objectStore('state').put('{"version": "nope"', 'scene:whiteboard');
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  await expect(page.locator('[data-chrome="toast"]')).toContainText("Couldn't restore your board");
  await expectSample(page);
  expect(errors).toEqual([]);
});

test('switching scenes while the board is loading stays clean', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    // Delay every open's success handler so the first load is still pending when we switch.
    indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
      const req = open(...args);
      Object.defineProperty(req, 'onsuccess', {
        set(handler: (this: IDBRequest, event: Event) => void) {
          req.addEventListener('success', (event) =>
            setTimeout(() => handler.call(req, event), 500),
          );
        },
      });
      return req;
    };
  });
  await page.goto('/');
  const topRight = page.locator('[data-chrome="top-right"]');
  await topRight.getByRole('button', { name: 'Tabletop', exact: true }).click();
  await topRight.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__playground?.sceneId), { timeout: 10000 })
    .toBe('whiteboard');
  await expectSample(page);
  // Let the abandoned loads resolve.
  await page.waitForTimeout(1000);
  expect(await page.locator('#stage > *').count()).toBe(1);
  expect(errors).toEqual([]);
});

test('an edit right before a scene switch is saved', async ({ page }, testInfo) => {
  await open(page);
  await expectSample(page);
  const before = await count(page);
  await drawStroke(page, testInfo);
  await expect.poll(() => count(page)).toBe(before + 1);

  const topRight = page.locator('[data-chrome="top-right"]');
  for (const [id, label] of [
    ['tabletop', 'Tabletop'],
    ['whiteboard', 'Whiteboard'],
  ] as const) {
    await topRight.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__playground.sceneId)).toBe(id);
  }
  await expect.poll(() => count(page)).toBe(before + 1);
});

test('keyboard Reset board can be undone right away', async ({ page }, testInfo) => {
  await open(page);
  await expectSample(page);
  const before = await count(page);
  await drawStroke(page, testInfo);
  await expect.poll(() => count(page)).toBe(before + 1);

  const button = page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' });
  await button.focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-menu-item="reset-board"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => count(page)).toBe(before);

  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page)).toBe(before + 1);
});

test('opening an invalid JSON file toasts', async ({ page }) => {
  await open(page);
  await expectSample(page);
  const before = await count(page);
  const choosing = page.waitForEvent('filechooser');
  await runMenuItem(page, 'open-json');
  // No Node types here, so build the file in the page instead of from a buffer.
  await (await choosing).element().evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{ not json'], 'broken.json', { type: 'application/json' }));
    if (input instanceof HTMLInputElement) input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('[data-chrome="toast"]')).toContainText("Couldn't open that file");
  expect(await count(page)).toBe(before);
});

test('exporting an empty board toasts', async ({ page }) => {
  await gotoBlank(page);
  await runMenuItem(page, 'export-png');
  await expect(page.locator('[data-chrome="toast"]')).toContainText('Nothing to export');
});

test('Escape after a keyboard open returns focus to the menu button', async ({ page }) => {
  await open(page);
  const button = page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
});

test('Reset restores layer visibility, lock and opacity', async ({ page }) => {
  await open(page);
  await expectSample(page);
  await page.evaluate(() => {
    const { layerManager } = window.__playground.viewport;
    for (const layer of layerManager.getLayers()) {
      layerManager.setLayerOpacity(layer.id, 0.3);
      layerManager.setLayerLocked(layer.id, true);
    }
    const [bottom] = layerManager.getLayers();
    if (bottom) layerManager.setLayerVisible(bottom.id, false);
  });

  await runMenuItem(page, 'reset-board');
  await expectSample(page);
  expect(
    await page.evaluate(() =>
      window.__playground.viewport.layerManager
        .getLayers()
        .map(({ visible, locked, opacity }) => ({ visible, locked, opacity })),
    ),
  ).toEqual([
    { visible: true, locked: false, opacity: 1 },
    { visible: true, locked: false, opacity: 1 },
  ]);
});
