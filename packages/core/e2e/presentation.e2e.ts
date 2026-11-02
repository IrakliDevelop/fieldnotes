import { test, expect, CanvasPage } from './fixtures/canvas-page';
import { singleFingerDraw, pinchGesture } from './helpers/touch';
import { redPixelCount } from './helpers/red-pixel-count';
import type { Page } from '@playwright/test';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PresentationState {
  active: boolean;
  index: number;
  count: number;
}

interface CanvasState {
  presentation: PresentationState;
  slides: { view: View }[];
  selectedIds: string[];
  activeTool: string | undefined;
  undoCount: number;
  camera: CameraState;
  visibleRect: View;
  firstShapePosition: { x: number; y: number } | undefined;
}

async function openCanvas(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const canvasPage = new CanvasPage(page);
  await canvasPage.goto();
  return { canvasPage, errors };
}

async function seedFrames(page: Page) {
  return page.evaluate(() => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      addShape: (options: Record<string, unknown>) => string;
      frameSelection: (ids: string[], options: { title: string }) => void;
      history: { undoCount: number };
      camera: { position: { x: number; y: number }; zoom: number };
    };
    const firstShapeId = viewport.addShape({
      position: { x: 0, y: 0 },
      size: { w: 300, h: 200 },
    });
    viewport.frameSelection([firstShapeId], { title: 'First' });
    const secondShapeId = viewport.addShape({
      position: { x: 2000, y: 0 },
      size: { w: 300, h: 200 },
    });
    viewport.frameSelection([secondShapeId], { title: 'Second' });
    return {
      firstShapeId,
      secondShapeId,
      undoCount: viewport.history.undoCount,
      camera: {
        x: viewport.camera.position.x,
        y: viewport.camera.position.y,
        zoom: viewport.camera.zoom,
      },
    };
  });
}

async function state(page: Page): Promise<CanvasState> {
  return page.evaluate(() => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      presentation: {
        getState: () => PresentationState;
        getSlides: () => { view: View }[];
      };
      getSelectedIds: () => string[];
      toolManager: { activeTool: { name: string } | null };
      history: { undoCount: number };
      camera: { position: { x: number; y: number }; zoom: number };
      getVisibleRect: () => View;
      store: { getAll: () => { type: string; position?: { x: number; y: number } }[] };
    };
    return {
      presentation: viewport.presentation.getState(),
      slides: viewport.presentation.getSlides(),
      selectedIds: viewport.getSelectedIds(),
      activeTool: viewport.toolManager.activeTool?.name,
      undoCount: viewport.history.undoCount,
      camera: {
        x: viewport.camera.position.x,
        y: viewport.camera.position.y,
        zoom: viewport.camera.zoom,
      },
      visibleRect: viewport.getVisibleRect(),
      firstShapePosition: viewport.store.getAll().find((element) => element.type === 'shape')
        ?.position,
    };
  });
}

function visibleRectContains(rect: View, view: View): boolean {
  return (
    rect.x <= view.x + 1 &&
    rect.y <= view.y + 1 &&
    rect.x + rect.w >= view.x + view.w - 1 &&
    rect.y + rect.h >= view.y + view.h - 1
  );
}

type PresentationPredicate = Partial<PresentationState>;

async function waitForPresentation(page: Page, predicate: PresentationPredicate): Promise<void> {
  await page.waitForFunction((expected) => {
    const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
      presentation: { getState: () => PresentationState };
    };
    const state = viewport.presentation.getState();
    return Object.entries(expected).every(
      ([key, value]) => state[key as keyof PresentationState] === value,
    );
  }, predicate);
}

async function waitForVisibleSlide(page: Page, index: number): Promise<void> {
  await expect
    .poll(async () => {
      const result = await state(page);
      const slide = result.slides[index];
      return slide !== undefined && visibleRectContains(result.visibleRect, slide.view);
    })
    .toBe(true);
}

test.describe('presentation mode', () => {
  test('desktop enters, steps, draws with laser, and restores on exit', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop mouse coverage');
    const { canvasPage, errors } = await openCanvas(page);
    const seeded = await seedFrames(page);

    await page.locator('#present-btn').click();
    await waitForPresentation(page, { active: true });
    await waitForVisibleSlide(page, 0);
    let result = await state(page);
    expect(result.presentation.index).toBe(0);
    expect(result.presentation.count).toBe(2);
    expect(result.selectedIds).toEqual([]);
    expect(result.activeTool).toBe('hand');

    await page.keyboard.press('v');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      (id) =>
        (
          window as unknown as {
            __fieldnotes_viewport: { getSelectedIds: () => string[] };
          }
        ).__fieldnotes_viewport
          .getSelectedIds()
          .includes(id),
      seeded.firstShapeId,
    );
    await wrapper.focus();
    await page.keyboard.press('ArrowRight');
    await waitForPresentation(page, { index: 1 });
    await waitForVisibleSlide(page, 1);
    result = await state(page);
    expect(result.firstShapePosition).toEqual({ x: 0, y: 0 });
    expect(result.undoCount).toBe(seeded.undoCount);

    await page.locator('[data-presentation="previous"]').click();
    await waitForPresentation(page, { index: 0 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __fieldnotes_viewport: { domLayer: { parentElement: Element | null } };
              }
            ).__fieldnotes_viewport.domLayer.parentElement === document.activeElement,
        ),
      )
      .toBe(true);

    await page.keyboard.press('Home');
    await waitForPresentation(page, { index: 0 });
    await page.keyboard.press('End');
    await waitForPresentation(page, { index: 1 });
    await page.keyboard.press('Home');
    await waitForPresentation(page, { index: 0 });
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).presentation.index).toBe(0);

    await wrapper.focus();
    await page.keyboard.press('l');
    expect((await state(page)).activeTool).toBe('laser');
    const redBefore = await redPixelCount(page);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await redPixelCount(page)).toBeGreaterThan(redBefore);

    await page.keyboard.press('Escape');
    await waitForPresentation(page, { active: false });
    result = await state(page);
    expect(result.camera).toEqual(seeded.camera);
    expect(result.activeTool).toBe('select');
    await expect(page.locator('#presentation-bar')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('iPad bar controls, touch laser, and pinch keep presenting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad', 'iPad touch coverage');
    const { canvasPage, errors } = await openCanvas(page);
    await seedFrames(page);

    await page.locator('#present-btn').tap();
    await waitForPresentation(page, { active: true });
    expect((await state(page)).selectedIds).toEqual([]);

    await page.locator('[data-presentation="next"]').tap();
    await waitForPresentation(page, { index: 1 });
    await page.locator('[data-presentation="laser"]').tap();
    expect((await state(page)).activeTool).toBe('laser');
    const box = await canvasPage.wrapper().boundingBox();
    if (!box) throw new Error('Wrapper not found');
    const redBefore = await redPixelCount(page);
    await singleFingerDraw(page, [
      { x: box.x + box.width * 0.3, y: box.y + box.height / 2 },
      { x: box.x + box.width * 0.5, y: box.y + box.height / 2 },
      { x: box.x + box.width * 0.7, y: box.y + box.height / 2 },
    ]);
    expect(await redPixelCount(page)).toBeGreaterThan(redBefore);

    const zoom = (await state(page)).camera.zoom;
    await pinchGesture(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 100, 200);
    const result = await state(page);
    expect(result.presentation.active).toBe(true);
    expect(result.camera.zoom).not.toBe(zoom);

    await page.locator('[data-presentation="previous"]').tap();
    await waitForPresentation(page, { index: 0 });
    await waitForVisibleSlide(page, 0);
    await page.locator('[data-presentation="exit"]').tap();
    await waitForPresentation(page, { active: false });
    await expect(page.locator('#presentation-bar')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
