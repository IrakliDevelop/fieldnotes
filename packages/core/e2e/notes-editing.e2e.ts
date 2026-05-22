import { test, expect } from './fixtures/canvas-page';

test.describe('notes editing', () => {
  test('place note, double-click to edit, type text, click away to commit', async ({
    canvasPage,
  }) => {
    await canvasPage.selectTool('note');
    const wrapper = canvasPage.wrapper();
    const box = await wrapper.boundingBox();
    if (!box) throw new Error('Wrapper not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;

    await canvasPage.page.mouse.click(cx, cy);
    await canvasPage.page.waitForTimeout(500);

    const notes = await canvasPage.getElementsByType('note');
    expect(notes.length).toBe(1);

    const noteNode = canvasPage.page.locator('[data-element-id]').first();
    await noteNode.waitFor({ state: 'visible', timeout: 3000 });

    await noteNode.dblclick();
    await canvasPage.page.waitForTimeout(300);

    await canvasPage.page.keyboard.type('Hello E2E');
    await canvasPage.page.waitForTimeout(200);

    await canvasPage.page.mouse.click(box.x + 10, box.y + 10);
    await canvasPage.page.waitForTimeout(300);

    const updatedNotes = (await canvasPage.getElementsByType('note')) as { text: string }[];
    expect(updatedNotes.length).toBe(1);
    const updatedNote = updatedNotes[0];
    if (!updatedNote) throw new Error('No note found after edit');
    expect(updatedNote.text).toContain('Hello E2E');
  });
});
