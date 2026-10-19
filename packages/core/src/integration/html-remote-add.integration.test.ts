// @vitest-environment jsdom
// TD-16: html elements render through registered renderers on any add; placeholder otherwise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from '../canvas/viewport';
import { createHtmlElement } from '../elements/element-factory';
import type { HtmlPaintDiagnostic } from '../canvas/html-paint-diagnostics';

// Literal of REMOTE_ORIGIN in packages/sync/src/sync-client.ts; core cannot import sync.
const REMOTE_ORIGIN = 'remote';

// jsdom has no 2D backend; without a context the render loop bails before syncing DOM nodes.
function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      }
      return () => undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('Integration: html element added by a remote peer (TD-16)', () => {
  let container: HTMLDivElement;
  let vp: Viewport;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return stubContext(this);
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    vp = new Viewport(container);
    const canvas = container.querySelector('canvas');
    if (!canvas) throw new Error('canvas not found');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const wrapperOf = (id: string): HTMLElement | null =>
    container.querySelector(`[data-element-id="${id}"]`);

  const placeholderOf = (id: string): Element | null | undefined =>
    wrapperOf(id)?.querySelector('.fn-html-placeholder');

  it('remote html without renderer shows a labelled placeholder', async () => {
    const diagnostics: HtmlPaintDiagnostic[] = [];
    vp.onHtmlPaintDiagnostic((d) => diagnostics.push(d));
    const typed = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'chart',
    });
    const untyped = createHtmlElement({
      index: 'a0',
      position: { x: 100, y: 0 },
      size: { w: 50, h: 50 },
      domId: 'not-in-this-document',
    });

    vp.store.add(typed, { origin: REMOTE_ORIGIN });
    vp.store.add(untyped, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(vp.store.getById(typed.id)).toEqual(typed);
    expect(placeholderOf(typed.id)?.textContent).toBe('chart widget');
    expect(placeholderOf(untyped.id)?.textContent).toBe('HTML widget');
    expect(wrapperOf(typed.id)?.style.pointerEvents).toBe('none');
    expect(wrapperOf(untyped.id)?.style.pointerEvents).toBe('none');
    expect(diagnostics).toEqual([]);
  });

  it('registered html renderer builds the DOM on remote add', async () => {
    const built = document.createElement('span');
    const factory = vi.fn(() => built);
    vp.registerHtmlRenderer('embed', factory);
    const el = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'embed',
      interactive: true,
    });

    vp.store.add(el, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(el);
    expect(wrapperOf(el.id)?.contains(built)).toBe(true);
    expect(placeholderOf(el.id)).toBeNull();

    const other = document.createElement('div');
    document.body.appendChild(other);
    const loaded = new Viewport(other);
    loaded.registerHtmlRenderer('embed', () => document.createElement('span'));
    loaded.loadState(vp.exportState());
    const loadedWrapper = other.querySelector<HTMLElement>(`[data-element-id="${el.id}"]`);
    expect(loadedWrapper?.style.pointerEvents).toBe('auto');
    expect(wrapperOf(el.id)?.style.pointerEvents).toBe(loadedWrapper?.style.pointerEvents);
    loaded.destroy();
    other.remove();
  });

  it('addHtmlElement with a registered renderer does not call the factory', async () => {
    const factory = vi.fn(() => document.createElement('span'));
    vp.registerHtmlRenderer('chart', factory);
    const own = document.createElement('div');

    const id = vp.addHtmlElement(own, { x: 0, y: 0 }, { w: 50, h: 50 }, { htmlType: 'chart' });
    await nextFrame();

    expect(factory).toHaveBeenCalledTimes(0);
    expect(wrapperOf(id)?.contains(own)).toBe(true);
  });

  it('undoing a widget delete rebuilds it through the renderer', async () => {
    const built = document.createElement('span');
    const factory = vi.fn(() => built);
    vp.registerHtmlRenderer('chart', factory);
    const id = vp.addHtmlElement(
      document.createElement('div'),
      { x: 0, y: 0 },
      { w: 50, h: 50 },
      { htmlType: 'chart' },
    );
    await nextFrame();

    vp.removeElements([id]);
    vp.undo();
    await nextFrame();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(wrapperOf(id)?.contains(built)).toBe(true);
    expect(placeholderOf(id)).toBeNull();
  });

  it('a second remote update of the same element does not call the factory again', async () => {
    const factory = vi.fn(() => document.createElement('span'));
    vp.registerHtmlRenderer('chart', factory);
    const el = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'chart',
    });

    vp.store.add(el, { origin: REMOTE_ORIGIN });
    vp.store.update(el.id, { data: { n: 1 } }, { origin: REMOTE_ORIGIN });
    vp.store.update(el.id, { data: { n: 2 } }, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('a throwing renderer reports and leaves the placeholder', async () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
    const failure = new Error('renderer failed');
    vp.registerHtmlRenderer('chart', () => {
      throw failure;
    });
    const el = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'chart',
    });

    expect(() => vp.store.add(el, { origin: REMOTE_ORIGIN })).not.toThrow();
    await nextFrame();

    expect(reported).toEqual([failure]);
    expect(placeholderOf(el.id)?.textContent).toBe('chart widget');
  });

  it('no placeholder when onHtmlElementMount is set', async () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const hosted = new Viewport(other, { onHtmlElementMount: () => undefined });
    const el = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'chart',
    });

    hosted.store.add(el, { origin: REMOTE_ORIGIN });
    await nextFrame();

    const node = other.querySelector(`[data-element-id="${el.id}"]`);
    expect(node).not.toBeNull();
    expect(node?.querySelector('.fn-html-placeholder')).toBeNull();
    hosted.destroy();
    other.remove();
  });

  describe('interacting', () => {
    let origElementFromPoint: typeof document.elementFromPoint;

    beforeEach(() => {
      origElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(null);
    });

    afterEach(() => {
      document.elementFromPoint = origElementFromPoint;
    });

    function doubleTap(target: Element, x: number, y: number): void {
      for (let i = 0; i < 2; i++) {
        target.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }),
        );
        target.dispatchEvent(
          new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }),
        );
      }
    }

    it('an element being interacted with keeps pointer events after a data update', async () => {
      const id = vp.addHtmlElement(
        document.createElement('div'),
        { x: 0, y: 0 },
        { w: 100, h: 100 },
      );
      await nextFrame();
      const viewportWrapper = container.firstElementChild;
      if (!viewportWrapper) throw new Error('viewport wrapper not found');

      doubleTap(viewportWrapper, 50, 50);
      expect(wrapperOf(id)?.style.pointerEvents).toBe('auto');

      vp.store.update(id, { data: { n: 1 } });
      await nextFrame();
      expect(wrapperOf(id)?.style.pointerEvents).toBe('auto');

      vp.stopInteracting();
      vp.store.update(id, { data: { n: 2 } });
      await nextFrame();
      expect(wrapperOf(id)?.style.pointerEvents).toBe('none');
    });
  });

  it('canvas-routed htmlType paints on remote add with no DOM wrapper', async () => {
    const painted: string[] = [];
    vp.registerHtmlPainter('marker', ({ element }) => painted.push(element.id));
    const el = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'marker',
    });

    vp.store.add(el, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(painted).toContain(el.id);
    expect(wrapperOf(el.id)).toBeNull();
  });
});
