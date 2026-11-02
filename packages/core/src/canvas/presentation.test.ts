// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import type { PresentationModeDeps } from './presentation';
import { createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createFrame } from '../elements/frame-element';
import { PresentationMode, framePresentationSlides } from './presentation';

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
  it('start returns false with no slides and leaves the camera alone', () => {
    const h = makeDeps({ defaultSlides: () => [] });
    const mode = new PresentationMode(h.deps);

    expect(mode.start()).toBe(false);
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
  });

  it('start jumps to the first slide, clears the selection and switches to hand', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);

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
    const mode = new PresentationMode(h.deps);

    mode.start({ fullscreen: false });

    expect(h.calls.tools).toEqual([]);
  });

  it('next and previous stop at the ends and animate', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
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
    const mode = new PresentationMode(h.deps);
    mode.start({ fullscreen: false, animate: false });
    mode.next();
    expect(h.camera.position.x).toBe(-2000);

    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const reduced = makeDeps();
    const reducedMode = new PresentationMode(reduced.deps);
    reducedMode.start({ fullscreen: false });
    reducedMode.next();
    expect(reduced.camera.position.x).toBe(-2000);
  });

  it('goTo rejects out-of-range and non-integer indices', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
    mode.start({ fullscreen: false });

    expect(mode.goTo(2)).toBe(false);
    expect(mode.goTo(-1)).toBe(false);
    expect(mode.goTo(0.5)).toBe(false);
    expect(mode.getState().index).toBe(0);
  });

  it('goTo of the current index re-applies the view without a state change', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
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
    const mode = new PresentationMode(h.deps);

    mode.start({ fullscreen: false, index });

    expect(mode.getState().index).toBe(0);
  });

  it('start copies the slides option', () => {
    const slides = [
      { view: { x: 0, y: 0, w: 400, h: 300 } },
      { view: { x: 1000, y: 0, w: 400, h: 300 } },
    ];
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
    mode.start({ fullscreen: false, slides });
    slides.pop();

    expect(mode.getSlides()).toHaveLength(2);
  });

  it('start throws on an invalid view before changing anything', () => {
    const h = makeDeps({ defaultSlides: () => [{ view: { x: 0, y: 0, w: 0, h: 300 } }] });
    const mode = new PresentationMode(h.deps);

    expect(() => mode.start({ fullscreen: false })).toThrow();
    expect(mode.getState().active).toBe(false);
    expect(h.calls.clearSelection).toBe(0);
    expect(h.calls.tools).toEqual([]);
  });

  it('resize refits the current slide with a jump', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
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
    const mode = new PresentationMode(h.deps);
    mode.start({ fullscreen: false });

    mode.exit();

    expect(h.camera.position).toEqual({ x: 10, y: 20 });
    expect(h.camera.zoom).toBe(1.5);
    expect(h.calls.tools).toEqual(['hand', 'select']);
    expect(h.calls.disposeResize).toBe(1);
    expect(mode.getState()).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
    expect(mode.getSlides()).toEqual([]);
  });

  it('exit stays clean when setTool returns false', () => {
    const tools: string[] = [];
    const h = makeDeps({
      setTool: (name) => {
        tools.push(name);
        return false;
      },
    });
    const mode = new PresentationMode(h.deps);
    mode.start({ fullscreen: false });
    expect(tools).toEqual(['hand']);

    expect(() => mode.exit()).not.toThrow();
    expect(h.camera.position).toEqual({ x: 0, y: 0 });
    expect(mode.getState().active).toBe(false);
    expect(tools).toEqual(['hand']);
  });

  it('getState keeps its reference until a change', () => {
    const h = makeDeps();
    const mode = new PresentationMode(h.deps);
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
    const mode = new PresentationMode(h.deps);
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
