import { test, expect } from './fixtures/canvas-page';

test.describe('drawing tools', () => {
  test('draws a rectangle with shape tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('shape');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 100, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 100, { steps: 5 });
    await canvasPage.page.mouse.up();

    const shapes = await canvasPage.getElementsByType('shape');
    expect(shapes.length).toBe(1);
  });

  test('draws a stroke with pencil tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('pencil');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 100, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 100, cy + 50, { steps: 10 });
    await canvasPage.page.mouse.up();

    const strokes = await canvasPage.getElementsByType('stroke');
    expect(strokes.length).toBe(1);
  });

  test('places a note with note tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('note');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.click(cx, cy);

    const notes = await canvasPage.getElementsByType('note');
    expect(notes.length).toBe(1);
  });

  test('draws an arrow with arrow tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('arrow');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.move(cx - 150, cy);
    await canvasPage.page.mouse.down();
    await canvasPage.page.mouse.move(cx + 150, cy + 100, { steps: 5 });
    await canvasPage.page.mouse.up();

    const arrows = await canvasPage.getElementsByType('arrow');
    expect(arrows.length).toBe(1);
  });

  test('places text with text tool', async ({ canvasPage }) => {
    await canvasPage.selectTool('text');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvasPage.page.mouse.click(cx, cy);

    const texts = await canvasPage.getElementsByType('text');
    expect(texts.length).toBe(1);
  });
});
