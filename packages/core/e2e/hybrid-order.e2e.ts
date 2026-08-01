import { test, expect } from './fixtures/canvas-page';

test.describe('hybrid paint order', () => {
  test('interleaves and reorders canvas content between DOM elements', async ({ canvasPage }) => {
    const orders = await canvasPage.page.evaluate(async () => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          dom: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        addShape: (options: Record<string, unknown>) => string;
        requestRender: () => void;
        store: {
          update: (id: string, patch: { zIndex: number }) => void;
        };
      };

      const low = document.createElement('div');
      low.style.background = 'red';
      const lowId = vp.addHtmlElement(low, { x: 20, y: 20 }, { w: 100, h: 100 });
      const shapeId = vp.addShape({
        position: { x: 20, y: 20 },
        size: { w: 100, h: 100 },
        fillColor: '#00ff00',
      });
      const high = document.createElement('div');
      high.style.background = 'blue';
      const highId = vp.addHtmlElement(high, { x: 20, y: 20 }, { w: 100, h: 100 });
      vp.store.update(lowId, { zIndex: 0 });
      vp.store.update(shapeId, { zIndex: 1 });
      vp.store.update(highId, { zIndex: 2 });
      vp.requestRender();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const paintStack = document.querySelector<HTMLElement>('[data-fieldnotes-paint-stack]');
      if (!paintStack) throw new Error('paint stack not found');
      const read = () =>
        [...paintStack.children]
          .map((node) => ({
            order: Number((node as HTMLElement).dataset['paintOrder']),
            tag: node.tagName,
            elementId: node.querySelector<HTMLElement>('[data-element-id]')?.dataset['elementId'],
          }))
          .sort((a, b) => a.order - b.order);
      const initial = read();

      vp.store.update(shapeId, { zIndex: 3 });
      vp.requestRender();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { initial, reordered: read() };
    });

    expect(orders.initial).toEqual([
      { order: 1, tag: 'DIV', elementId: expect.any(String) },
      { order: 2, tag: 'CANVAS', elementId: undefined },
      { order: 3, tag: 'DIV', elementId: expect.any(String) },
      { order: 4, tag: 'CANVAS', elementId: undefined },
    ]);
    expect(orders.reordered).toEqual([
      { order: 1, tag: 'DIV', elementId: expect.any(String) },
      { order: 2, tag: 'DIV', elementId: expect.any(String) },
      { order: 3, tag: 'CANVAS', elementId: undefined },
      { order: 4, tag: 'CANVAS', elementId: undefined },
    ]);
  });
});
