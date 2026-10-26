import { test, expect } from './fixtures/canvas-page';

test.describe('context loss', () => {
  test('masks persistent surfaces until every restored canvas has repainted', async ({
    canvasPage,
  }) => {
    const result = await canvasPage.page.evaluate(async () => {
      const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        addHtmlElement: (
          node: HTMLElement,
          position: { x: number; y: number },
          size: { w: number; h: number },
        ) => string;
        addShape: (options: Record<string, unknown>) => string;
        requestRender: () => void;
        destroy: () => void;
      };
      const wrapper = document.querySelector<HTMLDivElement>('#canvas > div');
      const minimap = document.querySelector<HTMLCanvasElement>('canvas[data-fieldnotes-minimap]');
      if (!wrapper || !minimap) throw new Error('demo viewport not found');
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const waitFor = async (predicate: () => boolean) => {
        for (let frame = 0; frame < 60; frame++) {
          if (predicate()) return;
          await nextFrame();
        }
        throw new Error('condition did not become true');
      };
      minimap.dispatchEvent(new Event('contextlost', { cancelable: true }));
      const minimapIgnored = !wrapper.querySelector('[data-fieldnotes-context-loss-mask]');

      const dom = document.createElement('div');
      viewport.addHtmlElement(dom, { x: 20, y: 20 }, { w: 30, h: 30 });
      viewport.addShape({ position: { x: 20, y: 20 }, size: { w: 30, h: 30 } });
      viewport.requestRender();
      await waitFor(() => Boolean(wrapper.querySelector('canvas[data-paint-order]')));
      const base = wrapper.querySelector<HTMLCanvasElement>(':scope > canvas');
      const hybrid = wrapper.querySelector<HTMLCanvasElement>('canvas[data-paint-order]');
      if (!base || !hybrid) throw new Error('persistent canvases not created');
      base.dispatchEvent(new Event('contextlost', { cancelable: true }));
      hybrid.dispatchEvent(new Event('contextlost', { cancelable: true }));
      const mask = wrapper.querySelector<HTMLElement>('[data-fieldnotes-context-loss-mask]');
      const wrapperRect = wrapper.getBoundingClientRect();
      const maskRect = mask?.getBoundingClientRect();
      const masked =
        mask === wrapper.lastElementChild &&
        mask?.style.position === 'absolute' &&
        mask.style.inset === '0px' &&
        mask.style.opacity === '1' &&
        mask.style.zIndex === '2147483647' &&
        mask.style.background === 'rgb(0, 0, 0)' &&
        maskRect !== undefined &&
        maskRect.width === wrapperRect.width &&
        maskRect.height === wrapperRect.height;
      base.dispatchEvent(new Event('contextrestored'));
      const remainsAfterBase = Boolean(
        wrapper.querySelector('[data-fieldnotes-context-loss-mask]'),
      );
      hybrid.dispatchEvent(new Event('contextrestored'));
      await waitFor(() => !wrapper.querySelector('[data-fieldnotes-context-loss-mask]'));
      const replacement = wrapper.querySelector<HTMLCanvasElement>('canvas[data-paint-order]');
      const recovered = !wrapper.querySelector('[data-fieldnotes-context-loss-mask]');
      viewport.destroy();
      base.dispatchEvent(new Event('contextlost', { cancelable: true }));
      return {
        minimapIgnored,
        masked,
        remainsAfterBase,
        recovered,
        replaced: replacement !== hybrid,
        detachedStaysClear: !wrapper.querySelector('[data-fieldnotes-context-loss-mask]'),
      };
    });

    expect(result).toEqual({
      minimapIgnored: true,
      masked: true,
      remainsAfterBase: true,
      recovered: true,
      replaced: true,
      detachedStaysClear: true,
    });
  });
});
