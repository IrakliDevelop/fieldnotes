// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from './viewport';
import type { ViewportOptions } from './viewport';
import { createNote } from '../elements/element-factory';
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

function pointer(target: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      pointerType,
      pressure: 0.5,
    }),
  );
}

function drag(target: Element, pointerType: string) {
  pointer(target, 'pointerdown', 100, 100, pointerType);
  pointer(target, 'pointermove', 120, 120, pointerType);
  pointer(target, 'pointermove', 140, 140, pointerType);
  pointer(target, 'pointerup', 140, 140, pointerType);
}

function doubleTap(target: Element, x: number, y: number, pointerType: string) {
  for (let i = 0; i < 2; i++) {
    pointer(target, 'pointerdown', x, y, pointerType);
    pointer(target, 'pointerup', x, y, pointerType);
  }
}

function touchStart(target: Element, touches: object[]): Event {
  const e = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: touches } });
  target.dispatchEvent(e);
  return e;
}

function pressEscape(): Event {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
}

describe('Viewport embedded mode', () => {
  let container: HTMLDivElement;
  let vp: Viewport;
  let wrapper: HTMLElement;
  const originalElementFromPoint = document.elementFromPoint;

  function mount(options: ViewportOptions = { embedded: true }) {
    vp = new Viewport(container, { tools: 'default', ...options });
    const first = container.firstElementChild;
    if (!(first instanceof HTMLElement)) throw new Error('wrapper not found');
    wrapper = first;
  }

  const flush = () => (vp as unknown as { renderLoop: { flush(): void } }).renderLoop.flush();

  function nodeOf(id: string): HTMLElement {
    const node = wrapper.querySelector(`[data-element-id="${id}"]`);
    if (!(node instanceof HTMLElement)) throw new Error('element node not mounted');
    return node;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return stubContext(this);
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
    document.elementFromPoint = originalElementFromPoint;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('embedded viewport starts disengaged with manipulation touch-action', () => {
    mount();

    expect(vp.isEmbeddedEngaged()).toBe(false);
    expect(wrapper.style.touchAction).toBe('manipulation');
    expect(wrapper.style.overscrollBehavior).toBe('auto');
  });

  it('setEmbeddedEngaged toggles touch-action and notifies once', () => {
    mount();
    const listener = vi.fn();
    vp.onEmbeddedEngagedChange(listener);

    vp.setEmbeddedEngaged(true);
    vp.setEmbeddedEngaged(true);
    expect(vp.isEmbeddedEngaged()).toBe(true);
    expect(wrapper.style.touchAction).toBe('none');
    expect(listener.mock.calls).toEqual([[true]]);

    vp.setEmbeddedEngaged(false);
    expect(wrapper.style.touchAction).toBe('manipulation');
    expect(listener.mock.calls).toEqual([[true], [false]]);
  });

  it('non-embedded viewport reports engaged and never notifies', () => {
    mount({});
    const listener = vi.fn();
    vp.onEmbeddedEngagedChange(listener);

    vp.setEmbeddedEngaged(false);
    pressEscape();

    expect(vp.isEmbeddedEngaged()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(wrapper.style.touchAction).toBe('none');
  });

  it.each([true, false])(
    'onWheelPassThrough fires for plain wheel only when embedded (embedded: %s)',
    (embedded) => {
      mount({ embedded });
      const listener = vi.fn();
      vp.onWheelPassThrough(listener);

      const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 });
      wrapper.dispatchEvent(plain);
      wrapper.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10, ctrlKey: true }),
      );

      expect(listener.mock.calls).toEqual(embedded ? [[plain]] : []);
    },
  );

  it('unsubscribed onWheelPassThrough listener stops firing', () => {
    mount();
    const listener = vi.fn();
    vp.onWheelPassThrough(listener)();

    wrapper.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('disengaged touch double-tap on a note opens no editor', () => {
    mount();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 }, text: 'hi' });
    vp.store.add(note);
    flush();
    const node = nodeOf(note.id);
    document.elementFromPoint = () => node;

    doubleTap(node, 50, 50, 'touch');
    vi.advanceTimersToNextFrame();

    expect(node.contentEditable).not.toBe('true');
  });

  it('disengaged touch double-tap on a non-live html element enters no InteractMode', () => {
    mount();
    document.elementFromPoint = () => null;
    const id = vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, { w: 200, h: 100 });
    flush();

    doubleTap(wrapper, 50, 50, 'touch');

    expect(nodeOf(id).style.pointerEvents).toBe('none');
  });

  it('disengaging during a touch stroke leaves no stroke and no undo step', () => {
    mount();
    vp.setTool('pencil');
    vp.setEmbeddedEngaged(true);

    pointer(wrapper, 'pointerdown', 100, 100, 'touch');
    pointer(wrapper, 'pointermove', 120, 120, 'touch');
    pointer(wrapper, 'pointermove', 140, 140, 'touch');
    vp.setEmbeddedEngaged(false);
    pointer(wrapper, 'pointerup', 140, 140, 'touch');

    expect(vp.store.getElementsByType('stroke')).toEqual([]);
    expect(vp.history.undoCount).toBe(0);
  });

  it('disengaging keeps the selection', () => {
    mount();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 } });
    vp.store.add(note);
    vp.toolManager.getTool<SelectTool>('select')?.setSelection([note.id]);
    vp.setEmbeddedEngaged(true);

    vp.setEmbeddedEngaged(false);

    expect(vp.getSelectedIds()).toEqual([note.id]);
  });

  it.each(['mouse', 'pen'])('%s pointer draws while disengaged', (pointerType) => {
    mount();
    vp.setTool('pencil');

    drag(wrapper, pointerType);

    expect(vp.store.getElementsByType('stroke')).toHaveLength(1);
    expect(vp.history.undoCount).toBe(1);
  });

  it('disengaged touch draws nothing', () => {
    mount();
    vp.setTool('pencil');

    drag(wrapper, 'touch');

    expect(vp.store.getElementsByType('stroke')).toEqual([]);
  });

  it('stylus touchstart is prevented while disengaged, finger touchstart is not, stylus on a live control is not', () => {
    mount();
    const content = document.createElement('div');
    const button = document.createElement('button');
    content.appendChild(button);
    vp.addHtmlElement(content, { x: 0, y: 0 }, { w: 200, h: 100 }, { interactive: true });
    flush();

    expect(touchStart(wrapper, [{ touchType: 'stylus' }]).defaultPrevented).toBe(true);
    expect(touchStart(wrapper, [{ touchType: 'direct' }]).defaultPrevented).toBe(false);
    expect(touchStart(wrapper, [{}]).defaultPrevented).toBe(false);
    expect(touchStart(button, [{ touchType: 'stylus' }]).defaultPrevented).toBe(false);
    expect(touchStart(content, [{ touchType: 'stylus' }]).defaultPrevented).toBe(true);
  });

  it('stylus touchstart is not prevented while engaged', () => {
    mount();
    vp.setEmbeddedEngaged(true);

    expect(touchStart(wrapper, [{ touchType: 'stylus' }]).defaultPrevented).toBe(false);
  });

  it('touchstart without touchType is prevented only within 50 ms of a pen pointerdown', () => {
    mount();

    pointer(wrapper, 'pointerdown', 10, 10, 'pen');
    vi.advanceTimersByTime(50);
    expect(touchStart(wrapper, [{}]).defaultPrevented).toBe(true);

    pointer(wrapper, 'pointerdown', 10, 10, 'pen');
    vi.advanceTimersByTime(51);
    expect(touchStart(wrapper, [{}]).defaultPrevented).toBe(false);

    pointer(wrapper, 'pointerdown', 10, 10, 'mouse');
    expect(touchStart(wrapper, [{}]).defaultPrevented).toBe(false);
  });

  it('destroy while engaged leaves Escape and setEmbeddedEngaged inert', () => {
    mount();
    const listener = vi.fn();
    vp.onEmbeddedEngagedChange(listener);
    vp.setEmbeddedEngaged(true);
    listener.mockClear();

    vp.destroy();
    pressEscape();
    vp.setEmbeddedEngaged(false);

    expect(vp.isEmbeddedEngaged()).toBe(true);
    expect(wrapper.style.touchAction).toBe('none');
    expect(listener).not.toHaveBeenCalled();
  });

  it('destroy while disengaged removes stylus touchstart handling', () => {
    mount();

    vp.destroy();

    expect(touchStart(wrapper, [{ touchType: 'stylus' }]).defaultPrevented).toBe(false);
  });

  it('embedded wrapper scroll resets to 0 without a live node', () => {
    mount();
    wrapper.scrollTop = 40;

    wrapper.dispatchEvent(new Event('scroll'));

    expect(wrapper.scrollTop).toBe(0);
  });
});
