// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from './viewport';
import { MinimapController } from './minimap-controller';
import type { MinimapControllerOptions } from './minimap-controller';
import { computeMinimapTransform, miniToWorld, worldToMini } from './minimap-transform';
import { ElementRenderer } from '../elements/element-renderer';
import { createNote, createStroke, createText } from '../elements/element-factory';
import type { CanvasElement } from '../elements/types';

// ---------------------------------------------------------------------------
// Recorder: a shared fake CanvasRenderingContext2D returned for every canvas
// in the page (HTMLCanvasElement.prototype.getContext is mocked globally).
// Method calls are tracked via vi.fn(); drawImage/fillRect additionally push
// into custom logs capturing the mutable state (globalAlpha / fillStyle) at
// the moment of the call, since our recorder does not implement real
// save/restore state-stack semantics.
// ---------------------------------------------------------------------------

interface DrawImageEntry {
  args: unknown[];
  alpha: number;
}

interface FillRectEntry {
  args: [number, number, number, number];
  fillStyle: string;
}

interface Recorder {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  drawImageLog: DrawImageEntry[];
  fillRectLog: FillRectEntry[];
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  quadraticCurveTo: ReturnType<typeof vi.fn>;
  bezierCurveTo: ReturnType<typeof vi.fn>;
  ellipse: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  createPattern: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  drawFocusIfNeeded: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
  roundRect: ReturnType<typeof vi.fn>;
}

function makeRecorder(): Recorder {
  const drawImageLog: DrawImageEntry[] = [];
  const fillRectLog: FillRectEntry[] = [];
  const recorder: Recorder = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    drawImageLog,
    fillRectLog,
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fillRectLog.push({ args: [x, y, w, h], fillStyle: recorder.fillStyle });
    }),
    strokeRect: vi.fn(),
    drawImage: vi.fn((...args: unknown[]) => {
      drawImageLog.push({ args, alpha: recorder.globalAlpha });
    }),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    createPattern: vi.fn(() => null),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
    drawFocusIfNeeded: vi.fn(),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
  };
  return recorder;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let createElementSpy: ReturnType<typeof vi.spyOn>;
let rendererSpy: ReturnType<typeof vi.spyOn>;
let recorder: Recorder;

beforeEach(() => {
  // Only fake the timers MinimapController's debounce uses. Leaving
  // requestAnimationFrame real keeps the Viewport's own RAF-driven render
  // loop (which real store/camera mutations mark dirty) from ever executing
  // synchronously inside a test — it would otherwise need this recorder to
  // also cover Background/LayerCache/grid-cache canvas plumbing unrelated to
  // MinimapController.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  recorder = makeRecorder();
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(recorder as unknown as CanvasRenderingContext2D);
  createElementSpy = vi.spyOn(document, 'createElement');
  rendererSpy = vi.spyOn(ElementRenderer.prototype, 'renderCanvasElement');
});

afterEach(() => {
  getContextSpy.mockRestore();
  createElementSpy.mockRestore();
  rendererSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

function canvasCreations(): number {
  return createElementSpy.mock.calls.filter((call) => call[0] === 'canvas').length;
}

function compositeCalls(): DrawImageEntry[] {
  // The scene->minimap composite is drawImage(scene, 0, 0, width, height) — 5 args.
  return recorder.drawImageLog.filter((e) => e.args.length === 5);
}

function layerCompositeCalls(): DrawImageEntry[] {
  // A translucent layer composites via drawImage(layerCanvas, 0, 0) — 3 args.
  return recorder.drawImageLog.filter((e) => e.args.length === 3);
}

function lastComposite(): DrawImageEntry {
  const entry = compositeCalls().at(-1);
  if (!entry) throw new Error('expected at least one composite drawImage call');
  return entry;
}

interface ViewportHarness {
  viewport: Viewport;
  container: HTMLDivElement;
  canvasEl: HTMLCanvasElement;
}

function makeViewportHarness(): ViewportHarness {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    configurable: true,
  });
  document.body.appendChild(container);

  const viewport = new Viewport(container, {});
  const canvasEl = container.querySelector('canvas');
  if (!canvasEl) throw new Error('viewport canvas not found');
  // Camera.getVisibleRect reads canvasEl.clientWidth/clientHeight, which jsdom
  // never lays out; pin them so the visible rect is meaningful.
  Object.defineProperty(canvasEl, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(canvasEl, 'clientHeight', { value: 600, configurable: true });

  return { viewport, container, canvasEl };
}

interface FrameQueue {
  frames: (() => void)[];
  requestFrame: (cb: () => void) => number;
  cancelFrame: ReturnType<typeof vi.fn>;
  flush: () => void;
}

function makeFrameQueue(): FrameQueue {
  const frames: (() => void)[] = [];
  return {
    frames,
    requestFrame: (cb: () => void): number => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: vi.fn(),
    flush: (): void => {
      const pending = frames.splice(0, frames.length);
      for (const cb of pending) cb();
    },
  };
}

function makeController(
  viewport: Viewport,
  canvas: HTMLCanvasElement,
  queue: FrameQueue,
  overrides: MinimapControllerOptions = {},
): MinimapController {
  return new MinimapController(viewport, canvas, {
    requestFrame: queue.requestFrame,
    cancelFrame: queue.cancelFrame,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MinimapController', () => {
  it('1. renders the scene synchronously at construction and composites only on the first flushed frame', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    createElementSpy.mockClear();
    const controller = makeController(viewport, canvas, queue);

    // Scene bitmap already rendered synchronously (one canvas allocated) —
    // but nothing has been composited to the visible minimap canvas yet.
    expect(canvasCreations()).toBe(1);
    expect(recorder.drawImage).not.toHaveBeenCalled();
    expect(recorder.strokeRect).not.toHaveBeenCalled();

    queue.flush();

    expect(compositeCalls().length).toBe(1);
    expect(recorder.strokeRect).toHaveBeenCalledTimes(1);

    controller.dispose();
    viewport.destroy();
  });

  it('2. coalesces three requestDraw() calls into a single enqueued frame', () => {
    const { viewport } = makeViewportHarness();
    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);

    // Constructor already enqueued its own initial frame; drain it first.
    expect(queue.frames.length).toBe(1);
    queue.flush();
    expect(queue.frames.length).toBe(0);

    controller.requestDraw();
    controller.requestDraw();
    controller.requestDraw();
    expect(queue.frames.length).toBe(1);

    controller.dispose();
    viewport.destroy();
  });

  it('3. debounces scene re-render on store.add: not before 199ms, rendered at 200ms', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    queue.flush();
    const baselineScene = lastComposite().args[0];

    createElementSpy.mockClear();
    viewport.store.add(createNote({ position: { x: 10, y: 10 }, size: { w: 20, h: 20 }, layerId }));

    // No synchronous re-render on add.
    expect(canvasCreations()).toBe(0);

    vi.advanceTimersByTime(199);
    expect(canvasCreations()).toBe(0);
    queue.flush(); // nothing pending; must be a no-op

    vi.advanceTimersByTime(1); // crosses the 200ms debounce boundary
    expect(canvasCreations()).toBe(1);
    expect(queue.frames.length).toBe(1);
    queue.flush();

    const newScene = lastComposite().args[0];
    expect(newScene).not.toBe(baselineScene);

    controller.dispose();
    viewport.destroy();
  });

  it('4. camera pan that keeps the viewport inside content bounds re-composites without re-rendering the scene', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    queue.flush();
    const baselineScene = lastComposite().args[0];

    createElementSpy.mockClear();
    // Small pan: visible rect moves from {0,0,800,600} to {100,100,800,600},
    // still fully inside the 2000x2000 content — union mapping is unchanged.
    viewport.camera.pan(-100, -100);

    expect(queue.frames.length).toBe(1); // requestDraw fired for the new rect position
    queue.flush();

    expect(recorder.strokeRect.mock.calls.length).toBe(2); // re-composited
    expect(canvasCreations()).toBe(0); // no scene re-render
    expect(lastComposite().args[0]).toBe(baselineScene);

    // No debounce timer was ever started by the pan.
    vi.advanceTimersByTime(1000);
    expect(canvasCreations()).toBe(0);

    controller.dispose();
    viewport.destroy();
  });

  it('5. camera pan that grows the union mapping schedules a debounced re-render while compositing the old bitmap atomically', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    queue.flush();
    const baselineScene = lastComposite().args[0];
    const baselineTransform = computeMinimapTransform(
      { x: 0, y: 0, w: 2000, h: 2000 },
      200,
      140,
      8,
    );

    createElementSpy.mockClear();
    // Large pan: visible rect moves entirely outside the 2000x2000 content,
    // growing the union mapping.
    viewport.camera.pan(-5000, -5000);

    expect(queue.frames.length).toBe(1);
    queue.flush();

    // Composite happened, but still against the OLD bitmap/transform.
    expect(canvasCreations()).toBe(0);
    expect(lastComposite().args[0]).toBe(baselineScene);

    const rectAfterPan = viewport.getVisibleRect();
    const expectedTl = worldToMini(baselineTransform, { x: rectAfterPan.x, y: rectAfterPan.y });
    const strokeArgs = recorder.strokeRect.mock.calls.at(-1);
    if (!strokeArgs) throw new Error('expected a strokeRect call');
    expect(strokeArgs[0]).toBeCloseTo(expectedTl.x, 5);
    expect(strokeArgs[1]).toBeCloseTo(expectedTl.y, 5);
    expect(strokeArgs[2]).toBeCloseTo(rectAfterPan.w * baselineTransform.scale, 5);
    expect(strokeArgs[3]).toBeCloseTo(rectAfterPan.h * baselineTransform.scale, 5);

    // Now the debounced re-render fires.
    vi.advanceTimersByTime(200);
    expect(canvasCreations()).toBe(1);
    expect(queue.frames.length).toBe(1);
    queue.flush();
    expect(lastComposite().args[0]).not.toBe(baselineScene);

    controller.dispose();
    viewport.destroy();
  });

  it('6. viewport.onResize-driven mapping growth behaves like the camera-pan case', () => {
    const { viewport, canvasEl } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    queue.flush();
    const baselineScene = lastComposite().args[0];

    createElementSpy.mockClear();
    // Grow the canvas's client size so the visible rect now exceeds content bounds.
    Object.defineProperty(canvasEl, 'clientWidth', { value: 6000, configurable: true });
    Object.defineProperty(canvasEl, 'clientHeight', { value: 6000, configurable: true });
    (viewport as unknown as { syncCanvasSize: () => void }).syncCanvasSize();

    expect(queue.frames.length).toBe(1);
    queue.flush();
    expect(canvasCreations()).toBe(0);
    expect(lastComposite().args[0]).toBe(baselineScene);

    vi.advanceTimersByTime(200);
    expect(canvasCreations()).toBe(1);
    queue.flush();
    expect(lastComposite().args[0]).not.toBe(baselineScene);

    controller.dispose();
    viewport.destroy();
  });

  it('7. a translucent layer composites once at its opacity; an opaque layer never allocates a temp canvas', () => {
    // Opacity 0.5: two overlapping strokes on one layer must composite ONCE.
    {
      const { viewport } = makeViewportHarness();
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createStroke({
          points: [
            { x: 0, y: 0, pressure: 1 },
            { x: 50, y: 50, pressure: 1 },
          ],
          layerId,
          color: '#111111',
        }),
      );
      viewport.store.add(
        createStroke({
          points: [
            { x: 0, y: 0, pressure: 1 },
            { x: 50, y: 50, pressure: 1 },
          ],
          layerId,
          color: '#222222',
        }),
      );
      viewport.layerManager.setLayerOpacity(layerId, 0.5);

      const canvas = document.createElement('canvas');
      createElementSpy.mockClear();
      const queue = makeFrameQueue();
      const controller = makeController(viewport, canvas, queue);

      expect(canvasCreations()).toBe(2); // scene canvas + one layer temp canvas
      const layerComposites = layerCompositeCalls();
      expect(layerComposites.length).toBe(1);
      expect(layerComposites[0]?.alpha).toBe(0.5);

      controller.dispose();
      viewport.destroy();
    }

    recorder.drawImageLog.length = 0;

    // Opacity 1 (default): no temp canvas allocated, no layer-composite drawImage.
    {
      const { viewport } = makeViewportHarness();
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createStroke({
          points: [
            { x: 0, y: 0, pressure: 1 },
            { x: 50, y: 50, pressure: 1 },
          ],
          layerId,
        }),
      );

      const canvas = document.createElement('canvas');
      createElementSpy.mockClear();
      const queue = makeFrameQueue();
      const controller = makeController(viewport, canvas, queue);

      expect(canvasCreations()).toBe(1); // scene canvas only
      expect(layerCompositeCalls().length).toBe(0);

      controller.dispose();
      viewport.destroy();
    }
  });

  it('8. DOM-backed elements fall back to fillRect: explicit color when present, neutral gray otherwise', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;

    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, layerId });
    const coloredNote = { ...note, color: '#ff0000' } as unknown as CanvasElement;
    viewport.store.add(coloredNote);

    const text = createText({
      position: { x: 200, y: 200 },
      size: { w: 50, h: 20 },
      layerId,
      text: 'hi',
    });
    const textWithoutColor = { ...text } as Record<string, unknown>;
    delete textWithoutColor['color'];
    viewport.store.add(textWithoutColor as unknown as CanvasElement);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);

    // Stable-sort tie on zIndex=0 preserves insertion order: note, then text.
    expect(recorder.fillRectLog.length).toBe(2);
    expect(recorder.fillRectLog[0]?.fillStyle).toBe('#ff0000');
    expect(recorder.fillRectLog[1]?.fillStyle).toBe('rgba(100,116,139,0.6)');

    controller.dispose();
    viewport.destroy();
  });

  it('9. grid elements never reach the renderer and never affect the mapping', () => {
    const strokeArgsA = (() => {
      const { viewport } = makeViewportHarness();
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createNote({ position: { x: 0, y: 0 }, size: { w: 500, h: 500 }, layerId }),
      );
      const canvas = document.createElement('canvas');
      const queue = makeFrameQueue();
      const controller = makeController(viewport, canvas, queue);
      queue.flush();
      const args = recorder.strokeRect.mock.calls.at(-1);
      controller.dispose();
      viewport.destroy();
      return args;
    })();

    recorder.strokeRect.mockClear();
    rendererSpy.mockClear();

    const { viewport: vpB } = makeViewportHarness();
    const layerIdB = vpB.layerManager.activeLayerId;
    vpB.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 500, h: 500 }, layerId: layerIdB }),
    );
    vpB.addGrid({ gridType: 'square', cellSize: 40 });

    const canvasB = document.createElement('canvas');
    const queueB = makeFrameQueue();
    const controllerB = makeController(vpB, canvasB, queueB);
    queueB.flush();
    const strokeArgsB = recorder.strokeRect.mock.calls.at(-1);

    expect(strokeArgsB).toEqual(strokeArgsA);

    for (const call of rendererSpy.mock.calls) {
      const el = call[1] as CanvasElement;
      expect(el.type).not.toBe('grid');
    }

    controllerB.dispose();
    vpB.destroy();
  });

  it('10. hidden-layer elements are excluded from both rendering and the mapping', () => {
    const { viewport } = makeViewportHarness();
    const visibleLayerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 300, h: 300 }, layerId: visibleLayerId }),
    );

    const baselineCanvas = document.createElement('canvas');
    const baselineQueue = makeFrameQueue();
    const baselineController = makeController(viewport, baselineCanvas, baselineQueue);
    baselineQueue.flush();
    const baselineStroke = recorder.strokeRect.mock.calls.at(-1);
    expect(recorder.fillRectLog.length).toBe(1);
    baselineController.dispose();

    recorder.strokeRect.mockClear();
    recorder.fillRectLog.length = 0;

    const hiddenLayer = viewport.layerManager.createLayer('Hidden');
    viewport.store.add(
      createNote({
        position: { x: 5000, y: 5000 },
        size: { w: 300, h: 300 },
        layerId: hiddenLayer.id,
      }),
    );
    viewport.layerManager.setLayerVisible(hiddenLayer.id, false);

    const canvas2 = document.createElement('canvas');
    const queue2 = makeFrameQueue();
    const controller2 = makeController(viewport, canvas2, queue2);
    queue2.flush();

    // Mapping unaffected: the far-away hidden element would have drastically
    // grown the mapping if it were included.
    expect(recorder.strokeRect.mock.calls.at(-1)).toEqual(baselineStroke);
    // Rendering unaffected: still exactly one DOM-fallback fillRect (the visible note).
    expect(recorder.fillRectLog.length).toBe(1);

    controller2.dispose();
    viewport.destroy();
  });
});

describe('MinimapController navigation, resize, dispose, image reload', () => {
  // Navigation tests (11, 12, 12b, 13, 14) deliberately do NOT use
  // makeViewportHarness: that helper pins the viewport's own canvasEl
  // clientWidth/clientHeight to 800x600, which centerCameraAt reads directly
  // (`clientWidth/2 - world.x*z`). A bare Viewport leaves those dims at
  // jsdom's default 0, matching viewport.test.ts's own centerCameraAt
  // coverage and collapsing the formula to `-world.x*z`.
  function makeBareViewportHarness(): { viewport: Viewport } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewport = new Viewport(container, {});
    return { viewport };
  }

  function addBaselineContent(viewport: Viewport): void {
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );
  }

  it('11. tap navigation centers the camera on the minimap-mapped world point', () => {
    const { viewport } = makeBareViewportHarness();
    addBaselineContent(viewport);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);

    const transform = computeMinimapTransform({ x: 0, y: 0, w: 2000, h: 2000 }, 200, 140, 8);
    const point = { x: 60, y: 40 };
    const world = miniToWorld(transform, point);
    const z = viewport.camera.zoom;

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: point.x,
        clientY: point.y,
        pointerId: 1,
        bubbles: true,
      }),
    );

    // centerCameraAt: moveTo(clientWidth/2 - world.x*z, clientHeight/2 - world.y*z);
    // canvasEl dims are 0 here, so this reduces to -world.x*z / -world.y*z.
    expect(viewport.camera.position.x).toBeCloseTo(-world.x * z, 5);
    expect(viewport.camera.position.y).toBeCloseTo(-world.y * z, 5);

    controller.dispose();
    viewport.destroy();
  });

  it('12. drag navigation: pointermove while dragging navigates again; pointerup ends the drag', () => {
    const { viewport } = makeBareViewportHarness();
    addBaselineContent(viewport);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    const centerSpy = vi.spyOn(viewport, 'centerCameraAt');

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 60, clientY: 40, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 90, clientY: 70, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(2);

    canvas.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 90, clientY: 70, pointerId: 1, bubbles: true }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 100, pointerId: 1, bubbles: true }),
    );
    // A further move after pointerup must NOT navigate again.
    expect(centerSpy).toHaveBeenCalledTimes(2);

    controller.dispose();
    viewport.destroy();
  });

  it('12b. drag cancellation via pointercancel or lostpointercapture stops navigation without a pointerup', () => {
    const { viewport } = makeBareViewportHarness();
    addBaselineContent(viewport);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    const centerSpy = vi.spyOn(viewport, 'centerCameraAt');

    // pointercancel: an interrupted touch ends the drag without a pointerup.
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 60, clientY: 40, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 100, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(1);

    // lostpointercapture: a browser gesture takeover ends the drag without a pointerup.
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 60, clientY: 40, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(2);
    canvas.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 100, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).toHaveBeenCalledTimes(2);

    controller.dispose();
    viewport.destroy();
  });

  it('13. pointerdown stops propagation and prevents default', () => {
    const { viewport } = makeBareViewportHarness();
    addBaselineContent(viewport);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);

    const ev = new PointerEvent('pointerdown', {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    });
    const stopSpy = vi.spyOn(ev, 'stopPropagation');
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    canvas.dispatchEvent(ev);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(preventSpy).toHaveBeenCalledTimes(1);

    controller.dispose();
    viewport.destroy();
  });

  it('14. interactive: false disables pointer navigation and never sets touchAction to none', () => {
    const { viewport } = makeBareViewportHarness();
    addBaselineContent(viewport);

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue, { interactive: false });
    const centerSpy = vi.spyOn(viewport, 'centerCameraAt');

    expect(canvas.style.touchAction).not.toBe('none');

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 60, clientY: 40, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).not.toHaveBeenCalled();

    controller.dispose();
    viewport.destroy();
  });

  it('15. setSize resizes the canvas backing store by devicePixelRatio and synchronously re-renders the scene', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    try {
      const { viewport } = makeViewportHarness();
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
      );

      const canvas = document.createElement('canvas');
      const queue = makeFrameQueue();
      const controller = makeController(viewport, canvas, queue);
      queue.flush();
      const baselineScene = lastComposite().args[0];

      createElementSpy.mockClear();
      controller.setSize(100, 70);

      expect(canvas.width).toBe(200); // 100 * dpr(2)
      expect(canvas.height).toBe(140); // 70 * dpr(2)
      expect(canvasCreations()).toBe(1); // synchronous re-render: new scene canvas identity
      expect(queue.frames.length).toBe(1); // draw scheduled

      queue.flush();
      expect(lastComposite().args[0]).not.toBe(baselineScene);

      controller.dispose();
      viewport.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('16. a late image load schedules a debounced scene re-render', () => {
    const setOnImageLoadSpy = vi.spyOn(ElementRenderer.prototype, 'setOnImageLoad');
    try {
      const { viewport } = makeViewportHarness();
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
      );

      const canvas = document.createElement('canvas');
      const queue = makeFrameQueue();
      const controller = makeController(viewport, canvas, queue);
      queue.flush();
      const baselineScene = lastComposite().args[0];

      // Viewport's own constructor also builds an ElementRenderer and calls
      // setOnImageLoad on it, so the MinimapController's registration is not
      // necessarily calls[0] — it is whichever call happened most recently,
      // since the controller is constructed after the viewport.
      const onImageLoad = setOnImageLoadSpy.mock.calls.at(-1)?.[0];
      if (!onImageLoad) throw new Error('expected setOnImageLoad to have been called');

      createElementSpy.mockClear();
      onImageLoad();

      // Debounced: no synchronous re-render.
      expect(canvasCreations()).toBe(0);

      vi.advanceTimersByTime(200);
      expect(canvasCreations()).toBe(1);
      expect(queue.frames.length).toBe(1);
      queue.flush();
      expect(lastComposite().args[0]).not.toBe(baselineScene);

      controller.dispose();
      viewport.destroy();
    } finally {
      setOnImageLoadSpy.mockRestore();
    }
  });

  it('17. dispose cancels the pending frame, clears a pending debounce, removes pointer handlers, and is idempotent', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
    );

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);

    // Constructor's initial frame is still pending (never flushed).
    expect(queue.frames.length).toBe(1);

    // Give dispose a pending debounce to clear.
    viewport.store.add(createNote({ position: { x: 10, y: 10 }, size: { w: 20, h: 20 }, layerId }));

    controller.dispose();

    expect(queue.cancelFrame).toHaveBeenCalledTimes(1);

    createElementSpy.mockClear();
    vi.advanceTimersByTime(1000);
    // If the debounce had merely been orphaned instead of cleared, this would render.
    expect(canvasCreations()).toBe(0);

    const centerSpy = vi.spyOn(viewport, 'centerCameraAt');
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }),
    );
    expect(centerSpy).not.toHaveBeenCalled();

    expect(() => controller.dispose()).not.toThrow();

    viewport.destroy();
  });

  it('18. no listener leak: after dispose, store and camera events schedule no further frames', () => {
    const { viewport } = makeViewportHarness();
    const layerId = viewport.layerManager.activeLayerId;

    const canvas = document.createElement('canvas');
    const queue = makeFrameQueue();
    const controller = makeController(viewport, canvas, queue);
    queue.flush();
    expect(queue.frames.length).toBe(0);

    controller.dispose();

    viewport.store.add(createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId }));
    expect(queue.frames.length).toBe(0);

    viewport.camera.pan(10, 10);
    expect(queue.frames.length).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(queue.frames.length).toBe(0);

    viewport.destroy();
  });
});
