// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from '../canvas/viewport';
import type { SelectTool } from '../tools/select-tool';

// jsdom has no 2D backend; without a context the render loop bails before syncing DOM nodes.
function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function dispatch(target: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      pointerType,
      pressure: 0.5,
    }),
  );
}

describe('Integration: live html elements', () => {
  let container: HTMLDivElement;
  let vp: Viewport;
  let wrapper: HTMLElement;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return stubContext(this);
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    vp = new Viewport(container, { tools: 'default' });
    const first = container.firstElementChild;
    if (!(first instanceof HTMLElement)) throw new Error('wrapper not found');
    wrapper = first;
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  function addLive(size = { w: 200, h: 100 }) {
    const content = document.createElement('div');
    const button = document.createElement('button');
    content.appendChild(button);
    const id = vp.addHtmlElement(content, { x: 100, y: 100 }, size, { interactive: true });
    (vp as unknown as { renderLoop: { flush(): void } }).renderLoop.flush();
    if (!wrapper.contains(button)) throw new Error('live node not mounted');
    return { id, content, button };
  }

  const positionX = (id: string) => vp.store.getById(id)?.position.x;

  it('padding drag moves a live element in one undo step', () => {
    const { id, content } = addLive();

    dispatch(content, 'pointerdown', 120, 150);
    dispatch(wrapper, 'pointermove', 140, 150);
    dispatch(wrapper, 'pointermove', 160, 150);
    dispatch(wrapper, 'pointerup', 160, 150);

    expect(positionX(id)).toBe(100 + 40 / vp.camera.zoom);
    vp.undo();
    expect(positionX(id)).toBe(100);
  });

  it('press on a live button records no history and selects nothing', () => {
    const { button } = addLive();
    const undoCount = vp.history.undoCount;

    dispatch(button, 'pointerdown', 250, 150);
    dispatch(button, 'pointerup', 250, 150);

    expect(vp.history.undoCount).toBe(undoCount);
    expect(vp.getSelectedIds()).toEqual([]);
  });

  it('locked layer: live control still clicks, padding does not select', () => {
    const { id, content, button } = addLive();
    const layerId = vp.store.getById(id)?.layerId ?? '';
    vp.layerManager.createLayer();
    vp.layerManager.setLayerLocked(layerId, true);
    expect(vp.layerManager.isLayerLocked(layerId)).toBe(true);
    const capture = vi.fn();
    wrapper.setPointerCapture = capture;

    dispatch(button, 'pointerdown', 250, 150);
    dispatch(button, 'pointerup', 250, 150);
    expect(capture).not.toHaveBeenCalled();

    dispatch(content, 'pointerdown', 120, 150);
    dispatch(content, 'pointerup', 120, 150);
    expect(vp.getSelectedIds()).toEqual([]);
  });

  it('resize handle over a full-width button resizes', () => {
    const { id, button } = addLive();
    vp.toolManager.getTool<SelectTool>('select')?.setSelection([id]);

    dispatch(button, 'pointerdown', 300, 200);
    dispatch(wrapper, 'pointermove', 320, 220);
    dispatch(wrapper, 'pointermove', 340, 240);
    dispatch(wrapper, 'pointerup', 340, 240);

    const el = vp.store.getById(id);
    expect(el && 'size' in el ? el.size : null).toEqual({ w: 240, h: 140 });
  });

  it('pen press on a live control starts no stroke', () => {
    const { button } = addLive();
    vp.setTool('pencil');

    dispatch(button, 'pointerdown', 250, 150, 'pen');
    dispatch(button, 'pointermove', 260, 160, 'pen');
    dispatch(button, 'pointermove', 270, 170, 'pen');
    dispatch(button, 'pointerup', 270, 170, 'pen');

    expect(vp.store.getElementsByType('stroke')).toEqual([]);
  });

  describe('keyboard', () => {
    function press(target: Element, key: string) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }

    function addSelectedLive() {
      const live = addLive();
      vp.toolManager.getTool<SelectTool>('select')?.setSelection([live.id]);
      return live;
    }

    it('Delete on a focused live button does not delete the selection', () => {
      const { id, button } = addSelectedLive();
      button.focus();

      press(button, 'Delete');

      expect(vp.store.getById(id)).toBeDefined();
    });

    it('Space on a focused live button does not set the pan flag', () => {
      const { button } = addSelectedLive();
      button.focus();

      press(button, ' ');
      dispatch(wrapper, 'pointerdown', 600, 400);
      dispatch(wrapper, 'pointermove', 640, 420);
      dispatch(wrapper, 'pointermove', 680, 440);
      dispatch(wrapper, 'pointerup', 680, 440);

      expect(vp.camera.position).toEqual({ x: 0, y: 0 });
    });

    it('(guard) Delete on a focused button outside any live node still runs', () => {
      const { id } = addSelectedLive();
      const stray = document.createElement('button');
      wrapper.appendChild(stray);
      stray.focus();

      press(stray, 'Delete');

      expect(vp.store.getById(id)).toBeUndefined();
    });
  });
});
