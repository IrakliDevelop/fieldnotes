// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounds, Point } from '../core/types';
import type { CanvasElement } from '../elements/types';
import { Minimap, type MinimapDeps } from './minimap';

interface Recorder {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function makeRecorder(): Recorder {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
}

function sizeElement(bounds: Bounds, extra: Record<string, unknown> = {}): CanvasElement {
  return {
    type: 'note',
    position: { x: bounds.x, y: bounds.y },
    size: { w: bounds.w, h: bounds.h },
    ...extra,
  } as unknown as CanvasElement;
}

interface Harness {
  minimap: Minimap;
  recorder: Recorder;
  container: HTMLElement;
  frames: (() => void)[];
  flush: () => void;
  cancelFrame: ReturnType<typeof vi.fn>;
  getElements: ReturnType<typeof vi.fn>;
  getContentBounds: ReturnType<typeof vi.fn>;
  getViewportRect: ReturnType<typeof vi.fn>;
  navigateTo: ReturnType<typeof vi.fn>;
  canvas: HTMLCanvasElement;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let rectSpy: ReturnType<typeof vi.spyOn>;
let recorder: Recorder;

beforeEach(() => {
  recorder = makeRecorder();
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(recorder as unknown as CanvasRenderingContext2D);
  rectSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 140,
    width: 200,
    height: 140,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  getContextSpy.mockRestore();
  rectSpy.mockRestore();
});

function makeHarness(opts: {
  elements?: CanvasElement[];
  content?: Bounds | null;
  viewport?: Bounds;
}): Harness {
  const frames: (() => void)[] = [];
  const container = document.createElement('div');
  const cancelFrame = vi.fn();
  const getElements = vi.fn(() => opts.elements ?? []);
  const getContentBounds = vi.fn(() => opts.content ?? null);
  const getViewportRect = vi.fn(() => opts.viewport ?? { x: 0, y: 0, w: 50, h: 50 });
  const navigateTo = vi.fn();

  const deps: MinimapDeps = {
    container,
    getElements,
    getContentBounds,
    getViewportRect,
    navigateTo,
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame,
  };

  const minimap = new Minimap(deps);
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas not created');

  return {
    minimap,
    recorder,
    container,
    frames,
    flush: () => {
      const pending = frames.splice(0, frames.length);
      for (const cb of pending) cb();
    },
    cancelFrame,
    getElements,
    getContentBounds,
    getViewportRect,
    navigateTo,
    canvas,
  };
}

describe('Minimap', () => {
  it('draws element rect and viewport outline via union-mapping transform', () => {
    const h = makeHarness({
      elements: [sizeElement({ x: 0, y: 0, w: 100, h: 100 }, { color: '#f00' })],
      content: { x: 0, y: 0, w: 100, h: 100 },
      viewport: { x: 0, y: 0, w: 50, h: 50 },
    });

    h.minimap.scheduleDraw();
    h.flush();

    // mapping = union({0,0,100,100},{0,0,50,50}) = {0,0,100,100}
    // scale = 1.24, offset {38,8}
    expect(h.recorder.fillRect).toHaveBeenCalledTimes(1);
    const fillArgs = h.recorder.fillRect.mock.calls[0];
    expect(fillArgs[0]).toBeCloseTo(38, 5);
    expect(fillArgs[1]).toBeCloseTo(8, 5);
    expect(fillArgs[2]).toBeCloseTo(124, 5);
    expect(fillArgs[3]).toBeCloseTo(124, 5);

    expect(h.recorder.strokeRect).toHaveBeenCalledTimes(1);
    const strokeArgs = h.recorder.strokeRect.mock.calls[0];
    expect(strokeArgs[0]).toBeCloseTo(38, 5);
    expect(strokeArgs[1]).toBeCloseTo(8, 5);
    expect(strokeArgs[2]).toBeCloseTo(62, 5);
    expect(strokeArgs[3]).toBeCloseTo(62, 5);
  });

  it('skips element fillRect when content is empty but still draws viewport outline', () => {
    const h = makeHarness({
      elements: [],
      content: null,
      viewport: { x: 0, y: 0, w: 50, h: 50 },
    });

    h.minimap.scheduleDraw();
    h.flush();

    expect(h.recorder.fillRect).not.toHaveBeenCalled();
    expect(h.recorder.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple scheduleDraw calls into a single frame', () => {
    const h = makeHarness({ content: null });

    h.minimap.scheduleDraw();
    h.minimap.scheduleDraw();
    h.minimap.scheduleDraw();
    expect(h.frames.length).toBe(1);

    h.flush();
    expect(h.recorder.clearRect).toHaveBeenCalledTimes(1);
  });

  it('navigates to mapping center on pointerdown', () => {
    const h = makeHarness({
      content: { x: 0, y: 0, w: 100, h: 100 },
      viewport: { x: 0, y: 0, w: 50, h: 50 },
    });

    const ev = new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 70,
      pointerId: 1,
      bubbles: true,
    });
    h.canvas.dispatchEvent(ev);

    expect(h.navigateTo).toHaveBeenCalledTimes(1);
    const world = h.navigateTo.mock.calls[0][0] as Point;
    expect(world.x).toBeCloseTo(50, 5);
    expect(world.y).toBeCloseTo(50, 5);
  });

  it('navigates during drag and stops after pointerup', () => {
    const h = makeHarness({
      content: { x: 0, y: 0, w: 100, h: 100 },
      viewport: { x: 0, y: 0, w: 50, h: 50 },
    });

    h.canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 70, pointerId: 1, bubbles: true }),
    );
    expect(h.navigateTo).toHaveBeenCalledTimes(1);

    h.canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 38, clientY: 8, pointerId: 1, bubbles: true }),
    );
    expect(h.navigateTo).toHaveBeenCalledTimes(2);
    const dragWorld = h.navigateTo.mock.calls[1][0] as Point;
    expect(dragWorld.x).toBeCloseTo(0, 5);
    expect(dragWorld.y).toBeCloseTo(0, 5);

    h.canvas.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 38, clientY: 8, pointerId: 1, bubbles: true }),
    );
    h.canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 100, clientY: 70, pointerId: 1, bubbles: true }),
    );
    expect(h.navigateTo).toHaveBeenCalledTimes(2);
  });

  it('stops propagation on pointerdown', () => {
    const h = makeHarness({ content: null });
    const ev = new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 70,
      pointerId: 1,
      bubbles: true,
    });
    const stop = vi.spyOn(ev, 'stopPropagation');
    h.canvas.dispatchEvent(ev);
    expect(stop).toHaveBeenCalled();
  });

  it('destroy removes canvas, cancels pending frame, and is safe to schedule after', () => {
    const h = makeHarness({ content: null });

    h.minimap.scheduleDraw();
    expect(h.frames.length).toBe(1);

    h.minimap.destroy();

    expect(h.container.contains(h.canvas)).toBe(false);
    expect(h.cancelFrame).toHaveBeenCalledTimes(1);
    expect(() => h.minimap.scheduleDraw()).not.toThrow();
  });
});
