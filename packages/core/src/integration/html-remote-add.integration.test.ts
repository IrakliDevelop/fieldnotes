// @vitest-environment jsdom
// TD-16: pins current behaviour; placeholder rendering by htmlType is an open owner decision.
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
  });

  const wrapperOf = (id: string): HTMLElement | null =>
    container.querySelector(`[data-element-id="${id}"]`);

  it('remote html without a local DOM node: element stored, empty inert wrapper', async () => {
    const diagnostics: HtmlPaintDiagnostic[] = [];
    vp.onHtmlPaintDiagnostic((d) => diagnostics.push(d));
    const el = createHtmlElement({
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      domId: 'not-in-this-document',
    });

    vp.store.add(el, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(vp.store.getById(el.id)).toEqual(el);
    const wrapper = wrapperOf(el.id);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.childNodes.length).toBe(0);
    expect(wrapper?.style.pointerEvents).toBe('none');
    expect(diagnostics).toEqual([]);
  });

  it('registered html renderer is not invoked on remote add, only on loadState', async () => {
    const factory = vi.fn(() => document.createElement('span'));
    vp.registerHtmlRenderer('embed', factory);
    const el = createHtmlElement({
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'embed',
    });

    vp.store.add(el, { origin: REMOTE_ORIGIN });
    await nextFrame();

    expect(factory).toHaveBeenCalledTimes(0);
    expect(wrapperOf(el.id)?.childNodes.length).toBe(0);

    vp.loadState(vp.exportState());

    expect(factory).toHaveBeenCalledTimes(1);
    expect(wrapperOf(el.id)?.firstChild?.nodeName).toBe('SPAN');
  });

  it('canvas-routed htmlType paints on remote add with no DOM wrapper', async () => {
    const painted: string[] = [];
    vp.registerHtmlPainter('marker', ({ element }) => painted.push(element.id));
    const el = createHtmlElement({
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
