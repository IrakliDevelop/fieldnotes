import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { singleFingerDraw } from './helpers/touch';
import { gotoBlank } from './helpers/board';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name);

const elementCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

test('loads the whiteboard with zero console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoBlank(page);
  expect(await page.evaluate(() => window.__playground.sceneId)).toBe('whiteboard');
  expect(errors).toEqual([]);
});

test('keys switch tools', async ({ page }) => {
  await gotoBlank(page);
  for (const [key, name, label] of [
    ['3', 'pencil', 'Pencil'],
    ['7', 'shape', 'Shape'],
    ['l', 'laser', 'Laser'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => activeTool(page)).toBe(name);
    await expect(
      page.locator('[data-chrome="tools"]').getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
});

test('draw then undo', async ({ page }, testInfo) => {
  await gotoBlank(page);
  await page.keyboard.press('3');
  await expect.poll(() => activeTool(page)).toBe('pencil');
  const before = await elementCount(page);

  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 300 + i * 30, y: 400 + i * 10 }));
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
  } else {
    const [first, ...rest] = points;
    if (!first) throw new Error('no points');
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
    await page.mouse.up();
  }
  await expect.poll(() => elementCount(page)).toBe(before + 1);

  await page.keyboard.press('Control+z');
  await expect.poll(() => elementCount(page)).toBe(before);
});

test('shortcut guard', async ({ page }) => {
  await gotoBlank(page);
  await page.keyboard.press('8');
  await expect.poll(() => activeTool(page)).toBe('note');
  await page.mouse.click(400, 400);
  await expect.poll(() => elementCount(page)).toBe(1);
  const afterPlacement = await activeTool(page);
  // Core focuses the note editor a frame after placement; typing earlier hits the shortcuts.
  const editor = page.locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeFocused();

  await page.keyboard.type('123');
  await expect(editor).toHaveText('123');
  expect(await activeTool(page)).toBe(afterPlacement);
});

test('scene switching does not leak', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoBlank(page);
  const topRight = page.locator('[data-chrome="top-right"]');
  for (let round = 0; round < 2; round++) {
    for (const [id, label] of [
      ['tabletop', 'Tabletop'],
      ['embeds', 'Embeds'],
      ['whiteboard', 'Whiteboard'],
    ] as const) {
      await topRight.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__playground.sceneId)).toBe(id);
      expect(new URL(page.url()).searchParams.get('scene')).toBe(id);
      expect(await page.locator('#stage > *').count()).toBe(1);
    }
  }
  expect(errors).toEqual([]);
});

async function countWindowListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<unknown, Set<string>>();
    const keyOf = (type: string, options?: boolean | EventListenerOptions): string =>
      `${type}|${typeof options === 'boolean' ? options : Boolean(options?.capture)}`;
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      add(type, listener, options);
      const signal = typeof options === 'object' ? options.signal : undefined;
      if (signal?.aborted) return;
      const key = keyOf(type, options);
      const keys = listeners.get(listener) ?? new Set<string>();
      listeners.set(listener, keys);
      keys.add(key);
      signal?.addEventListener('abort', () => keys.delete(key));
    };
    window.removeEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void => {
      remove(type, listener, options);
      listeners.get(listener)?.delete(keyOf(type, options));
    };
    Object.defineProperty(window, '__windowListeners', {
      get: () => [...listeners.values()].reduce((total, keys) => total + keys.size, 0),
    });
    const append = Element.prototype.append;
    Element.prototype.append = function (this: Element, ...nodes: (Node | string)[]): void {
      const [first] = nodes;
      const accept: unknown = Reflect.get(window, '__failInput');
      if (first instanceof HTMLInputElement && accept && first.accept === accept) {
        Reflect.deleteProperty(window, '__failInput');
        throw new Error('Injected append failure');
      }
      append.apply(this, nodes);
    };
  });
}

const windowListeners = (page: Page): Promise<unknown> =>
  page.evaluate(() => Reflect.get(window, '__windowListeners'));

const sceneId = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => Reflect.get(window, '__playground')?.sceneId);

test('a scene that fails mid-mount leaves no window listeners', async ({ page }) => {
  await countWindowListeners(page);
  await gotoBlank(page);
  const before = await windowListeners(page);
  await page.evaluate(() => Reflect.set(window, '__failInput', 'image/*'));
  const topRight = page.locator('[data-chrome="top-right"]');
  await topRight.getByRole('button', { name: 'Embeds', exact: true }).click();
  await expect.poll(() => sceneId(page)).toBe('embeds');
  await topRight.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(page.getByText("Couldn't open that scene")).toBeVisible();
  await topRight.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect.poll(() => sceneId(page)).toBe('whiteboard');
  await expect.poll(() => windowListeners(page)).toBe(before);
});

test('attach failure leaves no window listeners', async ({ page }) => {
  await countWindowListeners(page);
  await gotoBlank(page);
  const before = await windowListeners(page);
  const topRight = page.locator('[data-chrome="top-right"]');
  await topRight.getByRole('button', { name: 'Embeds', exact: true }).click();
  await expect.poll(() => sceneId(page)).toBe('embeds');
  await page.evaluate(() => Reflect.set(window, '__failInput', '.json,application/json'));
  await topRight.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(page.getByText("Couldn't open that scene")).toBeVisible();
  await topRight.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect.poll(() => sceneId(page)).toBe('whiteboard');
  await expect.poll(() => windowListeners(page)).toBe(before);
});
