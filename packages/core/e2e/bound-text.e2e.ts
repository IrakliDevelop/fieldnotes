import { test, expect } from './fixtures/canvas-page';
import type { CanvasPage } from './fixtures/canvas-page';

let applicationErrors: string[] = [];

test.beforeEach(async ({ canvasPage }) => {
  applicationErrors = [];
  canvasPage.page.on('pageerror', (error) => applicationErrors.push(error.message));
  canvasPage.page.on('console', (message) => {
    if (message.type() === 'error') applicationErrors.push(message.text());
  });
});

test.afterEach(() => {
  expect(applicationErrors).toEqual([]);
});

async function addCenteredRectangle(canvasPage: CanvasPage, id: string, size = { w: 120, h: 60 }) {
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const screen = { x: box.width / 2, y: box.height / 2 };
  await canvasPage.page.evaluate(
    ({ id, screen, size }) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        camera: { screenToWorld: (point: { x: number; y: number }) => { x: number; y: number } };
        layerManager: { activeLayerId: string };
        store: { add: (element: unknown) => void };
        requestRender: () => void;
      };
      const world = vp.camera.screenToWorld(screen);
      vp.store.add({
        id,
        type: 'shape',
        shape: 'rectangle',
        position: { x: world.x - size.w / 2, y: world.y - size.h / 2 },
        size,
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: 'none',
        index: 'a0',
        version: 1,
        locked: false,
        layerId: vp.layerManager.activeLayerId,
      });
      vp.requestRender();
    },
    { id, screen, size },
  );
  await canvasPage.page.waitForFunction((id) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => unknown };
    };
    return vp.store.getById(id) !== undefined;
  }, id);
  return { x: box.x + screen.x, y: box.y + screen.y };
}

async function doubleTap(canvasPage: CanvasPage, point: { x: number; y: number }) {
  const client = await canvasPage.page.context().newCDPSession(canvasPage.page);
  for (let id = 1; id <= 2; id++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (id === 1) await canvasPage.page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

async function activateEditor(
  canvasPage: CanvasPage,
  point: { x: number; y: number },
  isIpad: boolean,
) {
  if (isIpad) await doubleTap(canvasPage, point);
  else await canvasPage.page.mouse.dblclick(point.x, point.y);
}

async function openEditor(canvasPage: CanvasPage, id: string, isIpad: boolean) {
  const point = await addCenteredRectangle(canvasPage, id);
  await activateEditor(canvasPage, point, isIpad);
  const editor = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  return editor;
}

test('double-clicking a rectangle creates editable bound text and Escape abandons it', async ({
  canvasPage,
}, testInfo) => {
  const wrapper = canvasPage.wrapper();
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const point = { x: box.width / 2, y: box.height / 2 };
  const world = await canvasPage.page.evaluate((screen) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { screenToWorld: (point: { x: number; y: number }) => { x: number; y: number } };
    };
    return vp.camera.screenToWorld(screen);
  }, point);
  await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      layerManager: { activeLayerId: string };
      store: { add: (element: unknown) => void };
      requestRender: () => void;
    };
    vp.store.add({
      id: 'bound-rectangle',
      type: 'shape',
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 120, h: 60 },
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'none',
      index: 'a0',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
    });
    vp.requestRender();
  });
  await canvasPage.page.evaluate((center) => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { update: (id: string, patch: unknown) => void };
    };
    vp.store.update('bound-rectangle', {
      position: { x: center.x - 60, y: center.y - 30 },
    });
  }, world);
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => unknown };
    };
    return vp.store.getById('bound-rectangle') !== undefined;
  });
  expect(
    await canvasPage.page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('#canvas') !== null,
      { x: box.x + point.x, y: box.y + point.y },
    ),
  ).toBe(true);
  await activateEditor(
    canvasPage,
    { x: box.x + point.x, y: box.y + point.y },
    testInfo.project.name === 'ipad',
  );
  const editor = wrapper.locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getAll: () => { type: string; containerId?: string }[] };
    };
    return !vp.store.getAll().some((element) => element.type === 'text' && element.containerId);
  });
});

test('types bound content centered in the container content box', async ({
  canvasPage,
}, testInfo) => {
  const editor = await openEditor(canvasPage, 'center-host', testInfo.project.name === 'ipad');
  await editor.fill('centered text');
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getAll: () => { type: string; containerId?: string; text?: string }[] };
    };
    return vp.store
      .getAll()
      .some(
        (element) =>
          element.type === 'text' &&
          element.containerId === 'center-host' &&
          element.text === 'centered text',
      );
  });
  const centers = await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: {
        getById: (
          id: string,
        ) => { position: { x: number; y: number }; size: { w: number; h: number } } | undefined;
        getAll: () => {
          containerId?: string;
          id: string;
          position: { x: number; y: number };
          size: { w: number; h: number };
        }[];
      };
    };
    const host = vp.store.getById('center-host');
    const text = vp.store.getAll().find((element) => element.containerId === 'center-host');
    if (!host || !text) throw new Error('expected bound text');
    return {
      host: { x: host.position.x + host.size.w / 2, y: host.position.y + host.size.h / 2 },
      text: { x: text.position.x + text.size.w / 2, y: text.position.y + text.size.h / 2 },
    };
  });
  expect(centers.text.x).toBeCloseTo(centers.host.x, 6);
  expect(centers.text.y).toBeCloseTo(centers.host.y, 6);
});

test('undos and redos one typed bound-text edit and abandons an empty edit without history', async ({
  canvasPage,
}, testInfo) => {
  const snapshot = () =>
    canvasPage.page.evaluate(() => {
      const vp = (
        window as unknown as {
          __fieldnotes_viewport: { store: { getAll: () => Record<string, unknown>[] } };
        }
      ).__fieldnotes_viewport;
      return vp.store.getAll().map(({ version: _version, ...element }) => element);
    });
  const point = await addCenteredRectangle(canvasPage, 'history-host');
  const before = await snapshot();
  await activateEditor(canvasPage, point, testInfo.project.name === 'ipad');
  const editor = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('history text');
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() =>
    (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; text?: string }[] };
        };
      }
    ).__fieldnotes_viewport.store
      .getAll()
      .some((element) => element.containerId === 'history-host' && element.text === 'history text'),
  );
  const after = await snapshot();
  const undoCount = await canvasPage.page.evaluate(
    () =>
      (window as unknown as { __fieldnotes_viewport: { history: { undoCount: number } } })
        .__fieldnotes_viewport.history.undoCount,
  );
  await canvasPage.page.evaluate(() =>
    (
      window as unknown as { __fieldnotes_viewport: { undo: () => boolean } }
    ).__fieldnotes_viewport.undo(),
  );
  await canvasPage.page.waitForFunction(() => {
    const elements = (
      window as unknown as {
        __fieldnotes_viewport: { store: { getAll: () => { containerId?: string }[] } };
      }
    ).__fieldnotes_viewport.store.getAll();
    return !elements.some((element) => element.containerId === 'history-host');
  });
  expect(await snapshot()).toEqual(before);
  expect(
    await canvasPage.page.evaluate(
      () =>
        (window as unknown as { __fieldnotes_viewport: { history: { undoCount: number } } })
          .__fieldnotes_viewport.history.undoCount,
    ),
  ).toBe(undoCount - 1);
  await canvasPage.page.evaluate(() =>
    (
      window as unknown as { __fieldnotes_viewport: { redo: () => boolean } }
    ).__fieldnotes_viewport.redo(),
  );
  await canvasPage.page.waitForFunction(() => {
    const elements = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; text?: string }[] };
        };
      }
    ).__fieldnotes_viewport.store.getAll();
    return elements.some(
      (element) => element.containerId === 'history-host' && element.text === 'history text',
    );
  });
  expect(await snapshot()).toEqual(after);
  const emptyPoint = await addCenteredRectangle(canvasPage, 'empty-host');
  const beforeEmpty = await snapshot();
  const undoBeforeEmpty = await canvasPage.page.evaluate(
    () =>
      (window as unknown as { __fieldnotes_viewport: { history: { undoCount: number } } })
        .__fieldnotes_viewport.history.undoCount,
  );
  await activateEditor(canvasPage, emptyPoint, testInfo.project.name === 'ipad');
  const empty = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
  await expect(empty).toBeVisible();
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(
    () =>
      !(
        window as unknown as {
          __fieldnotes_viewport: { store: { getAll: () => { containerId?: string }[] } };
        }
      ).__fieldnotes_viewport.store
        .getAll()
        .some((element) => element.containerId === 'empty-host'),
  );
  expect(await snapshot()).toEqual(beforeEmpty);
  expect(
    await canvasPage.page.evaluate(
      () =>
        (window as unknown as { __fieldnotes_viewport: { history: { undoCount: number } } })
          .__fieldnotes_viewport.history.undoCount,
    ),
  ).toBe(undoBeforeEmpty);
  await expect(empty).toHaveCount(0);
});

test('shrinks three bound-text lines to one and grows, but does not shrink, its host', async ({
  canvasPage,
}, testInfo) => {
  const editor = await openEditor(canvasPage, 'fit-host', testInfo.project.name === 'ipad');
  const initialHostHeight = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getById: (id: string) => { size: { h: number } } | undefined };
        };
      }
    ).__fieldnotes_viewport;
    return vp.store.getById('fit-host')?.size.h;
  });
  expect(initialHostHeight).toBe(60);
  await editor.fill('one\ntwo\nthree');
  await canvasPage.page.waitForFunction(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; size: { w: number; h: number } }[] };
        };
      }
    ).__fieldnotes_viewport;
    const elements = vp.store.getAll();
    const text = elements.find((element) => element.containerId === 'fit-host');
    const host = elements.find((element) => element.containerId === undefined);
    return text?.size.h !== undefined && host?.size.h !== undefined;
  });
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getById: (id: string) => { size: { h: number } } | undefined };
        };
      }
    ).__fieldnotes_viewport;
    return (vp.store.getById('fit-host')?.size.h ?? 0) > 60;
  });
  const threeLines = await canvasPage.page.evaluate(() => {
    const elements = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: {
            getAll: () => { id: string; containerId?: string; size: { w: number; h: number } }[];
          };
        };
      }
    ).__fieldnotes_viewport.store.getAll();
    const text = elements.find((element) => element.containerId === 'fit-host');
    const host = elements.find((element) => element.id === 'fit-host');
    if (!text || !host) throw new Error('expected host and text');
    return { textHeight: text.size.h, hostHeight: host.size.h };
  });
  const wrapperBox = await canvasPage.wrapper().boundingBox();
  if (!wrapperBox) throw new Error('Wrapper not found');
  const center = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          camera: { worldToScreen: (point: { x: number; y: number }) => { x: number; y: number } };
          store: {
            getById: (
              id: string,
            ) => { position: { x: number; y: number }; size: { w: number; h: number } } | undefined;
          };
        };
      }
    ).__fieldnotes_viewport;
    const host = vp.store.getById('fit-host');
    if (!host) throw new Error('expected host');
    return vp.camera.worldToScreen({
      x: host.position.x + host.size.w / 2,
      y: host.position.y + host.size.h / 2,
    });
  });
  await activateEditor(
    canvasPage,
    { x: wrapperBox.x + center.x, y: wrapperBox.y + center.y },
    testInfo.project.name === 'ipad',
  );
  const reopened = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
  await expect(reopened).toBeVisible();
  expect(
    await reopened.evaluate((node) => node === document.activeElement && node.contentEditable),
  ).toBe('true');
  await reopened.fill('one');
  await canvasPage.page.waitForFunction((height) => {
    const elements = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; size: { w: number; h: number } }[] };
        };
      }
    ).__fieldnotes_viewport.store.getAll();
    return (
      (elements.find((element) => element.containerId === 'fit-host')?.size.h ?? height) < height
    );
  }, threeLines.textHeight);
  const oneLine = await canvasPage.page.evaluate(() => {
    const elements = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: {
            getAll: () => { id: string; containerId?: string; size: { w: number; h: number } }[];
          };
        };
      }
    ).__fieldnotes_viewport.store.getAll();
    const text = elements.find((element) => element.containerId === 'fit-host');
    const host = elements.find((element) => element.id === 'fit-host');
    if (!text || !host) throw new Error('expected host and text');
    return { textHeight: text.size.h, hostHeight: host.size.h };
  });
  expect(oneLine.textHeight).toBeLessThan(threeLines.textHeight);
  expect(oneLine.hostHeight).toBe(threeLines.hostHeight);
  await canvasPage.page.keyboard.press('Escape');
  expect(
    await canvasPage.page.evaluate(() => {
      const vp = (
        window as unknown as {
          __fieldnotes_viewport: {
            store: { getById: (id: string) => { size: { h: number } } | undefined };
          };
        }
      ).__fieldnotes_viewport;
      return vp.store.getById('fit-host')?.size.h;
    }),
  ).toBe(threeLines.hostHeight);
});

test('recenters bound text after host move and clamps a resize at its text floor', async ({
  canvasPage,
}, testInfo) => {
  const editor = await openEditor(canvasPage, 'clamp-host', testInfo.project.name === 'ipad');
  await editor.fill('a long enough bound label to establish a resize floor');
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(
    () => !document.querySelector('[data-element-id][contenteditable="true"]'),
  );
  await canvasPage.page.keyboard.press('v');
  const box = await canvasPage.wrapper().boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const screen = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          camera: { worldToScreen: (point: { x: number; y: number }) => { x: number; y: number } };
          store: {
            getById: (
              id: string,
            ) => { position: { x: number; y: number }; size: { w: number; h: number } } | undefined;
          };
        };
      }
    ).__fieldnotes_viewport;
    const host = vp.store.getById('clamp-host');
    if (!host) throw new Error('expected host');
    return {
      center: vp.camera.worldToScreen({
        x: host.position.x + host.size.w / 2,
        y: host.position.y + host.size.h / 2,
      }),
      corner: vp.camera.worldToScreen({
        x: host.position.x + host.size.w,
        y: host.position.y + host.size.h,
      }),
    };
  });
  await canvasPage.page.mouse.click(box.x + screen.center.x, box.y + screen.center.y);
  await canvasPage.page.mouse.move(box.x + screen.center.x, box.y + screen.center.y);
  await canvasPage.page.mouse.down();
  await canvasPage.page.mouse.move(box.x + screen.center.x + 80, box.y + screen.center.y + 50, {
    steps: 4,
  });
  await canvasPage.page.mouse.up();
  const moved = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: {
            getById: (
              id: string,
            ) => { position: { x: number; y: number }; size: { w: number; h: number } } | undefined;
            getAll: () => {
              containerId?: string;
              position: { x: number; y: number };
              size: { w: number; h: number };
            }[];
          };
        };
      }
    ).__fieldnotes_viewport;
    const host = vp.store.getById('clamp-host');
    const text = vp.store.getAll().find((element) => element.containerId === 'clamp-host');
    if (!host || !text) throw new Error('expected moved elements');
    return { host, text };
  });
  await canvasPage.page.mouse.move(box.x + screen.corner.x + 80, box.y + screen.corner.y + 50);
  await canvasPage.page.mouse.down();
  await canvasPage.page.mouse.move(box.x + screen.corner.x - 400, box.y + screen.corner.y - 400, {
    steps: 6,
  });
  await canvasPage.page.mouse.up();
  const result = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: {
            getById: (
              id: string,
            ) => { position: { x: number; y: number }; size: { w: number; h: number } } | undefined;
            getAll: () => {
              id: string;
              containerId?: string;
              position: { x: number; y: number };
              size: { w: number; h: number };
            }[];
          };
        };
      }
    ).__fieldnotes_viewport;
    const host = vp.store.getById('clamp-host');
    const text = vp.store.getAll().find((element) => element.containerId === 'clamp-host');
    if (!host || !text) throw new Error('expected clamped elements');
    return { host, clampedText: text };
  });
  expect(moved.text.position.x + moved.text.size.w / 2).toBeCloseTo(
    moved.host.position.x + moved.host.size.w / 2,
    6,
  );
  expect(moved.text.position.y + moved.text.size.h / 2).toBeCloseTo(
    moved.host.position.y + moved.host.size.h / 2,
    6,
  );
  const rectanglePadding = 8;
  const minimumHeight = result.clampedText.size.h + rectanglePadding * 2;
  expect(result.host.size.w).toBe(20);
  expect(result.host.size.h).toBeCloseTo(minimumHeight, 6);
  expect(result.host.position.x).toBeCloseTo(moved.host.position.x, 6);
  expect(result.host.position.y).toBeCloseTo(moved.host.position.y, 6);
  expect(result.clampedText.position.x + result.clampedText.size.w / 2).toBeCloseTo(
    result.host.position.x + result.host.size.w / 2,
    6,
  );
  expect(result.clampedText.position.y + result.clampedText.size.h / 2).toBeCloseTo(
    result.host.position.y + result.host.size.h / 2,
    6,
  );
});

test('bends an arrow with bound text at its visible curve midpoint', async ({ canvasPage }) => {
  const wrapper = canvasPage.wrapper();
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('Wrapper not found');
  const arrow = await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: {
        screenToWorld: (point: { x: number; y: number }) => { x: number; y: number };
        worldToScreen: (point: { x: number; y: number }) => { x: number; y: number };
      };
      layerManager: { activeLayerId: string };
      store: { add: (element: unknown) => void };
      requestRender: () => void;
    };
    const center = vp.camera.screenToWorld({
      x: (document.querySelector('#canvas > div')?.clientWidth ?? 0) / 2,
      y: (document.querySelector('#canvas > div')?.clientHeight ?? 0) / 2,
    });
    const from = { x: center.x - 200, y: center.y };
    const to = { x: center.x + 200, y: center.y };
    vp.store.add({
      id: 'bend-from',
      type: 'shape',
      shape: 'rectangle',
      position: { x: center.x - 240, y: center.y - 50 },
      size: { w: 80, h: 100 },
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'none',
      index: 'a0',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
    });
    vp.store.add({
      id: 'bend-to',
      type: 'shape',
      shape: 'rectangle',
      position: { x: center.x + 160, y: center.y - 50 },
      size: { w: 80, h: 100 },
      strokeColor: '#000000',
      strokeWidth: 2,
      fillColor: 'none',
      index: 'a1',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
    });
    vp.store.add({
      id: 'bend-arrow',
      type: 'arrow',
      position: from,
      from,
      to,
      bend: 0,
      color: '#000000',
      width: 3,
      index: 'a0',
      version: 1,
      locked: false,
      layerId: vp.layerManager.activeLayerId,
      fromBinding: { elementId: 'bend-from', focus: 0, gap: 0 },
      toBinding: { elementId: 'bend-to', focus: 0, gap: 0 },
    });
    vp.requestRender();
    return {
      editPoint: vp.camera.worldToScreen({ x: center.x - 80, y: center.y }),
      selectPoint: vp.camera.worldToScreen({ x: center.x - 120, y: center.y }),
    };
  });
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => unknown };
    };
    return (
      vp.store.getById('bend-arrow') !== undefined &&
      vp.store.getById('bend-from') !== undefined &&
      vp.store.getById('bend-to') !== undefined
    );
  });
  await canvasPage.page.mouse.dblclick(box.x + arrow.editPoint.x, box.y + arrow.editPoint.y);
  const editor = wrapper.locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('curve label');
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() =>
    (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; text?: string }[] };
        };
      }
    ).__fieldnotes_viewport.store
      .getAll()
      .some((element) => element.containerId === 'bend-arrow' && element.text === 'curve label'),
  );

  await canvasPage.page.keyboard.press('v');
  await canvasPage.page.mouse.click(box.x + arrow.selectPoint.x, box.y + arrow.selectPoint.y);
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      toolManager: { getTool: (name: string) => { selectedIds: string[] } };
    };
    return vp.toolManager.getTool('select').selectedIds.includes('bend-arrow');
  });
  const handle = await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { worldToScreen: (point: { x: number; y: number }) => { x: number; y: number } };
      store: {
        getById: (
          id: string,
        ) =>
          | { from: { x: number; y: number }; to: { x: number; y: number }; bend: number }
          | undefined;
      };
    };
    const arrow = vp.store.getById('bend-arrow');
    if (!arrow) throw new Error('expected arrow');
    return vp.camera.worldToScreen({
      x: (arrow.from.x + arrow.to.x) / 2,
      y: (arrow.from.y + arrow.to.y) / 2,
    });
  });
  await canvasPage.page.mouse.move(box.x + handle.x, box.y + handle.y);
  await canvasPage.page.mouse.down();
  await canvasPage.page.mouse.move(box.x + handle.x, box.y + handle.y + 90, { steps: 4 });
  await canvasPage.page.mouse.up();
  await canvasPage.page.waitForFunction(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      store: { getById: (id: string) => { bend?: number } | undefined };
    };
    return (vp.store.getById('bend-arrow')?.bend ?? 0) > 100;
  });

  const result = await canvasPage.page.evaluate(() => {
    const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      camera: { worldToScreen: (point: { x: number; y: number }) => { x: number; y: number } };
      store: {
        getById: (id: string) =>
          | {
              from: { x: number; y: number };
              to: { x: number; y: number };
              bend: number;
              fromBinding?: { elementId: string };
              toBinding?: { elementId: string };
            }
          | undefined;
        getAll: () => {
          containerId?: string;
          position: { x: number; y: number };
          size: { w: number; h: number };
        }[];
      };
    };
    const arrow = vp.store.getById('bend-arrow');
    const label = vp.store.getAll().find((element) => element.containerId === 'bend-arrow');
    const fromShape = vp.store.getAll().find((element) => element.id === 'bend-from');
    const toShape = vp.store.getAll().find((element) => element.id === 'bend-to');
    if (!arrow || !label || !fromShape || !toShape) throw new Error('expected bound bent arrow');
    const control = {
      x:
        (arrow.from.x + arrow.to.x) / 2 -
        ((arrow.to.y - arrow.from.y) /
          Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y)) *
          arrow.bend,
      y:
        (arrow.from.y + arrow.to.y) / 2 +
        ((arrow.to.x - arrow.from.x) /
          Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y)) *
          arrow.bend,
    };
    const point = (t: number) => {
      const mt = 1 - t;
      return {
        x: mt * mt * arrow.from.x + 2 * mt * t * control.x + t * t * arrow.to.x,
        y: mt * mt * arrow.from.y + 2 * mt * t * control.y + t * t * arrow.to.y,
      };
    };
    const isOutsideBoundShapes = (p: { x: number; y: number }) => {
      const inside = (shape: {
        position: { x: number; y: number };
        size: { w: number; h: number };
      }) =>
        p.x >= shape.position.x &&
        p.x <= shape.position.x + shape.size.w &&
        p.y >= shape.position.y &&
        p.y <= shape.position.y + shape.size.h;
      return !inside(fromShape) && !inside(toShape);
    };
    let firstVisible = 1;
    for (let i = 1; i <= 128; i++) {
      if (isOutsideBoundShapes(point(i / 128))) {
        firstVisible = i;
        break;
      }
    }
    let t0Low = (firstVisible - 1) / 128;
    let t0High = firstVisible / 128;
    for (let i = 0; i < 24; i++) {
      const mid = (t0Low + t0High) / 2;
      if (isOutsideBoundShapes(point(mid))) t0High = mid;
      else t0Low = mid;
    }
    let lastVisible = 127;
    for (let i = 127; i >= 0; i--) {
      if (isOutsideBoundShapes(point(i / 128))) {
        lastVisible = i;
        break;
      }
    }
    let t1Low = lastVisible / 128;
    let t1High = (lastVisible + 1) / 128;
    for (let i = 0; i < 24; i++) {
      const mid = (t1Low + t1High) / 2;
      if (isOutsideBoundShapes(point(mid))) t1Low = mid;
      else t1High = mid;
    }
    const t0 = t0High;
    const t1 = t1Low;
    const intrinsicMidpoint = point(0.5);
    const visibleMidpoint = point((t0 + t1) / 2);
    const sample = vp.camera.worldToScreen(point(t0 + 0.2 * (t1 - t0)));
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas canvas');
    if (!canvas) throw new Error('expected canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('expected canvas context');
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const x = Math.round(sample.x * scaleX);
    const y = Math.round(sample.y * scaleY);
    let hasStroke = false;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const pixel = context.getImageData(x + dx, y + dy, 1, 1).data;
        if (pixel[3] > 0 && pixel[0] < 80 && pixel[1] < 80 && pixel[2] < 80) hasStroke = true;
      }
    }
    return {
      handle: vp.camera.worldToScreen(intrinsicMidpoint),
      label: {
        x: label.position.x + label.size.w / 2,
        y: label.position.y + label.size.h / 2,
      },
      visibleMidpoint,
      t0,
      t1,
      hasStroke,
    };
  });
  expect(result.handle.x).toBeCloseTo(handle.x, 0);
  expect(result.handle.y).toBeCloseTo(handle.y + 90, 0);
  expect(result.t0).toBeGreaterThan(0);
  expect(result.t1).toBeLessThan(1);
  expect(result.t1).toBeGreaterThan(result.t0);
  expect(result.label.x).toBeCloseTo(result.visibleMidpoint.x, 0);
  expect(result.label.y).toBeCloseTo(result.visibleMidpoint.y, 0);
  expect(result.hasStroke).toBe(true);
});

test('Enter edits a selected container while focused toolbar controls stay native', async ({
  canvasPage,
}, testInfo) => {
  const point = await addCenteredRectangle(canvasPage, 'enter-host');
  await canvasPage.page.keyboard.press('v');
  await canvasPage.page.mouse.click(point.x, point.y);
  await canvasPage.page.keyboard.press('Enter');
  const editor = canvasPage.wrapper().locator('[data-element-id][contenteditable="true"]');
  await expect(editor).toBeVisible();
  await canvasPage.page.keyboard.press('Escape');

  const control = canvasPage.page.locator('#toolbar button[data-tool="shape"]');
  await canvasPage.page.evaluate(() => {
    const control = document.querySelector<HTMLButtonElement>('#toolbar button[data-tool="shape"]');
    if (!control) throw new Error('expected shape control');
    control.dataset['activations'] = '0';
    control.addEventListener('click', () => {
      control.dataset['activations'] = String(Number(control.dataset['activations']) + 1);
    });
  });
  await control.focus();
  await canvasPage.page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  expect(await control.getAttribute('data-activations')).toBe('1');
  const beforeUndo = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          history: { undoCount: number };
          store: { getAll: () => Record<string, unknown>[] };
        };
      }
    ).__fieldnotes_viewport;
    return {
      undoCount: vp.history.undoCount,
      elements: vp.store.getAll().map(({ version: _version, ...element }) => element),
    };
  });
  await canvasPage.page.keyboard.press(testInfo.project.name === 'ipad' ? 'Meta+z' : 'Control+z');
  await canvasPage.page.waitForFunction(
    (undoCount) =>
      (window as unknown as { __fieldnotes_viewport: { history: { undoCount: number } } })
        .__fieldnotes_viewport.history.undoCount ===
      undoCount - 1,
    beforeUndo.undoCount,
  );
  const afterUndo = await canvasPage.page.evaluate(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          history: { undoCount: number };
          store: { getAll: () => Record<string, unknown>[] };
        };
      }
    ).__fieldnotes_viewport;
    return {
      undoCount: vp.history.undoCount,
      elements: vp.store.getAll().map(({ version: _version, ...element }) => element),
    };
  });
  expect(afterUndo.undoCount).toBe(beforeUndo.undoCount - 1);
  expect(afterUndo.elements).not.toEqual(beforeUndo.elements);
});

test('iPad CDP touch double-tap creates, types, and finishes bound text', async ({
  canvasPage,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad', 'touch-only coverage');
  const editor = await openEditor(canvasPage, 'touch-host', true);
  await editor.fill('touch text');
  await canvasPage.page.keyboard.press('Escape');
  await canvasPage.page.waitForFunction(() => {
    const vp = (
      window as unknown as {
        __fieldnotes_viewport: {
          store: { getAll: () => { containerId?: string; text?: string }[] };
        };
      }
    ).__fieldnotes_viewport;
    return vp.store
      .getAll()
      .some((element) => element.containerId === 'touch-host' && element.text === 'touch text');
  });
});
