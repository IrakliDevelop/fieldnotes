/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Camera } from './camera';
import { InputHandler } from './input-handler';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';

function wheel(
  el: HTMLElement,
  opts: Partial<WheelEventInit> & { clientX?: number; clientY?: number } = {},
) {
  el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...opts }));
}

function pointerDown(el: HTMLElement, opts: PointerEventInit = {}) {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...opts }));
}

function pointerMove(el: HTMLElement, opts: PointerEventInit = {}) {
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...opts }));
}

function pointerUp(el: HTMLElement, opts: PointerEventInit = {}) {
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...opts }));
}

function keyDown(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function keyUp(key: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function stubToolManager() {
  return {
    handlePointerDown: vi.fn(),
    handlePointerMove: vi.fn(),
    handlePointerUp: vi.fn(),
  } as unknown as ToolManager;
}

function stubToolContext(): ToolContext {
  return {
    camera: new Camera(),
    store: {} as ToolContext['store'],
    requestRender: vi.fn(),
  };
}

describe('InputHandler', () => {
  let element: HTMLDivElement;
  let camera: Camera;
  let handler: InputHandler;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    camera = new Camera();
    handler = new InputHandler(element, camera);
  });

  afterEach(() => {
    handler.destroy();
    document.body.removeChild(element);
  });

  describe('zoom with wheel', () => {
    it('zooms in on wheel scroll up', () => {
      wheel(element, { deltaY: -100, clientX: 0, clientY: 0 });
      expect(camera.zoom).toBeGreaterThan(1);
    });

    it('zooms out on wheel scroll down', () => {
      wheel(element, { deltaY: 100, clientX: 0, clientY: 0 });
      expect(camera.zoom).toBeLessThan(1);
    });

    it('zooms at the cursor position', () => {
      wheel(element, { deltaY: -100, clientX: 200, clientY: 200 });
      const pos = camera.position;
      expect(pos.x).not.toBe(0);
      expect(pos.y).not.toBe(0);
    });
  });

  describe('pan with middle mouse', () => {
    it('pans on middle mouse drag', () => {
      pointerDown(element, { button: 1, clientX: 100, clientY: 100 });
      pointerMove(element, { button: 1, clientX: 150, clientY: 120 });
      pointerUp(element, { button: 1 });

      expect(camera.position.x).toBe(50);
      expect(camera.position.y).toBe(20);
    });

    it('does not pan after pointer up', () => {
      pointerDown(element, { button: 1, clientX: 100, clientY: 100 });
      pointerUp(element, { button: 1 });
      pointerMove(element, { button: 1, clientX: 200, clientY: 200 });

      expect(camera.position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('pan with space + left mouse', () => {
    it('pans when space is held and left mouse drags', () => {
      keyDown(' ');
      pointerDown(element, { button: 0, clientX: 100, clientY: 100 });
      pointerMove(element, { button: 0, clientX: 160, clientY: 140 });
      pointerUp(element, { button: 0 });
      keyUp(' ');

      expect(camera.position.x).toBe(60);
      expect(camera.position.y).toBe(40);
    });

    it('does not pan with left mouse when space is not held', () => {
      pointerDown(element, { button: 0, clientX: 100, clientY: 100 });
      pointerMove(element, { button: 0, clientX: 200, clientY: 200 });
      pointerUp(element, { button: 0 });

      expect(camera.position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('tool dispatching', () => {
    it('dispatches left-click to tool manager', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { button: 0, clientX: 50, clientY: 50 });
      pointerMove(element, { clientX: 60, clientY: 60 });
      pointerUp(element, { clientX: 60, clientY: 60 });

      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      expect(tm.handlePointerMove).toHaveBeenCalledOnce();
      expect(tm.handlePointerUp).toHaveBeenCalledOnce();
    });

    it('does not dispatch to tool during space+drag pan', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      keyDown(' ');
      pointerDown(element, { button: 0, clientX: 50, clientY: 50 });
      pointerMove(element, { clientX: 60, clientY: 60 });
      pointerUp(element, { clientX: 60, clientY: 60 });
      keyUp(' ');

      expect(tm.handlePointerDown).not.toHaveBeenCalled();
    });

    it('does not dispatch to tool during middle-click pan', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { button: 1, clientX: 50, clientY: 50 });
      pointerMove(element, { clientX: 60, clientY: 60 });
      pointerUp(element, { button: 1 });

      expect(tm.handlePointerDown).not.toHaveBeenCalled();
    });
  });

  describe('touch support', () => {
    it('sets touch-action none on element', () => {
      expect(element.style.touchAction).toBe('none');
    });

    it('two-finger touch triggers pinch pan', () => {
      pointerDown(element, { pointerId: 1, clientX: 100, clientY: 100 });
      pointerDown(element, { pointerId: 2, clientX: 200, clientY: 200 });
      pointerMove(element, { pointerId: 1, clientX: 110, clientY: 110 });
      pointerMove(element, { pointerId: 2, clientX: 210, clientY: 210 });
      pointerUp(element, { pointerId: 1 });
      pointerUp(element, { pointerId: 2 });

      expect(camera.position.x).not.toBe(0);
    });

    it('cancels tool when second finger is added', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();

      pointerDown(element, { pointerId: 2, button: 0, clientX: 150, clientY: 150 });
      expect(tm.handlePointerUp).toHaveBeenCalledOnce();
    });
  });

  describe('lifecycle', () => {
    it('stops handling events after destroy', () => {
      handler.destroy();
      wheel(element, { deltaY: -100, clientX: 0, clientY: 0 });
      expect(camera.zoom).toBe(1);
    });
  });
});
