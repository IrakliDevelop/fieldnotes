// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import type { PresentationModeDeps } from './presentation';
import { createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createFrame } from '../elements/frame-element';
import {
  createPresentationActions,
  PresentationMode,
  framePresentationSlides,
} from './presentation';

const stubRestores: (() => void)[] = [];
const modes: PresentationMode[] = [];

function makeMode(deps: PresentationModeDeps): PresentationMode {
  const mode = new PresentationMode(deps);
  modes.push(mode);
  return mode;
}

function stubValue(target: object, key: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value, writable: true });
  stubRestores.push(() => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  });
}

function stubFullscreenElement() {
  let element: Element | null = null;
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => element,
  });
  stubRestores.push(() => {
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor);
    else Reflect.deleteProperty(document, 'fullscreenElement');
  });
  return (value: Element | null) => {
    element = value;
  };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeDeps(overrides: Partial<PresentationModeDeps> = {}) {
  let pending: (() => void)[] = [];
  let clock = 0;
  let resize: (() => void) | undefined;
  const camera = new Camera();
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  document.body.append(container, wrapper);
  const calls = {
    tools: [] as string[],
    order: [] as ('stop' | 'camera')[],
    clearSelection: 0,
    stopCameraMotion: 0,
    disposeResize: 0,
    resize: () => resize?.(),
  };
  const deps: PresentationModeDeps = {
    container,
    wrapper,
    camera,
    getCanvasSize: () => ({ w: 800, h: 600 }),
    defaultSlides: () => [
      { view: { x: 0, y: 0, w: 400, h: 300 } },
      { view: { x: 1000, y: 0, w: 400, h: 300 } },
    ],
    onResize: (listener) => {
      resize = listener;
      return () => {
        calls.disposeResize++;
      };
    },
    activeToolName: () => 'select',
    setTool: (name) => {
      calls.tools.push(name);
      return true;
    },
    clearSelection: () => {
      calls.clearSelection++;
    },
    stopCameraMotion: () => {
      calls.stopCameraMotion++;
      calls.order.push('stop');
    },
    hasOpenOverlay: () => false,
    frames: {
      requestFrame: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      cancelFrame: () => undefined,
    },
    now: () => clock,
    ...overrides,
  };
  camera.onChange(() => calls.order.push('camera'));
  return {
    deps,
    camera,
    wrapper,
    container,
    calls,
    runFrames(ms: number) {
      clock += ms;
      const frames = pending;
      pending = [];
      for (const frame of frames) frame();
    },
  };
}

afterEach(() => {
  for (const mode of modes.splice(0)) mode.destroy();
  for (const restore of stubRestores.splice(0)) restore();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function slidesStore() {
  const store = new ElementStore();
  const frameLate = {
    ...createFrame({
      position: { x: 50, y: 60 },
      size: { w: 200, h: 124 },
      layerId: 'a',
      index: 'a1',
    }),
    id: 'frame-late',
  };
  const frameEarly = {
    ...createFrame({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 80 },
      layerId: 'a',
      index: 'a0',
    }),
    id: 'frame-early',
  };
  const frameHidden = {
    ...createFrame({
      position: { x: 90, y: 100 },
      size: { w: 300, h: 124 },
      layerId: 'b',
      index: 'a0',
    }),
    id: 'frame-hidden',
  };

  store.add(frameLate);
  store.add(frameEarly);
  store.add(createNote({ position: { x: 0, y: 0 }, layerId: 'a', index: 'a2' }));
  store.add(frameHidden);
  store.add(
    createShape({
      position: { x: 20, y: 30 },
      size: { w: 10, h: 10 },
      layerId: 'a',
      index: 'a0',
      parentId: frameEarly.id,
    }),
  );
  store.setLayerOrder(
    new Map([
      ['a', 0],
      ['b', 1],
    ]),
  );

  return { store, frameEarly, frameLate };
}

describe('framePresentationSlides', () => {
  it('lists frames in scene order with content views', () => {
    const { store, frameEarly, frameLate } = slidesStore();

    expect(framePresentationSlides(store, (id) => id !== 'b')).toEqual([
      { view: { x: 10, y: 44, w: 100, h: 56 }, frameId: frameEarly.id },
      { view: { x: 50, y: 84, w: 200, h: 100 }, frameId: frameLate.id },
    ]);
  });

  it('follows bringToFront', () => {
    const { store, frameEarly, frameLate } = slidesStore();
    store.bringToFront(frameEarly.id);

    expect(framePresentationSlides(store, (id) => id !== 'b')).toEqual([
      { view: { x: 50, y: 84, w: 200, h: 100 }, frameId: frameLate.id },
      { view: { x: 10, y: 44, w: 100, h: 56 }, frameId: frameEarly.id },
    ]);
  });
});

describe('PresentationMode', () => {
  it('createPresentationActions gates start on inactive and the rest on active', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const actions = createPresentationActions(mode);
    const action = (id: string) => {
      const definition = actions.find((candidate) => candidate.id === id);
      if (!definition) throw new Error(`action not found: ${id}`);
      return definition;
    };
    const context = {} as never;

    expect(actions.map((definition) => [definition.id, definition.label])).toEqual([
      ['presentation.start', 'Present'],
      ['presentation.exit', 'Exit presentation'],
      ['presentation.next', 'Next slide'],
      ['presentation.previous', 'Previous slide'],
    ]);
    for (const definition of actions) {
      expect(definition.shortcut).toBeUndefined();
      expect(definition.menu).toBeUndefined();
    }
    expect(action('presentation.start').enabled?.(context)).toBe(true);
    expect(action('presentation.exit').enabled?.(context)).toBe(false);
    expect(action('presentation.next').enabled?.(context)).toBe(false);
    expect(action('presentation.previous').enabled?.(context)).toBe(false);

    expect(mode.start({ fullscreen: false })).toBe(true);

    expect(action('presentation.start').enabled?.(context)).toBe(false);
    expect(action('presentation.exit').enabled?.(context)).toBe(true);
    expect(action('presentation.next').enabled?.(context)).toBe(true);
    expect(action('presentation.previous').enabled?.(context)).toBe(true);
    expect(action('presentation.next').perform(context, { source: 'api', shiftKey: false })).toBe(
      true,
    );
  });

  it('start returns false with no slides and leaves the camera alone', () => {
    const h = makeDeps({ defaultSlides: () => [] });
    const mode = makeMode(h.deps);

    expect(mode.start()).toBe(false);
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
  });

  it('start jumps to the first slide, clears the selection and switches to hand', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);

    expect(mode.start({ fullscreen: false })).toBe(true);
    expect(h.camera.zoom).toBe(2);
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(h.calls.clearSelection).toBe(1);
    expect(h.calls.tools).toEqual(['hand']);
    expect(h.calls.stopCameraMotion).toBe(1);
    expect(h.calls.order).toEqual(['stop', 'camera']);
    expect(mode.getState()).toEqual({ active: true, index: 0, count: 2, fullscreen: false });
  });

  it.each(['laser', 'hand'])('start keeps the %s tool', (tool) => {
    const h = makeDeps({ activeToolName: () => tool });
    const mode = makeMode(h.deps);

    mode.start({ fullscreen: false });

    expect(h.calls.tools).toEqual([]);
  });

  it('next and previous stop at the ends and animate', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });
    h.calls.order.length = 0;

    expect(mode.next()).toBe(true);
    h.runFrames(450);
    expect(h.camera.position.x).toBe(-2000);
    expect(mode.getState().index).toBe(1);
    expect(h.calls.stopCameraMotion).toBe(2);
    expect(h.calls.order).toEqual(['stop', 'camera']);
    expect(mode.next()).toBe(false);
    expect(h.calls.stopCameraMotion).toBe(2);
    h.calls.order.length = 0;
    expect(mode.previous()).toBe(true);
    h.runFrames(450);
    expect(mode.getState().index).toBe(0);
    expect(h.camera.position.x).toBe(0);
    expect(h.calls.order).toEqual(['stop', 'camera']);
    expect(mode.previous()).toBe(false);
  });

  it('animate false and reduced motion jump synchronously', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false, animate: false });
    mode.next();
    expect(h.camera.position.x).toBe(-2000);

    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const reduced = makeDeps();
    const reducedMode = makeMode(reduced.deps);
    reducedMode.start({ fullscreen: false });
    reducedMode.next();
    expect(reduced.camera.position.x).toBe(-2000);
  });

  it('goTo rejects out-of-range and non-integer indices', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });

    expect(mode.goTo(2)).toBe(false);
    expect(mode.goTo(-1)).toBe(false);
    expect(mode.goTo(0.5)).toBe(false);
    expect(mode.getState().index).toBe(0);
  });

  it('goTo of the current index re-applies the view without a state change', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    let changes = 0;
    mode.onChange(() => changes++);
    mode.start({ fullscreen: false, animate: false });
    const state = mode.getState();
    h.camera.pan(50, 50);

    expect(mode.goTo(0)).toBe(true);
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(mode.getState()).toBe(state);
    expect(changes).toBe(1);
  });

  it.each([7, 0.5])('start with index %s opens slide 0', (index) => {
    const h = makeDeps();
    const mode = makeMode(h.deps);

    mode.start({ fullscreen: false, index });

    expect(mode.getState().index).toBe(0);
  });

  it('start copies the slides option', () => {
    const slides = [
      { view: { x: 0, y: 0, w: 400, h: 300 } },
      { view: { x: 1000, y: 0, w: 400, h: 300 } },
    ];
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false, slides });
    slides.pop();

    expect(mode.getSlides()).toHaveLength(2);
  });

  it('start throws on an invalid view before changing anything', () => {
    const h = makeDeps({ defaultSlides: () => [{ view: { x: 0, y: 0, w: 0, h: 300 } }] });
    const mode = makeMode(h.deps);

    expect(() => mode.start({ fullscreen: false })).toThrow();
    expect(mode.getState().active).toBe(false);
    expect(h.calls.clearSelection).toBe(0);
    expect(h.calls.tools).toEqual([]);
  });

  it('resize refits the current slide with a jump', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });
    h.camera.pan(50, 50);
    h.calls.order.length = 0;

    h.calls.resize();

    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(h.calls.stopCameraMotion).toBe(2);
    expect(h.calls.order).toEqual(['stop', 'camera']);
  });

  it('exit restores camera and tool and unsubscribes resize', () => {
    const h = makeDeps();
    h.camera.moveTo(10, 20);
    h.camera.setZoom(1.5);
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });

    mode.exit();

    expect(h.camera.position).toEqual({ x: 10, y: 20 });
    expect(h.camera.zoom).toBe(1.5);
    expect(h.calls.tools).toEqual(['hand', 'select']);
    expect(h.calls.disposeResize).toBe(1);
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
    expect(mode.getSlides()).toEqual([]);
  });

  it('exit cancels camera motion before restoring the camera', () => {
    const h = makeDeps();
    h.camera.moveTo(10, 20);
    h.camera.setZoom(1.5);
    let coasting = false;
    h.deps.stopCameraMotion = () => {
      coasting = false;
    };
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false, animate: false });
    h.camera.moveTo(50, 60);
    h.camera.setZoom(3);
    coasting = true;
    h.deps.frames?.requestFrame(() => {
      if (!coasting) return;
      h.camera.moveTo(70, 80);
      h.camera.setZoom(4);
    });

    mode.exit();
    h.runFrames(16);

    expect(h.camera.position).toEqual({ x: 10, y: 20 });
    expect(h.camera.zoom).toBe(1.5);
  });

  it('exit stays clean when setTool returns false', () => {
    const tools: string[] = [];
    const h = makeDeps({
      setTool: (name) => {
        tools.push(name);
        return false;
      },
    });
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });
    expect(tools).toEqual(['hand']);

    expect(() => mode.exit()).not.toThrow();
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(mode.getState().active).toBe(false);
    expect(tools).toEqual(['hand']);
  });

  it('getState keeps its reference until a change', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });
    const state = mode.getState();

    expect(mode.goTo(2)).toBe(false);
    expect(mode.getState()).toBe(state);
    expect(mode.next()).toBe(true);
    expect(mode.getState()).not.toBe(state);
    const end = mode.getState();
    expect(mode.next()).toBe(false);
    expect(mode.getState()).toBe(end);
  });

  it('onChange fires on start, each successful step and exit', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    let changes = 0;
    mode.onChange(() => changes++);

    mode.start({ fullscreen: false });
    expect(changes).toBe(1);
    mode.next();
    expect(changes).toBe(2);
    mode.exit();
    expect(changes).toBe(3);
  });
});

describe('PresentationMode keys', () => {
  it.each([
    ['ArrowRight', false, 0, 1],
    ['ArrowDown', false, 0, 1],
    ['PageDown', false, 0, 1],
    [' ', false, 0, 1],
    ['End', false, 0, 1],
    ['ArrowLeft', false, 1, 0],
    ['ArrowUp', false, 1, 0],
    ['PageUp', false, 1, 0],
    [' ', true, 1, 0],
    ['Home', false, 1, 0],
  ])('table keys call their methods', (key, shiftKey, startIndex, expectedIndex) => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const bubbled = vi.fn();
    window.addEventListener('keydown', bubbled);
    mode.start({ fullscreen: false, animate: false, index: startIndex });
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, shiftKey });

    h.wrapper.dispatchEvent(event);

    expect(mode.getState().index).toBe(expectedIndex);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener('keydown', bubbled);
  });

  it('modifier keys and form targets pass through', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false, animate: false });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const targets: HTMLElement[] = [
      h.wrapper,
      document.createElement('input'),
      Object.assign(document.createElement('input'), { type: 'range' }),
      document.createElement('select'),
      document.createElement('textarea'),
      editable,
    ];
    const live = document.createElement('div');
    live.dataset.elementId = 'x';
    live.dataset.fnLive = '';
    const button = document.createElement('button');
    live.append(button);
    targets.push(button);
    h.wrapper.append(...targets.slice(1, -1), live);

    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
        ...options,
      });
      h.wrapper.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const target of targets.slice(1)) {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(mode.getState().index).toBe(0);
  });

  it('keys from an SVG target are consumed', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const bubbled = vi.fn();
    window.addEventListener('keydown', bubbled);
    h.wrapper.append(svg);
    mode.start({ fullscreen: false, animate: false });
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });

    svg.dispatchEvent(event);

    expect(mode.getState().index).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener('keydown', bubbled);
  });

  it('keys are ignored while inactive and after exit', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const inactive = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    h.wrapper.dispatchEvent(inactive);
    mode.start({ fullscreen: false });
    mode.exit();
    const exited = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    h.wrapper.dispatchEvent(exited);

    expect(inactive.defaultPrevented).toBe(false);
    expect(exited.defaultPrevented).toBe(false);
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
  });

  it('Escape makes state inactive', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    h.wrapper.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mode.getState().active).toBe(false);
  });

  it('leaves Escape to an open overlay before exiting on the next press', () => {
    let open = true;
    const h = makeDeps({ hasOpenOverlay: () => open });
    const mode = makeMode(h.deps);
    mode.start({ fullscreen: false });

    h.wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(mode.getState().active).toBe(true);

    open = false;
    h.wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(mode.getState().active).toBe(false);
  });

  it('navigates from inside a contenteditable false ancestor', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const ancestor = document.createElement('div');
    ancestor.setAttribute('contenteditable', 'false');
    const target = document.createElement('span');
    ancestor.append(target);
    h.wrapper.append(ancestor);
    mode.start({ fullscreen: false, animate: false });

    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(mode.getState().index).toBe(1);
  });

  it('does not navigate from an outside focused element while windowed', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const outside = document.createElement('button');
    document.body.append(outside);
    mode.start({ fullscreen: false, animate: false });
    outside.focus();

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(mode.getState().index).toBe(0);
  });

  it('does not navigate with Space on a focused button in the wrapper', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const button = document.createElement('button');
    h.wrapper.append(button);
    mode.start({ fullscreen: false, animate: false });
    button.focus();

    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(mode.getState().index).toBe(0);
  });

  it('continues notifying listeners when one throws', () => {
    const h = makeDeps();
    const mode = makeMode(h.deps);
    const listener = vi.fn();
    mode.onChange(() => {
      throw new Error('listener failure');
    });
    mode.onChange(listener);

    expect(() => mode.start({ fullscreen: false })).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('PresentationMode fullscreen', () => {
  it('requestFullscreen is called on start and exitFullscreen on exit when the mode owns fullscreen', () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const requestFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(h.container, 'requestFullscreen', requestFullscreen);
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);
    let changes = 0;
    mode.onChange(() => changes++);

    mode.start();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mode.getState()).toEqual({ active: true, index: 0, count: 2, fullscreen: true });
    expect(changes).toBe(2);
    mode.exit();

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(mode.getState().fullscreen).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('start with fullscreen false does not request', () => {
    const h = makeDeps();
    const requestFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(h.container, 'requestFullscreen', requestFullscreen);
    const mode = makeMode(h.deps);

    mode.start({ fullscreen: false });

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('a host-made fullscreen container is reported but not exited', () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(document, 'exitFullscreen', exitFullscreen);
    setFullscreenElement(h.container);
    const mode = makeMode(h.deps);

    mode.start({ fullscreen: false });
    expect(mode.getState().fullscreen).toBe(true);
    mode.exit();

    expect(mode.getState().fullscreen).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('a missing requestFullscreen and a rejected request both stay active and windowed', async () => {
    const missing = makeDeps();
    const missingMode = makeMode(missing.deps);
    missingMode.start();
    expect(missingMode.getState()).toMatchObject({ active: true, fullscreen: false });

    const rejected = makeDeps();
    stubValue(
      rejected.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockRejectedValue(new Error('denied')),
    );
    const rejectedMode = makeMode(rejected.deps);
    rejectedMode.start();
    await Promise.resolve();

    expect(rejectedMode.getState()).toMatchObject({ active: true, fullscreen: false });
  });

  it('a rejected request does not claim later host fullscreen', async () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(
      h.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockRejectedValue(new Error('denied')),
    );
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);

    mode.start();
    await Promise.resolve();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    mode.exit();

    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it.each(['exit', 'destroy'] as const)(
    '%s cleans up a fullscreen request that resolves late',
    async (teardown) => {
      const h = makeDeps();
      const setFullscreenElement = stubFullscreenElement();
      const request = deferred();
      const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      stubValue(
        h.container,
        'requestFullscreen',
        vi.fn<() => Promise<void>>().mockReturnValue(request.promise),
      );
      stubValue(document, 'exitFullscreen', exitFullscreen);
      const mode = makeMode(h.deps);

      mode.start();
      mode[teardown]();
      setFullscreenElement(h.container);
      request.resolve();
      await Promise.resolve();

      expect(mode.getState().active).toBe(false);
      expect(exitFullscreen).toHaveBeenCalledOnce();
    },
  );

  it('a restarted presentation adopts its pending fullscreen request', async () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const request = deferred();
    const requestFullscreen = vi.fn<() => Promise<void>>().mockReturnValue(request.promise);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(h.container, 'requestFullscreen', requestFullscreen);
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);

    mode.start();
    mode.exit();
    mode.start();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    request.resolve();
    await Promise.resolve();

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(mode.getState()).toMatchObject({ active: true, fullscreen: true });
    expect(exitFullscreen).not.toHaveBeenCalled();
    mode.exit();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('a windowed restart survives stale fullscreen entry before request settlement', async () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const request = deferred();
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(
      h.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockReturnValue(request.promise),
    );
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);

    mode.start();
    mode.exit();
    mode.start({ fullscreen: false });
    const fullscreenStates: boolean[] = [];
    mode.onChange(() => fullscreenStates.push(mode.getState().fullscreen));
    expect(mode.getState()).toMatchObject({ active: true, index: 0, fullscreen: false });

    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(mode.getState()).toMatchObject({ active: true, index: 0, fullscreen: true });
    expect(fullscreenStates).toEqual([true]);

    request.resolve();
    await Promise.resolve();
    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(mode.getState()).toMatchObject({ active: true, index: 0, fullscreen: false });
    expect(fullscreenStates).toEqual([true, false]);
  });

  it('a windowed restart survives cleanup that began before restart', async () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const request = deferred();
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(
      h.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockReturnValue(request.promise),
    );
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);

    mode.start();
    mode.exit();
    setFullscreenElement(h.container);
    request.resolve();
    await Promise.resolve();
    mode.start({ fullscreen: false });
    expect(mode.getState()).toMatchObject({ active: true, index: 0, fullscreen: true });

    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(mode.getState()).toMatchObject({ active: true, index: 0, fullscreen: false });
  });

  it('leaving owned fullscreen exits the presentation', () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const requestFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(h.container, 'requestFullscreen', requestFullscreen);
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);
    mode.start();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mode.getState().active).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('keeps a synchronous windowed restart active after its owned fullscreen exits', async () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const exit = deferred();
    stubValue(
      h.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    );
    stubValue(
      document,
      'exitFullscreen',
      vi.fn<() => Promise<void>>().mockReturnValue(exit.promise),
    );
    const mode = makeMode(h.deps);

    mode.start();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    await Promise.resolve();
    mode.exit();
    mode.start({ fullscreen: false });
    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));
    exit.resolve();
    await Promise.resolve();

    expect(mode.getState()).toMatchObject({ active: true, fullscreen: false });
  });

  it('keeps presenting while a descendant is fullscreen and exits it on exit', () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const child = document.createElement('video');
    h.container.append(child);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(
      h.container,
      'requestFullscreen',
      vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    );
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const mode = makeMode(h.deps);

    mode.start();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    setFullscreenElement(child);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mode.getState()).toMatchObject({ active: true, fullscreen: true });
    mode.exit();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('destroy removes listeners without restoring or emitting', () => {
    const h = makeDeps();
    const setFullscreenElement = stubFullscreenElement();
    const requestFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stubValue(h.container, 'requestFullscreen', requestFullscreen);
    stubValue(document, 'exitFullscreen', exitFullscreen);
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const addDocumentListener = vi.spyOn(document, 'addEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const mode = makeMode(h.deps);
    mode.start({ animate: false });
    mode.next();
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));
    let changes = 0;
    mode.onChange(() => changes++);
    const camera = h.camera.position;
    const toolCalls = h.calls.tools.length;

    mode.destroy();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    h.wrapper.dispatchEvent(event);
    setFullscreenElement(h.container);
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(changes).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
    expect(h.camera.position).toEqual(camera);
    expect(h.calls.tools).toHaveLength(toolCalls);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    const keyListener = addWindowListener.mock.calls.find((call) => call[0] === 'keydown')?.[1];
    const fullscreenListener = addDocumentListener.mock.calls.find(
      (call) => call[0] === 'fullscreenchange',
    )?.[1];
    expect(removeWindowListener).toHaveBeenCalledWith('keydown', keyListener, true);
    expect(removeDocumentListener).toHaveBeenCalledWith('fullscreenchange', fullscreenListener);
  });
});
