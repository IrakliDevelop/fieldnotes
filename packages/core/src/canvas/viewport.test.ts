/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('creates a wrapper with canvas and DOM layers inside container', () => {
    const viewport = new Viewport(container);
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector('canvas')).not.toBeNull();
    expect(wrapper.children.length).toBe(2);
    viewport.destroy();
  });

  it('canvas fills the container', () => {
    const viewport = new Viewport(container);
    const canvas = container.querySelector('canvas');
    expect(canvas?.style.width).toBe('100%');
    expect(canvas?.style.height).toBe('100%');
    viewport.destroy();
  });

  it('exposes the camera', () => {
    const viewport = new Viewport(container);
    expect(viewport.camera).toBeDefined();
    expect(viewport.camera.zoom).toBe(1);
    viewport.destroy();
  });

  it('exposes the canvas rendering context', () => {
    const viewport = new Viewport(container);
    expect(viewport.ctx).toBeDefined();
    viewport.destroy();
  });

  it('exposes the DOM layer for element overlays', () => {
    const viewport = new Viewport(container);
    expect(viewport.domLayer).toBeInstanceOf(HTMLDivElement);
    viewport.destroy();
  });

  it('cleans up on destroy', () => {
    const viewport = new Viewport(container);
    viewport.destroy();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('applies camera transform to DOM layer on camera change', () => {
    const viewport = new Viewport(container);
    viewport.camera.pan(50, 100);
    expect(viewport.domLayer.style.transform).toContain('translate3d');
    viewport.destroy();
  });
});
