import { describe, it, expect } from 'vitest';
import { Camera } from './camera';
import {
  applyCameraView,
  cameraOriginForView,
  canvasDimsUsable,
  captureCameraView,
  fitZoomForView,
  type CameraView,
} from './camera-view';

const VIEW: CameraView = { x: 100, y: 50, w: 400, h: 300 };

describe('fitZoomForView', () => {
  it('contains the whole rect on a wider canvas (height binds)', () => {
    expect(fitZoomForView(VIEW, 1600, 300)).toBeCloseTo(1, 6); // min(4, 1)
  });

  it('contains the whole rect on a taller canvas (width binds)', () => {
    expect(fitZoomForView(VIEW, 400, 1200)).toBeCloseTo(1, 6); // min(1, 4)
  });

  it('never crops: the fitted rect fits within the canvas on both axes', () => {
    for (const [cw, ch] of [
      [800, 600],
      [1920, 1080],
      [820, 1180],
      [300, 300],
    ] as const) {
      const z = fitZoomForView(VIEW, cw, ch);
      expect(VIEW.w * z).toBeLessThanOrEqual(cw + 1e-9);
      expect(VIEW.h * z).toBeLessThanOrEqual(ch + 1e-9);
    }
  });
});

describe('cameraOriginForView', () => {
  it('centers the rect for a given zoom', () => {
    const origin = cameraOriginForView(VIEW, 2, 800, 600);
    // rect center world = (300, 200); screen center = (400, 300)
    expect(origin.x).toBeCloseTo(400 - 300 * 2, 6);
    expect(origin.y).toBeCloseTo(300 - 200 * 2, 6);
  });
});

describe('applyCameraView', () => {
  it('round-trips: applying a view then reading the visible rect returns it', () => {
    const camera = new Camera();
    applyCameraView(camera, VIEW, 800, 600);
    const back = camera.getVisibleRect(800, 600);
    // 800/400 = 2, 600/300 = 2 -> exact aspect match, exact round-trip
    expect(back.x).toBeCloseTo(VIEW.x, 6);
    expect(back.y).toBeCloseTo(VIEW.y, 6);
    expect(back.w).toBeCloseTo(VIEW.w, 6);
    expect(back.h).toBeCloseTo(VIEW.h, 6);
  });

  it('centers correctly when the fit zoom is clamped by the camera max', () => {
    const camera = new Camera({ maxZoom: 1.5 });
    applyCameraView(camera, VIEW, 800, 600); // wants zoom 2, clamped to 1.5
    expect(camera.zoom).toBeCloseTo(1.5, 6);
    const back = camera.getVisibleRect(800, 600);
    // Still centered on the rect center despite the clamp.
    expect(back.x + back.w / 2).toBeCloseTo(VIEW.x + VIEW.w / 2, 6);
    expect(back.y + back.h / 2).toBeCloseTo(VIEW.y + VIEW.h / 2, 6);
  });
});

describe('validation table', () => {
  const badViews: [string, CameraView][] = [
    ['zero width', { x: 0, y: 0, w: 0, h: 10 }],
    ['zero height', { x: 0, y: 0, w: 10, h: 0 }],
    ['negative width', { x: 0, y: 0, w: -10, h: 10 }],
    ['NaN x', { x: NaN, y: 0, w: 10, h: 10 }],
    ['Infinity h', { x: 0, y: 0, w: 10, h: Infinity }],
  ];

  for (const [label, view] of badViews) {
    it(`fitZoomForView throws on ${label}`, () => {
      expect(() => fitZoomForView(view, 800, 600)).toThrow();
    });
    it(`applyCameraView throws on ${label}`, () => {
      expect(() => applyCameraView(new Camera(), view, 800, 600)).toThrow();
    });
  }

  it('fitZoomForView throws on a zero canvas dimension', () => {
    expect(() => fitZoomForView(VIEW, 0, 600)).toThrow();
    expect(() => fitZoomForView(VIEW, 800, 0)).toThrow();
  });

  it('applyCameraView NO-OPS on a zero canvas dimension without writing', () => {
    const camera = new Camera();
    camera.moveTo(11, 22);
    camera.setZoom(1.25);
    applyCameraView(camera, VIEW, 0, 600);
    applyCameraView(camera, VIEW, 800, 0);
    expect(camera.position).toEqual({ x: 11, y: 22 });
    expect(camera.zoom).toBeCloseTo(1.25, 6);
  });

  for (const [label, cw, ch] of [
    ['negative width', -800, 600],
    ['negative height', 800, -600],
    ['NaN width', NaN, 600],
    ['Infinity height', 800, Infinity],
  ] as const) {
    it(`both functions throw on ${label} canvas dimensions`, () => {
      expect(() => fitZoomForView(VIEW, cw, ch)).toThrow();
      expect(() => applyCameraView(new Camera(), VIEW, cw, ch)).toThrow();
    });
  }

  it('leaves the camera finite and usable after a rejected call', () => {
    const camera = new Camera();
    camera.moveTo(5, 5);
    expect(() => applyCameraView(camera, VIEW, NaN, 600)).toThrow();
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(Number.isFinite(camera.position.x)).toBe(true);
    // still usable
    const rect = camera.getVisibleRect(800, 600);
    expect(Number.isFinite(rect.w)).toBe(true);
  });
});

describe('canvasDimsUsable', () => {
  it('accepts zero and positive finite dimensions', () => {
    expect(canvasDimsUsable(0, 0)).toBe(true);
    expect(canvasDimsUsable(0, 600)).toBe(true);
    expect(canvasDimsUsable(800, 0)).toBe(true);
    expect(canvasDimsUsable(800, 600)).toBe(true);
  });

  it('rejects negative, NaN, and infinite dimensions', () => {
    expect(canvasDimsUsable(-1, 600)).toBe(false);
    expect(canvasDimsUsable(800, -1)).toBe(false);
    expect(canvasDimsUsable(NaN, 600)).toBe(false);
    expect(canvasDimsUsable(800, Infinity)).toBe(false);
  });
});

describe('captureCameraView', () => {
  it('returns the viewport visible rect as a plain view', () => {
    const view = captureCameraView({
      getVisibleRect: () => ({ x: 1, y: 2, w: 3, h: 4 }),
    });
    expect(view).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
