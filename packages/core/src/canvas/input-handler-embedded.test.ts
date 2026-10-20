/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Camera } from './camera';
import { InputHandler } from './input-handler';
import type { InputHandlerOptions } from './input-handler';
import type { ToolContext } from '../tools/types';
import type { Viewport } from './viewport';
import type { ActionContext } from '../actions/types';
import { ActionRegistry } from '../actions/action-registry';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import { ElementStore } from '../elements/element-store';
import { ToolManager } from '../tools/tool-manager';
import { createNote } from '../elements/element-factory';

const rejectTouch = (e: PointerEvent): boolean => e.pointerType !== 'touch';

let cleanups: (() => void)[] = [];
let rafQueue: { id: number; cb: FrameRequestCallback }[] = [];
let nextRafId = 0;

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    nextRafId += 1;
    rafQueue.push({ id: nextRafId, cb });
    return nextRafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafQueue = rafQueue.filter((f) => f.id !== id);
  });
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  vi.unstubAllGlobals();
});

function setup(options: Partial<InputHandlerOptions> = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const camera = new Camera();
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const calls = { down: 0, move: 0, up: 0, cancel: 0, hover: 0 };
  const toolManager = new ToolManager();
  const toolContext: ToolContext = {
    camera,
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
  };
  toolManager.register({
    name: 'recording',
    onPointerDown: () => calls.down++,
    onPointerMove: () => calls.move++,
    onPointerUp: () => {
      calls.up++;
      store.add(createNote({ position: { x: 0, y: 0 } }));
    },
    onPointerCancel: () => calls.cancel++,
    onHover: () => calls.hover++,
  });
  toolManager.setTool('recording', toolContext);
  const handler = new InputHandler(element, camera, {
    toolManager,
    toolContext,
    historyRecorder: recorder,
    historyStack: stack,
    actions: new ActionRegistry((): ActionContext => ({
      viewport: null as unknown as Viewport,
      store: null as unknown as ActionContext['store'],
      selectedIds: [],
    })),
    ...options,
  });
  cleanups.push(() => {
    handler.destroy();
    element.remove();
  });
  return { element, camera, stack, calls, handler };
}

function pointer(el: HTMLElement, type: string, opts: PointerEventInit): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }));
}

function touches(el: HTMLElement, type: string, count: number): void {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'touches', { value: { length: count } });
  el.dispatchEvent(e);
}

function gesture(el: HTMLElement, type: string, scale: number, clientX = 0, clientY = 0): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'scale', { value: scale });
  Object.defineProperty(e, 'clientX', { value: clientX });
  Object.defineProperty(e, 'clientY', { value: clientY });
  el.dispatchEvent(e);
  return e;
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

function flickMousePan(el: HTMLElement): void {
  const mouse = { pointerId: 9, pointerType: 'mouse', button: 1 };
  pointer(el, 'pointerdown', { ...mouse, clientX: 100, clientY: 100 });
  pointer(el, 'pointermove', { ...mouse, clientX: 130, clientY: 100 });
  pointer(el, 'pointermove', { ...mouse, clientX: 160, clientY: 100 });
  pointer(el, 'pointerup', { ...mouse, clientX: 160, clientY: 100 });
}

describe('InputHandler embedded wheel', () => {
  it('embedded plain wheel is not prevented and passes through', () => {
    const onWheelPassThrough = vi.fn();
    const { element, camera } = setup({ embeddedWheel: true, onWheelPassThrough });

    const e = wheel(element, { deltaY: 100 });

    expect(e.defaultPrevented).toBe(false);
    expect(camera.zoom).toBe(1);
    expect(onWheelPassThrough).toHaveBeenCalledTimes(1);
    expect(onWheelPassThrough).toHaveBeenCalledWith(e);
  });

  it.each(['ctrlKey', 'metaKey'] as const)(
    'embedded ctrl+wheel and meta+wheel zoom (%s)',
    (key) => {
      const onWheelPassThrough = vi.fn();
      const { element, camera } = setup({ embeddedWheel: true, onWheelPassThrough });

      const e = wheel(element, { deltaY: -100, [key]: true });

      expect(e.defaultPrevented).toBe(true);
      expect(camera.zoom).toBeCloseTo(1.1);
      expect(onWheelPassThrough).not.toHaveBeenCalled();
    },
  );

  it('non-embedded plain wheel still zooms', () => {
    const { element, camera } = setup();

    const e = wheel(element, { deltaY: 100 });

    expect(e.defaultPrevented).toBe(true);
    expect(camera.zoom).toBeCloseTo(0.9);
  });
});

describe('InputHandler pointer gate', () => {
  it('rejected touch pointer is ignored entirely', () => {
    const { element, handler, calls } = setup({ acceptsPointer: rejectTouch });
    flickMousePan(element);
    const capture = vi.fn();
    element.setPointerCapture = capture;

    const touch = { pointerId: 1, pointerType: 'touch' };
    pointer(element, 'pointerdown', { ...touch, clientX: 10, clientY: 10 });
    pointer(element, 'pointermove', { ...touch, clientX: 60, clientY: 10 });
    pointer(element, 'pointerup', { ...touch, clientX: 60, clientY: 10 });

    expect(calls).toEqual({ down: 0, move: 0, up: 0, cancel: 0, hover: 0 });
    expect(capture).not.toHaveBeenCalled();
    expect(handler.isCameraCoasting()).toBe(true);

    const mouse = { pointerId: 2, pointerType: 'mouse', button: 0 };
    pointer(element, 'pointerdown', mouse);
    pointer(element, 'pointerup', mouse);
    expect(calls).toMatchObject({ down: 1, up: 1 });
  });

  it('touch pointer rejected at down is not adopted after the gate opens', () => {
    let engaged = false;
    const { element, calls } = setup({ acceptsPointer: (e) => engaged || rejectTouch(e) });

    const touch = { pointerId: 1, pointerType: 'touch' };
    pointer(element, 'pointerdown', { ...touch, clientX: 10, clientY: 10 });
    engaged = true;
    pointer(element, 'pointermove', { ...touch, clientX: 60, clientY: 10 });
    pointer(element, 'pointerup', { ...touch, clientX: 60, clientY: 10 });

    expect(calls).toEqual({ down: 0, move: 0, up: 0, cancel: 0, hover: 0 });
  });
});

describe('InputHandler Safari gesture events', () => {
  it('safari gesturechange on a disengaged board with a rejected touch does not zoom and is not prevented', () => {
    const { element, camera } = setup({ embeddedWheel: true, acceptsPointer: rejectTouch });

    touches(element, 'touchstart', 1);
    pointer(element, 'pointerdown', { pointerId: 1, pointerType: 'touch' });
    pointer(element, 'pointercancel', { pointerId: 1, pointerType: 'touch' });
    const start = gesture(element, 'gesturestart', 1);
    const change = gesture(element, 'gesturechange', 2, 100, 50);

    expect(start.defaultPrevented).toBe(false);
    expect(change.defaultPrevented).toBe(false);
    expect(camera.zoom).toBe(1);
  });

  it('safari gesture events zoom only when embedded and no touch is down', () => {
    const { element, camera } = setup({ embeddedWheel: true });

    expect(gesture(element, 'gesturestart', 1).defaultPrevented).toBe(true);
    expect(gesture(element, 'gesturechange', 2, 100, 50).defaultPrevented).toBe(true);
    expect(camera.zoom).toBe(2);
    expect(camera.screenToWorld({ x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    gesture(element, 'gesturechange', 3, 100, 50);
    expect(camera.zoom).toBe(3);

    touches(element, 'touchstart', 1);
    pointer(element, 'pointerdown', { pointerId: 1, pointerType: 'touch' });
    gesture(element, 'gesturestart', 1);
    expect(gesture(element, 'gesturechange', 2, 100, 50).defaultPrevented).toBe(false);
    expect(camera.zoom).toBe(3);

    touches(element, 'touchend', 0);
    gesture(element, 'gesturestart', 1);
    expect(gesture(element, 'gesturechange', 0.5, 100, 50).defaultPrevented).toBe(true);
    expect(camera.zoom).toBe(1.5);

    const plain = setup();
    gesture(plain.element, 'gesturestart', 1);
    expect(gesture(plain.element, 'gesturechange', 2, 100, 50).defaultPrevented).toBe(false);
    expect(plain.camera.zoom).toBe(1);
  });
});

describe('InputHandler.cancelTouchGestures', () => {
  it('cancelTouchGestures cancels a touch stroke without an undo step', () => {
    const { element, handler, calls, stack } = setup();
    const release = vi.fn();
    element.releasePointerCapture = release;

    const touch = { pointerId: 1, pointerType: 'touch' };
    pointer(element, 'pointerdown', { ...touch, clientX: 10, clientY: 10 });
    pointer(element, 'pointermove', { ...touch, clientX: 30, clientY: 10 });
    handler.cancelTouchGestures();

    expect(calls).toEqual({ down: 1, move: 1, up: 0, cancel: 1, hover: 0 });
    expect(release).toHaveBeenCalledWith(1);
    expect(stack.undoCount).toBe(0);

    pointer(element, 'pointermove', { ...touch, clientX: 50, clientY: 10 });
    pointer(element, 'pointerup', { ...touch, clientX: 50, clientY: 10 });
    expect(calls).toEqual({ down: 1, move: 1, up: 0, cancel: 1, hover: 0 });

    const tap = { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 };
    pointer(element, 'pointerdown', tap);
    pointer(element, 'pointerup', tap);
    expect(calls).toMatchObject({ down: 2, up: 1, cancel: 1 });
    expect(stack.undoCount).toBe(1);
  });

  it('cancelTouchGestures mid-pinch leaves no pan and no coast', () => {
    const { element, handler, calls, camera } = setup();
    flickMousePan(element);

    pointer(element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    });
    pointer(element, 'pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 50,
      clientY: 10,
    });
    pointer(element, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 0,
      clientY: 20,
    });
    pointer(element, 'pointermove', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 70,
      clientY: 20,
    });
    handler.cancelTouchGestures();

    expect(handler.isCameraCoasting()).toBe(false);
    const position = camera.position;
    const zoom = camera.zoom;

    pointer(element, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 0,
      clientY: 60,
    });
    const tap = { pointerId: 3, pointerType: 'touch' };
    pointer(element, 'pointerdown', { ...tap, clientX: 100, clientY: 100 });
    pointer(element, 'pointermove', { ...tap, clientX: 120, clientY: 100 });
    pointer(element, 'pointerup', { ...tap, clientX: 120, clientY: 100 });

    expect(calls).toEqual({ down: 1, move: 1, up: 1, cancel: 0, hover: 0 });
    expect(camera.position).toEqual(position);
    expect(camera.zoom).toBe(zoom);
  });

  it('cancelTouchGestures leaves a mouse from a mixed pinch panning without a jump', () => {
    const { element, handler, camera } = setup();

    pointer(element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    pointer(element, 'pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 90,
      clientY: 10,
    });
    handler.cancelTouchGestures();
    pointer(element, 'pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 20,
      clientY: 10,
    });

    expect(camera.position).toEqual({ x: 10, y: 0 });
  });

  it('cancelTouchGestures stops a coast', () => {
    const { element, handler } = setup();
    flickMousePan(element);
    expect(handler.isCameraCoasting()).toBe(true);

    handler.cancelTouchGestures();

    expect(handler.isCameraCoasting()).toBe(false);
  });

  it('cancelTouchGestures leaves a pen stroke running', () => {
    const { element, handler, calls, stack } = setup();

    const pen = { pointerId: 1, pointerType: 'pen', button: 0, pressure: 0.5 };
    pointer(element, 'pointerdown', { ...pen, clientX: 10, clientY: 10 });
    pointer(element, 'pointermove', { ...pen, clientX: 20, clientY: 10 });
    handler.cancelTouchGestures();
    pointer(element, 'pointermove', { ...pen, clientX: 30, clientY: 10 });
    pointer(element, 'pointerup', { ...pen, clientX: 30, clientY: 10 });

    expect(calls).toEqual({ down: 1, move: 2, up: 1, cancel: 0, hover: 0 });
    expect(stack.undoCount).toBe(1);
  });
});
