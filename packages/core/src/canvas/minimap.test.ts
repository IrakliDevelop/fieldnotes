// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from './viewport';
import { computeMinimapTransform, miniToWorld } from './minimap-transform';
import { createNote } from '../elements/element-factory';

// ---------------------------------------------------------------------------
// Minimal recorder so canvas draw calls made by the (real) MinimapController
// during construction/dispose never throw in jsdom, which has no real 2D
// canvas backend. Reused convention from minimap-controller.test.ts; these
// wrapper-scoped tests do not assert on drawing output.
// ---------------------------------------------------------------------------

interface Recorder {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function makeRecorder(): Recorder {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(makeRecorder() as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  getContextSpy.mockRestore();
});

function minimapCanvas(wrapper: HTMLElement): HTMLCanvasElement | undefined {
  return Array.from(wrapper.querySelectorAll('canvas')).find(
    (c) => c.style.position === 'absolute' && c.style.bottom !== '',
  );
}

function wrapperOf(container: HTMLElement): HTMLDivElement {
  const w = container.firstElementChild;
  if (!(w instanceof HTMLDivElement)) throw new Error('viewport wrapper not found');
  return w;
}

describe('Minimap (built-in wrapper)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('1. new Viewport(container, { minimap: true }) appends a positioned canvas to the wrapper', () => {
    const viewport = new Viewport(container, { minimap: true });
    const wrapper = wrapperOf(container);
    const canvas = minimapCanvas(wrapper);

    expect(canvas).toBeDefined();
    expect(canvas?.style.position).toBe('absolute');
    expect(canvas?.style.right).toBe('16px');
    expect(canvas?.style.bottom).toBe('16px');
    expect(canvas?.style.zIndex).toBe('10');

    viewport.destroy();
  });

  it('2. no minimap canvas is created without the option', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);

    expect(minimapCanvas(wrapper)).toBeUndefined();

    viewport.destroy();
  });

  it('3. viewport.destroy() removes the minimap canvas and cancels its queued frame', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const viewport = new Viewport(container, { minimap: true });
    const wrapper = wrapperOf(container);
    const canvas = minimapCanvas(wrapper);
    expect(canvas).toBeDefined();

    expect(() => viewport.destroy()).not.toThrow();

    expect(canvas ? document.contains(canvas) : true).toBe(false);
    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
  });

  it('4. pointerdown on the minimap canvas moves the camera (navigation wired end-to-end)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const viewport = new Viewport(container, { minimap: true });
      const layerId = viewport.layerManager.activeLayerId;
      viewport.store.add(
        createNote({ position: { x: 0, y: 0 }, size: { w: 2000, h: 2000 }, layerId }),
      );
      // Cross the controller's debounce boundary so its cached scene/transform
      // (rendered synchronously at construction, before the note existed)
      // picks up the note's bounds before navigation is exercised.
      vi.advanceTimersByTime(200);

      const wrapper = wrapperOf(container);
      const canvas = minimapCanvas(wrapper);
      if (!canvas) throw new Error('minimap canvas not found');

      // Bare jsdom viewport canvas has clientWidth/clientHeight 0, matching
      // minimap-controller.test.ts's centerCameraAt formula collapse:
      // moveTo(clientWidth/2 - world.x*z, clientHeight/2 - world.y*z) -> -world.x*z / -world.y*z.
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

      expect(viewport.camera.position.x).toBeCloseTo(-world.x * z, 5);
      expect(viewport.camera.position.y).toBeCloseTo(-world.y * z, 5);

      viewport.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
