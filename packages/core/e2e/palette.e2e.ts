import type { Page } from '@playwright/test';
import { CanvasPage, expect, test } from './fixtures/canvas-page';
import { colorPixelCount, SELECTION_BLUE } from './helpers/red-pixel-count';

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface PresentationState {
  active: boolean;
}

interface PaletteFixtureViewport {
  store: { add: (element: NoteFixture) => void };
  addShape: (options: {
    position: { x: number; y: number };
    size: { w: number; h: number };
  }) => string;
  frameSelection: (ids: string[], options: { title: string }) => void;
  runAction: (id: string) => void;
  palette: { isOpen: () => boolean };
  shortcutsHelp: { isOpen: () => boolean };
  presentation: {
    getState: () => PresentationState;
    start: (options: { fullscreen: boolean }) => void;
    exit: () => void;
  };
  getSelectedIds: () => string[];
  history: { undoCount: number };
  getVisibleRect: () => View;
  camera: { position: { x: number; y: number }; zoom: number };
  toolManager: { activeTool: { name: string } | null };
  domLayer: { parentElement: Element | null };
}

interface NoteFixture {
  id: string;
  type: 'note';
  position: { x: number; y: number };
  size: { w: number; h: number };
  text: string;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  index: string;
  version: number;
  locked: boolean;
  layerId: string;
}

interface CanvasState {
  paletteOpen: boolean;
  helpOpen: boolean;
  presentationActive: boolean;
  selectedIds: string[];
  undoCount: number;
  visibleRect: View;
  camera: CameraState;
  activeTool: string | undefined;
  boardFocused: boolean;
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

async function seed(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport })
      .__fieldnotes_viewport;
    const note = (id: string, x: number, y: number, text: string): NoteFixture => ({
      id,
      type: 'note',
      position: { x, y },
      size: { w: 200, h: 80 },
      text,
      backgroundColor: '#fff',
      textColor: '#000',
      fontSize: 18,
      index: id,
      version: 1,
      locked: false,
      layerId: '',
    });
    viewport.store.add(note('budget', 1500, 900, 'Budget 2026 café'));
    viewport.store.add(note('shopping', -1200, -700, 'Shopping list'));
    const shapeId = viewport.addShape({
      position: { x: 3000, y: 0 },
      size: { w: 300, h: 200 },
    });
    viewport.frameSelection([shapeId], { title: 'Roadmap' });
    viewport.runAction('select.none');
    return viewport.history.undoCount;
  });
}

async function state(page: Page): Promise<CanvasState> {
  return page.evaluate(() => {
    const viewport = (window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport })
      .__fieldnotes_viewport;
    return {
      paletteOpen: viewport.palette.isOpen(),
      helpOpen: viewport.shortcutsHelp.isOpen(),
      presentationActive: viewport.presentation.getState().active,
      selectedIds: viewport.getSelectedIds(),
      undoCount: viewport.history.undoCount,
      visibleRect: viewport.getVisibleRect(),
      camera: {
        x: viewport.camera.position.x,
        y: viewport.camera.position.y,
        zoom: viewport.camera.zoom,
      },
      activeTool: viewport.toolManager.activeTool?.name,
      boardFocused: document.activeElement === viewport.domLayer.parentElement,
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

test.describe('command palette', () => {
  test('desktop finds board text, runs actions, and preserves Escape order', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop keyboard coverage');
    const { canvasPage, errors } = await openCanvas(page);
    const undoCount = await seed(page);
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    let result = await state(page);
    expect(result.boardFocused).toBe(true);
    expect(result.activeTool).toBe('select');
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.palette.isOpen(),
    );
    await expect(page.locator('.fieldnotes-palette-input')).toBeFocused();

    await page.keyboard.type('cafe');
    expect((await state(page)).activeTool).toBe('select');
    const option = page.locator('.fieldnotes-palette-option');
    await expect(option).toHaveCount(1);
    await expect(option).toContainText('Budget 2026');
    await expect(option.locator('mark')).toHaveText('café');

    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.palette.isOpen(),
    );

    const selectionBlueCount = () => colorPixelCount(page, SELECTION_BLUE);
    await expect.poll(selectionBlueCount).toBeGreaterThan(0);
    await expect.poll(selectionBlueCount, { timeout: 4000 }).toBe(0);
    await expect
      .poll(async () =>
        visibleRectContains((await state(page)).visibleRect, { x: 1500, y: 900, w: 200, h: 80 }),
      )
      .toBe(true);

    result = await state(page);
    expect(result.undoCount).toBe(undoCount);
    expect(result.selectedIds).toEqual([]);
    expect(result.boardFocused).toBe(true);

    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.palette.isOpen(),
    );
    await page.keyboard.type('present');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.presentation.getState().active,
    );
    await page.evaluate(() => {
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.presentation.exit();
    });
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.presentation.getState().active,
    );

    await page.evaluate(() => {
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.presentation.start({ fullscreen: false });
    });
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.presentation.getState().active,
    );
    await wrapper.focus();
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.palette.isOpen(),
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.palette.isOpen() &&
        (
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.presentation.getState().active,
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.presentation.getState().active,
    );

    await wrapper.focus();
    await page.keyboard.press('?');
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.shortcutsHelp.isOpen(),
    );
    const undoRow = page.locator('.fieldnotes-help-row', { hasText: 'Undo' });
    await expect(undoRow).toContainText('Undo');
    await expect(undoRow.locator('kbd')).toHaveText(/^(Ctrl\+|⌘)Z$/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.shortcutsHelp.isOpen(),
    );
    await expect.poll(async () => (await state(page)).boardFocused).toBe(true);

    result = await state(page);
    expect(result.paletteOpen).toBe(false);
    expect(result.helpOpen).toBe(false);
    expect(errors).toEqual([]);
  });

  test('iPad uses palette and help toolbar buttons', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad', 'iPad touch coverage');
    const { errors } = await openCanvas(page);
    await seed(page);
    expect((await state(page)).activeTool).toBe('select');

    await page.locator('#palette-btn').tap();
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.palette.isOpen(),
    );
    await page.keyboard.type('shop');
    expect((await state(page)).activeTool).toBe('select');
    await page.locator('.fieldnotes-palette-option').first().tap();
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.palette.isOpen(),
    );

    await expect
      .poll(async () =>
        visibleRectContains((await state(page)).visibleRect, {
          x: -1200,
          y: -700,
          w: 200,
          h: 80,
        }),
      )
      .toBe(true);

    const selectionBlueCount = () => colorPixelCount(page, SELECTION_BLUE);
    await expect.poll(selectionBlueCount).toBeGreaterThan(0);
    await expect.poll(selectionBlueCount, { timeout: 4000 }).toBe(0);

    await page.locator('#help-btn').tap();
    await page.waitForFunction(() =>
      (
        window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
      ).__fieldnotes_viewport.shortcutsHelp.isOpen(),
    );
    await page.locator('.fieldnotes-help-close').tap();
    await page.waitForFunction(
      () =>
        !(
          window as unknown as { __fieldnotes_viewport: PaletteFixtureViewport }
        ).__fieldnotes_viewport.shortcutsHelp.isOpen(),
    );

    expect(errors).toEqual([]);
  });
});
