import { test, expect } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { gotoBlank } from './helpers/board';
import { singleFingerDraw } from './helpers/touch';

async function open(page: Page, scene = 'whiteboard'): Promise<void> {
  await page.goto(`/?scene=${scene}`);
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

/** Clicks Collaborate and returns the guest tab it opens. */
async function collaborate(page: Page): Promise<Page> {
  const [guest] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('[data-collaborate]').click(),
  ]);
  await guest.waitForFunction(() => window.__playground !== undefined);
  return guest;
}

async function leave(page: Page): Promise<void> {
  const toggle = page.locator('[data-collaborate]');
  // Collaborate leaves its popover open after starting a room.
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Leave room' }).click();
}

const ids = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    window.__playground.viewport.store
      .getAll()
      .map((el) => el.id)
      .sort(),
  );

async function delaySnapshots(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(BroadcastChannel.prototype, 'onmessage');
    if (!descriptor?.get || !descriptor.set)
      throw new Error('BroadcastChannel has no onmessage accessors');
    const { get, set } = descriptor;
    let delayed = 0;
    let emptySnapshotPosted = false;
    Object.defineProperty(window, '__delayedSnapshots', { get: () => delayed });
    Object.defineProperty(window, '__emptySnapshotPosted', { get: () => emptySnapshotPosted });
    Object.defineProperty(BroadcastChannel.prototype, 'onmessage', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get,
      set(handler) {
        if (handler === null) {
          set.call(this, null);
          return;
        }
        set.call(this, (event: MessageEvent) => {
          const snapshot = JSON.parse(String(event.data)).op?.kind === 'snapshot';
          if (snapshot) {
            setTimeout(() => {
              delayed++;
              handler.call(this, event);
            }, 500);
          } else handler.call(this, event);
        });
      },
    });
    const postMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message) {
      const op = JSON.parse(String(message)).op;
      emptySnapshotPosted =
        op?.kind === 'snapshot' && Array.isArray(op.elements) && op.elements.length === 0;
      return postMessage.call(this, message);
    };
  });
}

const count = (page: Page): Promise<number> =>
  page.evaluate(() => window.__playground.viewport.store.count);

const layerNames = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__playground.viewport.layerManager.getLayers().map((l) => l.name));

const fogState = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify(window.__playground.fog?.getState() ?? null));

const counterValue = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const counter = window.__playground.viewport.store
      .getAll()
      .find((el) => el.type === 'html' && el.htmlType === 'pg:counter');
    return counter?.type === 'html' ? counter.data?.['value'] : undefined;
  });

async function drag(
  page: Page,
  testInfo: TestInfo,
  points: { x: number; y: number }[],
): Promise<void> {
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(page, points);
    return;
  }
  const [first, ...rest] = points;
  if (!first) throw new Error('drag needs points');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

/** Screen points along a horizontal line through world `(x0..x1, y)`. */
const worldLine = (
  page: Page,
  x0: number,
  x1: number,
  y: number,
): Promise<{ x: number; y: number }[]> =>
  page.evaluate(
    ({ x0, x1, y }) => {
      const { viewport } = window.__playground;
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('no stage');
      const rect = stage.getBoundingClientRect();
      return [0, 1, 2, 3, 4, 5].map((i) => {
        const p = viewport.camera.worldToScreen({ x: x0 + ((x1 - x0) * i) / 5, y });
        return { x: rect.left + p.x, y: rect.top + p.y };
      });
    },
    { x0, x1, y },
  );

test('element and layer sync', async ({ page }, testInfo) => {
  await open(page);
  const guest = await collaborate(page);
  await expect.poll(() => ids(guest)).toEqual(await ids(page));
  await expect.poll(() => layerNames(guest)).toEqual(['Sketch', 'Notes']);

  const before = await count(page);
  await page.keyboard.press('3');
  await drag(
    page,
    testInfo,
    [0, 1, 2, 3, 4, 5].map((i) => ({ x: 300 + i * 30, y: 600 + i * 10 })),
  );
  await expect.poll(() => count(page)).toBe(before + 1);
  await page.evaluate(() => window.__playground.viewport.layerManager.createLayer('Ink'));

  await expect.poll(() => ids(guest)).toEqual(await ids(page));
  await expect.poll(() => layerNames(guest)).toEqual(['Sketch', 'Notes', 'Ink']);
});

test('widget renders and edits flow back', async ({ page }, testInfo) => {
  await gotoBlank(page, 'embeds');
  const guest = await collaborate(page);
  const tools = page.locator('[data-chrome="tools"]');
  await tools.getByRole('button', { name: 'Insert', exact: true }).click();
  await tools.getByRole('menuitemradio', { name: 'Counter' }).click();
  await page.mouse.click(400, 500);
  await expect.poll(() => count(page)).toBe(1);
  const [id] = await ids(page);

  const node = guest.locator(`[data-element-id="${id}"]`);
  await expect(node.locator('.pg-counter-value')).toHaveText('0');
  await expect(node.locator('.fn-html-placeholder')).toHaveCount(0);

  const box = await node.boundingBox();
  if (!box) throw new Error('widget not visible');
  const point = { x: box.x + 12, y: box.y + 8 };
  if (testInfo.project.name === 'ipad') {
    await singleFingerDraw(guest, [point]);
    await singleFingerDraw(guest, [point]);
  } else {
    await guest.mouse.dblclick(point.x, point.y);
  }
  await expect.poll(() => node.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  await node.getByRole('button', { name: 'Increase' }).click();

  await expect.poll(() => counterValue(page)).toBe(1);
  await expect(page.locator(`[data-element-id="${id}"] .pg-counter-value`)).toHaveText('1');
});

test('guest is a guest', async ({ page }) => {
  await open(page);
  const guest = await collaborate(page);
  const hostFlags = (p: Page): Promise<string[]> =>
    p.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith('fieldnotes-playground:host:')),
    );
  expect(await hostFlags(page)).toHaveLength(1);
  expect(await hostFlags(guest)).toEqual([]);
});

test('a new room keeps the host board when snapshots cross', async ({ page, context }) => {
  await open(page);
  const hostIds = await ids(page);
  expect(hostIds).not.toEqual([]);

  await delaySnapshots(context);
  const guest = await collaborate(page);

  await expect
    .poll(() => guest.evaluate(() => Reflect.get(window, '__emptySnapshotPosted')))
    .toBe(true);
  await page.waitForTimeout(250);
  expect(await ids(page)).toEqual(hostIds);
  await expect.poll(() => guest.evaluate(() => Reflect.get(window, '__delayedSnapshots'))).toBe(1);
  await expect
    .poll(async () => ({ host: await ids(page), guest: await ids(guest) }))
    .toEqual({ host: hostIds, guest: hostIds });
});

test('the tab Collaborate opens is marked guest in its URL; the host URL is not', async ({
  page,
}) => {
  await open(page);
  const guest = await collaborate(page);
  expect(new URL(guest.url()).searchParams.has('guest')).toBe(true);
  expect(new URL(page.url()).searchParams.has('guest')).toBe(false);
});

test('a guest URL wins over a host flag copied into the tab', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('fieldnotes-playground:host:dup1', '1');
  });
  await page.goto('/?scene=tabletop&room=dup1&guest');
  await page.waitForFunction(() => window.__playground !== undefined);
  expect(await page.evaluate(() => window.__playground.fog?.getViewMode())).toBe('player');
  await expect(
    page.locator('[data-chrome="tools"]').getByRole('button', { name: 'Fog', exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem('fieldnotes-playground:host:dup1')),
  ).toBeNull();
});

test('guest reload keeps the board', async ({ page }) => {
  await open(page);
  const guest = await collaborate(page);
  const hostIds = await ids(page);
  await expect.poll(() => ids(guest)).toEqual(hostIds);

  await guest.reload();
  await guest.waitForFunction(() => window.__playground !== undefined);
  await expect.poll(() => ids(guest)).toEqual(hostIds);
  expect(await count(guest)).toBe(hostIds.length);
  expect(await ids(page)).toEqual(hostIds);
});

test('tabletop fog syncs', async ({ page }, testInfo) => {
  await open(page, 'tabletop');
  const guest = await collaborate(page);
  await expect.poll(() => ids(guest)).toEqual(await ids(page));
  const before = await fogState(guest);

  await page.keyboard.press('6');
  // Below the sample's revealed corridor, inside the covered fog bounds.
  await drag(page, testInfo, await worldLine(page, 450, 750, 600));

  await expect.poll(() => fogState(guest)).not.toBe(before);
  await expect.poll(() => fogState(guest)).toBe(await fogState(page));
});

test('a deletion survives a host reload', async ({ page }) => {
  await open(page);
  const guest = await collaborate(page);
  await expect.poll(() => ids(guest)).toEqual(await ids(page));
  const [removed] = await ids(page);
  if (!removed) throw new Error('empty sample');
  await page.evaluate((id) => window.__playground.viewport.store.remove(id), removed);
  await expect.poll(async () => (await ids(guest)).includes(removed)).toBe(false);

  await page.reload();
  await page.waitForFunction(() => window.__playground !== undefined);
  await expect.poll(async () => (await ids(page)).includes(removed)).toBe(false);
  expect(await ids(page)).toEqual(await ids(guest));
  expect((await ids(guest)).includes(removed)).toBe(false);
});

test('leave room restores and does not leak', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.BroadcastChannel;
    let open = 0;
    class Counted extends Native {
      private closed = false;
      constructor(name: string) {
        super(name);
        open += 1;
      }
      override close(): void {
        if (!this.closed) open -= 1;
        this.closed = true;
        super.close();
      }
    }
    window.BroadcastChannel = Counted;
    Object.defineProperty(window, '__openChannels', { get: () => open });
  });
  const errors = collectErrors(page);
  await open(page);
  const saved = await ids(page);

  const guest = await collaborate(page);
  await expect.poll(() => ids(guest)).toEqual(saved);
  await page.evaluate(() => window.__playground.viewport.layerManager.createLayer('Room only'));
  await leave(page);
  await expect(page).not.toHaveURL(/room=/);
  await expect.poll(() => ids(page)).toEqual(saved);
  await expect.poll(() => layerNames(page)).toEqual(['Sketch', 'Notes']);

  for (let i = 0; i < 3; i++) {
    await collaborate(page);
    await expect(page).toHaveURL(/room=/);
    await leave(page);
    await expect(page).not.toHaveURL(/room=/);
  }
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__openChannels'))).toBe(0);
  expect(await page.locator('#stage > *').count()).toBe(1);
  expect(errors).toEqual([]);
});

test('Copy link shows Link copied and writes the room URL', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await collaborate(page);
  const copy = page.getByRole('button', { name: 'Copy link' });
  const toast = page.locator('[data-chrome="toast"]');
  await copy.click();
  await expect(toast).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());

  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  });
  await copy.click();
  await expect(toast).toHaveText("Couldn't copy the link");
});
