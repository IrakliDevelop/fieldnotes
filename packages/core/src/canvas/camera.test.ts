import { describe, it, expect, vi } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('initializes at origin with zoom 1', () => {
    const camera = new Camera();
    expect(camera.position).toEqual({ x: 0, y: 0 });
    expect(camera.zoom).toBe(1);
  });

  it('pans by a delta', () => {
    const camera = new Camera();
    camera.pan(100, -50);
    expect(camera.position).toEqual({ x: 100, y: -50 });
  });

  it('accumulates multiple pans', () => {
    const camera = new Camera();
    camera.pan(10, 20);
    camera.pan(30, 40);
    expect(camera.position).toEqual({ x: 40, y: 60 });
  });

  it('moves to an absolute position', () => {
    const camera = new Camera();
    camera.pan(100, 100);
    camera.moveTo(0, 0);
    expect(camera.position).toEqual({ x: 0, y: 0 });
  });

  it('zooms within bounds', () => {
    const camera = new Camera();
    camera.setZoom(2);
    expect(camera.zoom).toBe(2);
  });

  it('clamps zoom to min', () => {
    const camera = new Camera({ minZoom: 0.1 });
    camera.setZoom(0.01);
    expect(camera.zoom).toBe(0.1);
  });

  it('clamps zoom to max', () => {
    const camera = new Camera({ maxZoom: 5 });
    camera.setZoom(10);
    expect(camera.zoom).toBe(5);
  });

  it('zooms at a point, keeping that point stationary', () => {
    const camera = new Camera();
    camera.zoomAt(2, { x: 100, y: 100 });

    expect(camera.zoom).toBe(2);
    expect(camera.position.x).toBeCloseTo(-100);
    expect(camera.position.y).toBeCloseTo(-100);
  });

  it('converts screen coords to world coords', () => {
    const camera = new Camera();
    camera.pan(-50, -50);
    camera.setZoom(2);

    const world = camera.screenToWorld({ x: 100, y: 100 });
    expect(world.x).toBeCloseTo(75);
    expect(world.y).toBeCloseTo(75);
  });

  it('converts world coords to screen coords', () => {
    const camera = new Camera();
    camera.pan(-50, -50);
    camera.setZoom(2);

    const screen = camera.worldToScreen({ x: 75, y: 75 });
    expect(screen.x).toBeCloseTo(100);
    expect(screen.y).toBeCloseTo(100);
  });

  it('round-trips screen -> world -> screen', () => {
    const camera = new Camera();
    camera.pan(123, -456);
    camera.setZoom(1.7);

    const original = { x: 300, y: 250 };
    const world = camera.screenToWorld(original);
    const back = camera.worldToScreen(world);

    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });

  it('emits change event on pan', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.pan(10, 10);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('emits change event on zoom', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.setZoom(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('provides a CSS transform string', () => {
    const camera = new Camera();
    camera.pan(50, -30);
    camera.setZoom(1.5);

    const transform = camera.toCSSTransform();
    expect(transform).toBe('translate3d(50px, -30px, 0) scale(1.5)');
  });
});
