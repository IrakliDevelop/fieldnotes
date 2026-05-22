import { test, expect } from './fixtures/canvas-page';

test.describe('serialization', () => {
  test('save and restore state preserves elements', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;
    await canvasPage.page.mouse.move(cx - 50, cy - 50);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 50, cy + 50, { steps: 5 });
    await canvasPage.page.mouse.up();

    await canvasPage.selectTool('note');
    await canvasPage.page.mouse.click(cx + 100, cy);

    const countBefore = await canvasPage.getElementCount();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    const restored = await canvasPage.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        exportJSON: () => string;
        loadJSON: (json: string) => void;
        store: { count: number; clear: () => void };
      };
      const json = vp.exportJSON();
      vp.store.clear();
      vp.loadJSON(json);
      return vp.store.count;
    });

    expect(restored).toBe(countBefore);
  });
});
