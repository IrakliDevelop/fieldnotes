import { test, expect } from '@playwright/test';
import type { SelectTool } from '@fieldnotes/core';
import { gotoBlank } from './helpers/board';
import { singleFingerDraw } from './helpers/touch';

test('Frame tool creates a selected frame with one undo step', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await gotoBlank(page);
  const button = page.getByRole('button', { name: /Frame/ });
  await expect(button).toBeVisible();
  await button.click();
  expect(await page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name)).toBe(
    'frame',
  );
  await page.keyboard.press('v');
  await page.keyboard.press('f');
  expect(await page.evaluate(() => window.__playground.viewport.toolManager.activeTool?.name)).toBe(
    'frame',
  );
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  if (!box) throw new Error('missing stage');
  const points = [
    { x: box.x + 100, y: box.y + 100 },
    { x: box.x + 230, y: box.y + 180 },
  ];
  const [start, end] = points;
  if (!start || !end) throw new Error('missing drag points');
  if (testInfo.project.name === 'ipad') await singleFingerDraw(page, points);
  else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => window.__playground.viewport.store.count)).toBe(1);
  expect(
    await page.evaluate(() => ({
      selected: window.__playground.viewport.getSelectedIds(),
      tool: window.__playground.viewport.toolManager.activeTool?.name,
      undo: window.__playground.viewport.history.undoCount,
    })),
  ).toEqual({ tool: 'select', undo: 1, selected: [expect.any(String)] });
  expect(
    await page.evaluate(() => {
      const viewport = window.__playground.viewport;
      const [id] = viewport.getSelectedIds();
      const element = id ? viewport.store.getById(id) : undefined;
      if (!element || element.type !== 'extension') return null;
      return {
        id,
        type: element.extensionType,
        locked: element.locked,
        parentId: element.parentId,
      };
    }),
  ).toEqual({ id: expect.any(String), type: 'core:frame', locked: false, parentId: undefined });
  expect(errors).toEqual([]);
});

test('frames, dissolves, undoes, and exports only the selected root frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const blobs: Blob[] = [];
    Object.assign(window, { frameBlobs: blobs });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) blobs.push(blob);
      return create(blob);
    };
  });
  await gotoBlank(page);
  const result = await page.evaluate(() => {
    const viewport = window.__playground.viewport;
    const layerId = viewport.layerManager.activeLayerId;
    const shape = (id: string, x: number) => ({
      id,
      type: 'shape' as const,
      shape: 'rectangle' as const,
      position: { x, y: 100 },
      size: { w: 80, h: 60 },
      index: id === 'a' ? 'a0' : id === 'b' ? 'a1' : 'a2',
      version: 1,
      locked: false,
      layerId,
      fillColor: id === 'a' ? '#22c55e' : '#facc15',
      strokeColor: '#000',
      strokeWidth: 0,
    });
    viewport.store.add(shape('a', 100));
    viewport.store.add(shape('b', 220));
    viewport.store.add({
      ...shape('overlap', 300),
      fillColor: '#ef4444',
      strokeColor: '#ef4444',
    });
    const select = viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('select tool is missing');
    select.setSelection(['a', 'b']);
    viewport.runAction('selection.frame');
    const frameId = viewport.getSelectedIds()[0];
    if (!frameId) throw new Error('frame was not selected');
    const snapshot = () => ({
      selection: viewport.getSelectedIds(),
      elements: viewport.store
        .getAll()
        .filter((element) => ['a', 'b', 'overlap', frameId].includes(element.id))
        .map((element) => ({
          id: element.id,
          parentId: element.parentId,
          index: element.index,
          position: element.position,
          size: 'size' in element ? element.size : undefined,
          type: element.type === 'extension' ? element.extensionType : element.type,
        })),
    });
    const framed = snapshot();
    select.setSelection([frameId]);
    viewport.runAction('selection.dissolve-frame');
    const dissolved = snapshot();
    viewport.undo();
    const restored = snapshot();
    return { frameId, framed, dissolved, restored };
  });
  expect(result.framed).toMatchObject({
    selection: [result.frameId],
    elements: [
      {
        id: result.frameId,
        parentId: undefined,
        position: { x: 76, y: 52 },
        size: { w: 248, h: 132 },
        type: 'core:frame',
      },
      {
        id: 'a',
        parentId: result.frameId,
        position: { x: 100, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
      {
        id: 'b',
        parentId: result.frameId,
        position: { x: 220, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
      {
        id: 'overlap',
        parentId: undefined,
        position: { x: 300, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
    ],
  });
  expect(result.dissolved).toMatchObject({
    selection: [],
    elements: [
      {
        id: 'a',
        parentId: undefined,
        position: { x: 100, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
      {
        id: 'b',
        parentId: undefined,
        position: { x: 220, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
      {
        id: 'overlap',
        parentId: undefined,
        position: { x: 300, y: 100 },
        size: { w: 80, h: 60 },
        type: 'shape',
      },
    ],
  });
  expect(result.restored).toEqual({ ...result.framed, selection: [] });
  await page.evaluate((frameId) => {
    const select = window.__playground.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('select tool is missing');
    select.setSelection([frameId]);
  }, result.frameId);
  expect(await page.evaluate(() => window.__playground.viewport.getSelectedIds())).toEqual([
    result.frameId,
  ]);
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  const download = page.waitForEvent('download');
  await page.locator('[data-menu-item="export-svg"]').click();
  expect((await download).suggestedFilename()).toBe('fieldnotes-whiteboard.svg');
  const svg = await page.evaluate(
    async () => (await (Reflect.get(window, 'frameBlobs') as Blob[]).at(-1)?.text()) ?? '',
  );
  expect(
    await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
      return {
        viewBox: doc.documentElement.getAttribute('viewBox'),
        fills: [...doc.querySelectorAll('[fill]')].map((element) => element.getAttribute('fill')),
        text: doc.textContent,
      };
    }, svg),
  ).toEqual({ viewBox: '76 76 248 108', fills: ['#22c55e', '#facc15'], text: null });
  const pngDownload = page.waitForEvent('download');
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  await page.locator('[data-menu-item="export-png"]').click();
  expect((await pngDownload).suggestedFilename()).toBe('fieldnotes-whiteboard.png');
  expect(
    await page.evaluate(async () => {
      const blob = (Reflect.get(window, 'frameBlobs') as Blob[]).at(-1);
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const sample = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
      return {
        width: bitmap.width,
        height: bitmap.height,
        corner: sample(0, 0),
        green: sample(80, 80),
        yellow: sample(328, 88),
        overlap: sample(458, 88),
      };
    }),
  ).toEqual({
    width: 496,
    height: 216,
    corner: [0, 0, 0, 0],
    green: [34, 197, 94, 255],
    yellow: [250, 204, 21, 255],
    overlap: [0, 0, 0, 0],
  });
  await page.evaluate(() => {
    const select = window.__playground.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('select tool is missing');
    select.setSelection([]);
  });
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  const boardPngDownload = page.waitForEvent('download');
  await page.locator('[data-menu-item="export-png"]').click();
  expect((await boardPngDownload).suggestedFilename()).toBe('fieldnotes-whiteboard.png');
  const boardPng = await page.evaluate(async () => {
    const blob = (Reflect.get(window, 'frameBlobs') as Blob[]).at(-1);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      corner: [...context.getImageData(0, 0, 1, 1).data],
      red: [...context.getImageData(572, 260, 1, 1).data],
    };
  });
  expect(boardPng).toEqual({
    width: 736,
    height: 392,
    corner: [255, 255, 255, 255],
    red: [239, 68, 68, 255],
  });
  await page.locator('[data-chrome="menu"]').getByRole('button', { name: 'Menu' }).click();
  const boardSvgDownload = page.waitForEvent('download');
  await page.locator('[data-menu-item="export-svg"]').click();
  expect((await boardSvgDownload).suggestedFilename()).toBe('fieldnotes-whiteboard.svg');
  const boardSvg = await page.evaluate(
    async () => (await (Reflect.get(window, 'frameBlobs') as Blob[]).at(-1)?.text()) ?? '',
  );
  expect(boardSvg).toContain('viewBox="44 20 368 196"');
  expect(boardSvg).toContain('#ef4444');
  expect(errors).toEqual([]);
});

test('moves a frame and its members by one pointer delta, then restores them with undo', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await gotoBlank(page);
  const frame = await page.evaluate(() => {
    const viewport = window.__playground.viewport;
    const layerId = viewport.layerManager.activeLayerId;
    for (const [id, x] of [
      ['move-a', 100],
      ['move-b', 220],
    ] as const) {
      viewport.store.add({
        id,
        type: 'shape',
        shape: 'rectangle',
        position: { x, y: 100 },
        size: { w: 80, h: 60 },
        index: id,
        version: 1,
        locked: false,
        layerId,
        fillColor: '#22c55e',
        strokeColor: '#000000',
        strokeWidth: 0,
      });
    }
    const select = viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('select tool is missing');
    select.setSelection(['move-a', 'move-b']);
    viewport.runAction('selection.frame');
    const id = viewport.getSelectedIds()[0];
    const element = id ? viewport.store.getById(id) : undefined;
    if (!id || !element || !('size' in element)) throw new Error('frame unavailable');
    return { id, position: element.position, size: element.size };
  });
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('missing stage');
  const start = { x: stage.x + frame.position.x + 20, y: stage.y + frame.position.y + 12 };
  const end = { x: start.x + 30, y: start.y + 20 };
  if (testInfo.project.name === 'ipad') await singleFingerDraw(page, [start, end]);
  else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
  }
  const moved = await page.evaluate(
    (id) =>
      window.__playground.viewport.store
        .getAll()
        .filter((element) => element.id === id || element.parentId === id)
        .map((element) => ({ id: element.id, position: element.position })),
    frame.id,
  );
  expect(moved).toEqual(
    expect.arrayContaining([
      { id: frame.id, position: { x: frame.position.x + 30, y: frame.position.y + 20 } },
      { id: 'move-a', position: { x: 130, y: 120 } },
      { id: 'move-b', position: { x: 250, y: 120 } },
    ]),
  );
  await page.evaluate(() => window.__playground.viewport.undo());
  expect(
    await page.evaluate((id) => window.__playground.viewport.store.getById(id)?.position, frame.id),
  ).toEqual(frame.position);
  expect(errors).toEqual([]);
});

test('resizes a frame without moving children and clips the crossed child edge', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await gotoBlank(page);
  const fixture = await page.evaluate(() => {
    const viewport = window.__playground.viewport;
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add({
      id: 'resize-frame',
      type: 'extension',
      extensionType: 'core:frame',
      position: { x: 100, y: 100 },
      size: { w: 240, h: 140 },
      index: 'a',
      version: 1,
      locked: false,
      layerId,
      dataVersion: 1,
      data: { title: 'Resize', color: '#6366f1' },
    });
    viewport.store.add({
      id: 'resize-child',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 250, y: 150 },
      size: { w: 80, h: 60 },
      index: 'b',
      version: 1,
      locked: false,
      layerId,
      parentId: 'resize-frame',
      fillColor: '#22c55e',
      strokeColor: '#22c55e',
      strokeWidth: 0,
    });
    const select = viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('select tool is missing');
    select.setSelection(['resize-frame']);
    const frame = viewport.store.getById('resize-frame') as {
      position: { x: number; y: number };
      size: { w: number; h: number };
    };
    const child = viewport.store.getById('resize-child') as {
      position: { x: number; y: number };
      size: { w: number; h: number };
      version: number;
    };
    return {
      frame,
      child,
      handle: viewport.camera.worldToScreen({
        x: frame.position.x + frame.size.w + 4 / viewport.camera.zoom,
        y: frame.position.y + frame.size.h + 4 / viewport.camera.zoom,
      }),
    };
  });
  const stage = await page.locator('#stage').boundingBox();
  if (!stage) throw new Error('missing stage');
  const start = { x: stage.x + fixture.handle.x, y: stage.y + fixture.handle.y };
  const end = { x: start.x - 80, y: start.y - 30 };
  if (testInfo.project.name === 'ipad') await singleFingerDraw(page, [start, end]);
  else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
  }
  const resized = await page.evaluate(() => {
    const viewport = window.__playground.viewport;
    const frame = viewport.store.getById('resize-frame') as { size: { w: number; h: number } };
    const child = viewport.store.getById('resize-child') as {
      position: { x: number; y: number };
      size: { w: number; h: number };
      version: number;
    };
    return {
      frame: frame.size,
      child,
      clip: viewport.store.getEffectiveClip('resize-child'),
      hit: viewport.getElementAt({ x: 300, y: 180 })?.id ?? null,
    };
  });
  expect(resized.frame).toEqual({ w: 164, h: 114 });
  expect(resized.child).toEqual(fixture.child);
  expect(resized.clip).toEqual({ x: 100, y: 124, w: 164, h: 90 });
  expect(resized.hit).toBeNull();
  const pixels = await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas');
    if (!canvas) throw new Error('stage canvas is missing');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('stage canvas context is missing');
    const viewport = window.__playground.viewport;
    const rect = canvas.getBoundingClientRect();
    const sample = (point: { x: number; y: number }) => {
      const screen = viewport.camera.worldToScreen(point);
      const x = Math.round((screen.x * canvas.width) / rect.width);
      const y = Math.round((screen.y * canvas.height) / rect.height);
      return [...context.getImageData(x, y, 1, 1).data];
    };
    return { visible: sample({ x: 255, y: 180 }), clipped: sample({ x: 280, y: 180 }) };
  });
  expect(pixels.visible[0]).toBeGreaterThan(26);
  expect(pixels.visible[0]).toBeLessThan(42);
  expect(pixels.visible[1]).toBeGreaterThan(189);
  expect(pixels.visible[1]).toBeLessThan(205);
  expect(pixels.visible[2]).toBeGreaterThan(86);
  expect(pixels.visible[2]).toBeLessThan(102);
  expect(pixels.visible[3]).toBeGreaterThan(247);
  expect(pixels.clipped[1]).toBeLessThan(100);
  await page.evaluate(() => window.__playground.viewport.undo());
  expect(
    await page.evaluate(
      () =>
        (
          window.__playground.viewport.store.getById('resize-frame') as {
            size: { w: number; h: number };
          }
        ).size,
    ),
  ).toEqual(fixture.frame.size);
  expect(errors).toEqual([]);
});
