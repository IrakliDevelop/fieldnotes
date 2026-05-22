/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Camera } from './camera';
import { InputHandler } from './input-handler';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { HistoryRecorder } from '../history/history-recorder';
import type { HistoryStack } from '../history/history-stack';

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

    it('three simultaneous pointers do not crash', () => {
      pointerDown(element, { pointerId: 1, clientX: 50, clientY: 50 });
      pointerDown(element, { pointerId: 2, clientX: 150, clientY: 150 });
      pointerDown(element, { pointerId: 3, clientX: 250, clientY: 250 });

      pointerMove(element, { pointerId: 1, clientX: 60, clientY: 60 });
      pointerMove(element, { pointerId: 2, clientX: 160, clientY: 160 });
      pointerMove(element, { pointerId: 3, clientX: 260, clientY: 260 });

      pointerUp(element, { pointerId: 3 });
      pointerUp(element, { pointerId: 2 });
      pointerUp(element, { pointerId: 1 });

      expect(camera.zoom).toBeDefined();
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

  describe('keyboard shortcuts', () => {
    it('ignores keydown when target is contentEditable', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      const editableDiv = document.createElement('div');
      editableDiv.contentEditable = 'true';
      element.appendChild(editableDiv);

      const keyEvent = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      Object.defineProperty(keyEvent, 'target', { value: editableDiv });
      window.dispatchEvent(keyEvent);

      expect(tc.requestRender).not.toHaveBeenCalled();
      element.removeChild(editableDiv);
    });

    it('handles Delete key when select tool has selections', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: ['el-1'],
        },
      } as unknown as ToolManager;
      const store = {
        remove: vi.fn(),
      };
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn() };

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      keyDown('Delete');

      expect(store.remove).toHaveBeenCalledWith('el-1');
      expect(hr.begin).toHaveBeenCalled();
      expect(hr.commit).toHaveBeenCalled();
    });

    it('handles Backspace key for delete', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: ['el-2'],
        },
      } as unknown as ToolManager;
      const store = { remove: vi.fn() };
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn() };

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      keyDown('Backspace');
      expect(store.remove).toHaveBeenCalledWith('el-2');
    });

    it('does not delete when no items selected', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [],
        },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      keyDown('Delete');
      expect(tc.requestRender).not.toHaveBeenCalled();
    });

    it('does not delete when tool is not select', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'pencil',
        },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      keyDown('Delete');
      expect(tc.requestRender).not.toHaveBeenCalled();
    });

    it('handles Ctrl+Z for undo', () => {
      const hs = { undo: vi.fn(), redo: vi.fn() };
      const hr = { pause: vi.fn(), resume: vi.fn() };
      const tc = stubToolContext();

      handler = new InputHandler(element, camera, {
        toolContext: tc,
        historyStack: hs as unknown as HistoryStack,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);

      expect(hs.undo).toHaveBeenCalled();
      expect(hr.pause).toHaveBeenCalled();
      expect(hr.resume).toHaveBeenCalled();
    });

    it('handles Ctrl+Shift+Z for redo', () => {
      const hs = { undo: vi.fn(), redo: vi.fn() };
      const hr = { pause: vi.fn(), resume: vi.fn() };
      const tc = stubToolContext();

      handler = new InputHandler(element, camera, {
        toolContext: tc,
        historyStack: hs as unknown as HistoryStack,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);

      expect(hs.redo).toHaveBeenCalled();
    });

    it('handles Ctrl+Y for redo', () => {
      const hs = { undo: vi.fn(), redo: vi.fn() };
      const hr = { pause: vi.fn(), resume: vi.fn() };
      const tc = stubToolContext();

      handler = new InputHandler(element, camera, {
        toolContext: tc,
        historyStack: hs as unknown as HistoryStack,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      const event = new KeyboardEvent('keydown', {
        key: 'y',
        ctrlKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);

      expect(hs.redo).toHaveBeenCalled();
    });

    it('undo/redo no-op without historyStack', () => {
      const tc = stubToolContext();
      handler.setToolManager(stubToolManager(), tc);

      const undoEvent = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
      });
      expect(() => window.dispatchEvent(undoEvent)).not.toThrow();
    });
  });

  describe('tool hover', () => {
    it('dispatches hover when no pointers active', () => {
      const onHover = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: { onHover },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerMove(element, { clientX: 100, clientY: 100 });
      expect(onHover).toHaveBeenCalled();
    });

    it('does not dispatch hover when tool has no onHover', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: {},
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      expect(() => pointerMove(element, { clientX: 100, clientY: 100 })).not.toThrow();
    });

    it('does not dispatch hover when no active tool', () => {
      const tm = {
        ...stubToolManager(),
        activeTool: null,
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      expect(() => pointerMove(element, { clientX: 100, clientY: 100 })).not.toThrow();
    });
  });

  describe('tool dispatch without toolManager', () => {
    it('handles pointer events gracefully without tool manager', () => {
      pointerDown(element, { button: 0, clientX: 50, clientY: 50 });
      pointerMove(element, { clientX: 60, clientY: 60 });
      pointerUp(element, { clientX: 60, clientY: 60 });
      expect(camera.position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('pointer capture', () => {
    it('calls setPointerCapture on pointer down', () => {
      const spy = vi.fn();
      element.setPointerCapture = spy;

      pointerDown(element, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
      expect(spy).toHaveBeenCalledWith(1);
      pointerUp(element, { pointerId: 1 });
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
