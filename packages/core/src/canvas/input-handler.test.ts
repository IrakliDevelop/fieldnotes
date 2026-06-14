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
import { ElementStore } from '../elements/element-store';
import { createNote, createArrow } from '../elements/element-factory';

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
    element.focus();
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

    it('dispatches tool for touch events even when button is not 0', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 1,
        button: -1,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      pointerUp(element, { pointerId: 1, pointerType: 'touch' });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
    });

    it('dispatches tool for pen events even when button is not 0', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 1,
        button: -1,
        pointerType: 'pen',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      pointerUp(element, { pointerId: 1 });
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

    it('handles Escape key to deselect', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      store.add(note);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note.id],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
      });

      keyDown('Escape');

      expect(setSelection).toHaveBeenCalledWith([]);
      expect(store.getById(note.id)).toBeDefined();
    });

    it('ignores keydown when target is an input element', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      store.add(note);

      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note.id],
          setSelection: vi.fn(),
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
      });

      const inputEl = document.createElement('input');
      element.appendChild(inputEl);

      const keyEvent = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
      Object.defineProperty(keyEvent, 'target', { value: inputEl });
      window.dispatchEvent(keyEvent);

      expect(store.getById(note.id)).toBeDefined();
      element.removeChild(inputEl);
    });

    it('Ctrl+D duplicates the selected element', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
      store.add(note);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note.id],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
      });

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }),
      );

      expect(store.count).toBe(2);
      expect(setSelection).toHaveBeenCalledOnce();
      const ids = setSelection.mock.calls[0]?.[0] as string[];
      expect(ids).toHaveLength(1);
      expect(ids[0]).not.toBe(note.id);
    });

    it('Ctrl+A calls selectAll and selects all element ids', () => {
      const store = new ElementStore();
      const noteA = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      const noteB = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 50 } });
      store.add(noteA);
      store.add(noteB);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
      });

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
      );

      expect(setSelection).toHaveBeenCalledOnce();
      const ids = setSelection.mock.calls[0]?.[0] as string[];
      expect(ids.sort()).toEqual([noteA.id, noteB.id].sort());
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

    it('ArrowRight moves a selected element and calls preventDefault', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
      store.add(note);

      const setSelection = vi.fn();
      const selectTool = {
        name: 'select',
        selectedIds: [note.id],
        setSelection,
        nudgeSelection: (dx: number, dy: number) => {
          const el = store.getById(note.id);
          if (el) {
            store.update(note.id, { position: { x: el.position.x + dx, y: el.position.y + dy } });
          }
          return true;
        },
      };
      const tm = {
        ...stubToolManager(),
        activeTool: selectTool,
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, { toolManager: tm, toolContext: tc });

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);

      expect(store.getById(note.id)?.position.x).toBe(101);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ArrowRight with no selection does not preventDefault', () => {
      const store = new ElementStore();

      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [],
          nudgeSelection: () => false,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;

      handler = new InputHandler(element, camera, { toolManager: tm, toolContext: tc });

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
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

    it('dispatches pen hover even when touch pointer is active', () => {
      const onHover = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: { onHover },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 1,
        button: 0,
        pointerType: 'touch',
        clientX: 200,
        clientY: 200,
      });

      pointerMove(element, {
        pointerId: 2,
        pointerType: 'pen',
        clientX: 100,
        clientY: 100,
      });
      expect(onHover).toHaveBeenCalledOnce();

      pointerUp(element, { pointerId: 1, pointerType: 'touch' });
    });

    it('does not dispatch finger hover when touch pointer is active', () => {
      const onHover = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: { onHover },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 1,
        button: 0,
        pointerType: 'touch',
        clientX: 200,
        clientY: 200,
      });

      pointerMove(element, {
        pointerId: 3,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      });
      expect(onHover).not.toHaveBeenCalled();

      pointerUp(element, { pointerId: 1, pointerType: 'touch' });
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

    it('calls releasePointerCapture on pointer up', () => {
      const releaseSpy = vi.fn();
      element.releasePointerCapture = releaseSpy;

      pointerDown(element, { pointerId: 5, button: 0, clientX: 50, clientY: 50 });
      pointerUp(element, { pointerId: 5 });
      expect(releaseSpy).toHaveBeenCalledWith(5);
    });

    it('does not throw if releasePointerCapture fails', () => {
      element.releasePointerCapture = () => {
        throw new DOMException('InvalidStateError');
      };

      pointerDown(element, { pointerId: 7, button: 0, clientX: 50, clientY: 50 });
      expect(() => pointerUp(element, { pointerId: 7 })).not.toThrow();
    });
  });

  describe('lifecycle', () => {
    it('stops handling events after destroy', () => {
      handler.destroy();
      wheel(element, { deltaY: -100, clientX: 0, clientY: 0 });
      expect(camera.zoom).toBe(1);
    });
  });

  describe('pointerType forwarding', () => {
    it('includes pointerType in PointerState passed to tools', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { button: 0, clientX: 50, clientY: 50, pointerType: 'pen' });
      expect(tm.handlePointerDown).toHaveBeenCalledWith(
        expect.objectContaining({ pointerType: 'pen' }),
        tc,
      );
      pointerUp(element, { pointerType: 'pen' });
    });

    it('defaults pointerType to mouse for standard clicks', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { button: 0, clientX: 50, clientY: 50 });
      expect(tm.handlePointerDown).toHaveBeenCalledWith(
        expect.objectContaining({ pointerType: 'mouse' }),
        tc,
      );
      pointerUp(element);
    });
  });

  describe('input filtering', () => {
    it('dispatches pen pointerdown to tool immediately', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 10,
        button: 0,
        pointerType: 'pen',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      pointerUp(element, { pointerId: 10, pointerType: 'pen' });
    });

    it('dispatches mouse pointerdown to tool immediately', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, { button: 0, clientX: 50, clientY: 50, pointerType: 'mouse' });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      pointerUp(element, { pointerType: 'mouse' });
    });

    it('does NOT dispatch touch pointerdown to tool (deferred)', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 5,
        button: 0,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).not.toHaveBeenCalled();
      pointerUp(element, { pointerId: 5, pointerType: 'touch' });
    });

    it('dispatches deferred touch as drag when move exceeds threshold', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 5,
        button: 0,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).not.toHaveBeenCalled();

      pointerMove(element, {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 60,
        clientY: 60,
      });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      expect(tm.handlePointerMove).toHaveBeenCalledOnce();

      pointerUp(element, { pointerId: 5, pointerType: 'touch' });
      expect(tm.handlePointerUp).toHaveBeenCalledOnce();
    });

    it('dispatches confirmed tap on touch up while deferred', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 5,
        button: 0,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      pointerUp(element, {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });

      expect(tm.handlePointerDown).toHaveBeenCalledOnce();
      expect(tm.handlePointerUp).toHaveBeenCalledOnce();
    });

    it('suppresses touch events while pen is active', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 10,
        button: 0,
        pointerType: 'pen',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();

      pointerDown(element, {
        pointerId: 20,
        button: 0,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      });
      expect(tm.handlePointerDown).toHaveBeenCalledOnce();

      pointerUp(element, { pointerId: 20, pointerType: 'touch' });
      pointerUp(element, { pointerId: 10, pointerType: 'pen' });
    });

    it('clears deferred state on pinch', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerDown(element, {
        pointerId: 1,
        button: 0,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      expect(tm.handlePointerDown).not.toHaveBeenCalled();

      pointerDown(element, {
        pointerId: 2,
        button: 0,
        pointerType: 'touch',
        clientX: 150,
        clientY: 150,
      });

      pointerUp(element, { pointerId: 2, pointerType: 'touch' });
      pointerUp(element, { pointerId: 1, pointerType: 'touch' });

      expect(tm.handlePointerDown).not.toHaveBeenCalled();
    });

    it('wraps confirmed tap in history begin/commit', () => {
      const tm = stubToolManager();
      const tc = stubToolContext();
      const hr = { begin: vi.fn(), commit: vi.fn() } as unknown as HistoryRecorder;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr,
      });

      pointerDown(element, {
        pointerId: 5,
        button: 0,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      pointerUp(element, {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });

      expect(hr.begin).toHaveBeenCalledOnce();
      expect(hr.commit).toHaveBeenCalledOnce();
    });
  });

  describe('copy/paste', () => {
    function setupCopyPaste() {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      store.add(note);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note.id],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
        activeLayerId: 'layer-1',
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn(), pause: vi.fn(), resume: vi.fn() };

      const h = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      return { store, note, tm, tc, hr, h, setSelection };
    }

    function ctrlKey(key: string) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    }

    it('Ctrl+V pastes elements with new IDs and offset', () => {
      const { store, note, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');

      expect(store.count).toBe(2);
      const all = store.getAll();
      const pasted = all.find((el) => el.id !== note.id);
      expect(pasted).toBeDefined();
      if (!pasted) return;
      expect(pasted.id).not.toBe(note.id);
      expect(pasted.position.x).toBe(note.position.x + 20);
      expect(pasted.position.y).toBe(note.position.y + 20);

      h.destroy();
    });

    it('successive Ctrl+V cascades offset', () => {
      const { store, note, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');
      ctrlKey('v');

      expect(store.count).toBe(3);
      const all = store.getAll();
      const pasted = all.filter((el) => el.id !== note.id);
      expect(pasted).toHaveLength(2);
      const offsets = pasted.map((el) => el.position.x - note.position.x);
      expect(offsets).toContain(20);
      expect(offsets).toContain(40);

      h.destroy();
    });

    it('Ctrl+C resets paste offset', () => {
      const { store, note, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');
      ctrlKey('c');
      ctrlKey('v');

      const all = store.getAll();
      const pasted = all.filter((el) => el.id !== note.id);
      const offsets = pasted.map((el) => el.position.x - note.position.x).sort();
      expect(offsets).toEqual([20, 20]);

      h.destroy();
    });

    it('Ctrl+V with empty clipboard is a no-op', () => {
      const { store, h } = setupCopyPaste();
      ctrlKey('v');
      expect(store.count).toBe(1);

      h.destroy();
    });

    it('wraps paste in history transaction', () => {
      const { hr, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');

      expect(hr.begin).toHaveBeenCalled();
      expect(hr.commit).toHaveBeenCalled();

      h.destroy();
    });

    it('selects pasted elements', () => {
      const { setSelection, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');

      expect(setSelection).toHaveBeenCalledOnce();
      const ids = setSelection.mock.calls[0]?.[0] as string[];
      expect(ids).toHaveLength(1);

      h.destroy();
    });

    it('remaps arrow bindings when target is also copied', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      store.add(note);
      const arrow = createArrow({
        from: { x: 100, y: 150 },
        to: { x: 300, y: 150 },
        fromBinding: { elementId: note.id },
      });
      store.add(arrow);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note.id, arrow.id],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn(), pause: vi.fn(), resume: vi.fn() };

      const h = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      ctrlKey('c');
      ctrlKey('v');

      const all = store.getAll();
      const pastedArrows = all.filter((el) => el.type === 'arrow' && el.id !== arrow.id);
      expect(pastedArrows).toHaveLength(1);
      const pastedArrow = pastedArrows[0];
      if (!pastedArrow) return;
      expect(pastedArrow.fromBinding).toBeDefined();
      const fromBinding = pastedArrow.fromBinding;
      if (!fromBinding) return;
      expect(fromBinding.elementId).not.toBe(note.id);

      const pastedNotes = all.filter((el) => el.type === 'note' && el.id !== note.id);
      expect(pastedNotes).toHaveLength(1);
      const pastedNote = pastedNotes[0];
      if (!pastedNote) return;
      expect(fromBinding.elementId).toBe(pastedNote.id);

      h.destroy();
    });

    it('strips arrow binding when target was not copied', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      store.add(note);
      const arrow = createArrow({
        from: { x: 100, y: 150 },
        to: { x: 300, y: 150 },
        fromBinding: { elementId: note.id },
      });
      store.add(arrow);

      const setSelection = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [arrow.id],
          setSelection,
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn(), pause: vi.fn(), resume: vi.fn() };

      const h = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      ctrlKey('c');
      ctrlKey('v');

      const all = store.getAll();
      const pastedArrows = all.filter((el) => el.type === 'arrow' && el.id !== arrow.id);
      expect(pastedArrows).toHaveLength(1);
      const strippedArrow = pastedArrows[0];
      if (!strippedArrow) return;
      expect(strippedArrow.fromBinding).toBeUndefined();

      h.destroy();
    });

    it('pastes into active layer', () => {
      const { store, note, h } = setupCopyPaste();
      ctrlKey('c');
      ctrlKey('v');

      const pasted = store.getAll().find((el) => el.id !== note.id);
      expect(pasted?.layerId).toBe('layer-1');

      h.destroy();
    });
  });

  describe('z-order shortcuts', () => {
    function setupZOrder() {
      const store = new ElementStore();
      const note1 = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        zIndex: 0,
        layerId: 'L1',
      });
      const note2 = createNote({
        position: { x: 200, y: 200 },
        size: { w: 200, h: 100 },
        zIndex: 1,
        layerId: 'L1',
      });
      store.add(note1);
      store.add(note2);

      const tm = {
        ...stubToolManager(),
        activeTool: {
          name: 'select',
          selectedIds: [note1.id],
        },
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn() };

      const h = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr as unknown as HistoryRecorder,
      });

      return { store, note1, note2, tm, tc, hr, h };
    }

    it('] brings selected element forward', () => {
      const { store, note1, note2, h } = setupZOrder();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(store.getById(note1.id)?.zIndex).toBe(1);
      expect(store.getById(note2.id)?.zIndex).toBe(0);
      h.destroy();
    });

    it('[ sends selected element backward', () => {
      const { store, note1, note2, tm, h } = setupZOrder();
      (tm.activeTool as unknown as { selectedIds: string[] }).selectedIds = [note2.id];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
      expect(store.getById(note2.id)?.zIndex).toBe(0);
      expect(store.getById(note1.id)?.zIndex).toBe(1);
      h.destroy();
    });

    it('Ctrl+] brings selected element to front', () => {
      const { store, note1, h } = setupZOrder();
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true }),
      );
      expect(store.getById(note1.id)?.zIndex).toBe(2);
      h.destroy();
    });

    it('Ctrl+[ sends selected element to back', () => {
      const { store, note2, tm, h } = setupZOrder();
      (tm.activeTool as unknown as { selectedIds: string[] }).selectedIds = [note2.id];
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '[', ctrlKey: true, bubbles: true }),
      );
      expect(store.getById(note2.id)?.zIndex).toBe(-1);
      h.destroy();
    });

    it('wraps z-order operation in history transaction', () => {
      const { hr, h } = setupZOrder();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(hr.begin).toHaveBeenCalled();
      expect(hr.commit).toHaveBeenCalled();
      h.destroy();
    });

    it('no-ops when tool is not select', () => {
      const { store, note1, h, tm } = setupZOrder();
      const originalZ = store.getById(note1.id)?.zIndex;
      (tm as unknown as { activeTool: { name: string } }).activeTool.name = 'pencil';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(store.getById(note1.id)?.zIndex).toBe(originalZ);
      h.destroy();
    });

    it('no-ops when selection is empty', () => {
      const { store, note1, tm, h } = setupZOrder();
      const originalZ = store.getById(note1.id)?.zIndex;
      (tm.activeTool as unknown as { selectedIds: string[] }).selectedIds = [];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(store.getById(note1.id)?.zIndex).toBe(originalZ);
      h.destroy();
    });
  });

  describe('Shift+1 zoom-to-fit shortcut', () => {
    it('calls the injected fitToContent option on Shift+1', () => {
      const fit = vi.fn();
      const h = new InputHandler(element, camera, { fitToContent: fit });

      const event = new KeyboardEvent('keydown', {
        code: 'Digit1',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);

      expect(fit).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      h.destroy();
    });

    it('does not call fitToContent when Ctrl+Shift+1 is pressed', () => {
      const fit = vi.fn();
      const h = new InputHandler(element, camera, { fitToContent: fit });

      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'Digit1',
          shiftKey: true,
          ctrlKey: true,
          bubbles: true,
        }),
      );

      expect(fit).not.toHaveBeenCalled();
      h.destroy();
    });

    it('does not call fitToContent when only 1 is pressed (no Shift)', () => {
      const fit = vi.fn();
      const h = new InputHandler(element, camera, { fitToContent: fit });

      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Digit1', shiftKey: false, bubbles: true }),
      );

      expect(fit).not.toHaveBeenCalled();
      h.destroy();
    });
  });

  describe('nudge + pointer-down race condition', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('flushes pending nudge transaction before pointer-down begins a new one', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
      store.add(note);

      const selectTool = {
        name: 'select',
        selectedIds: [note.id],
        setSelection: vi.fn(),
        nudgeSelection: (dx: number, dy: number) => {
          const el = store.getById(note.id);
          if (el) {
            store.update(note.id, { position: { x: el.position.x + dx, y: el.position.y + dy } });
          }
          return true;
        },
      };
      const tm = {
        ...stubToolManager(),
        activeTool: selectTool,
      } as unknown as ToolManager;
      const tc = {
        ...stubToolContext(),
        store,
      } as unknown as ToolContext;
      const hr = { begin: vi.fn(), commit: vi.fn() } as unknown as HistoryRecorder;

      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: tc,
        historyRecorder: hr,
      });

      // ArrowRight nudge: opens a transaction (begin #1), 400ms timer pending
      keyDown('ArrowRight');
      expect(hr.begin).toHaveBeenCalledTimes(1);
      expect(hr.commit).toHaveBeenCalledTimes(0);

      // Pointer-down within 400ms: must flush the nudge (commit #1) then begin a new transaction (begin #2)
      pointerDown(element, { button: 0, clientX: 50, clientY: 50 });

      expect(hr.commit).toHaveBeenCalledTimes(1);
      expect(hr.begin).toHaveBeenCalledTimes(2);
    });
  });

  describe('cursor restore on space release', () => {
    it('dispatches tool hover after space release to restore cursor', () => {
      const onHover = vi.fn();
      const tm = {
        ...stubToolManager(),
        activeTool: { onHover },
      } as unknown as ToolManager;
      const tc = stubToolContext();
      handler.setToolManager(tm, tc);

      pointerMove(element, { clientX: 100, clientY: 100 });
      expect(onHover).toHaveBeenCalledTimes(1);

      keyDown(' ');
      keyUp(' ');

      expect(onHover).toHaveBeenCalledTimes(2);
    });

    it('resets cursor to default on space release when no prior move event', () => {
      const setCursor = vi.fn();
      const tm = stubToolManager();
      const tc = { ...stubToolContext(), setCursor } as unknown as ToolContext;
      handler.setToolManager(tm, tc);

      keyDown(' ');
      keyUp(' ');

      expect(setCursor).toHaveBeenCalledWith('default');
    });
  });

  describe('configurable shortcuts', () => {
    function setupWithTools(shortcuts?: { bindings?: Record<string, string | string[] | null> }): {
      switchTool: ReturnType<typeof vi.fn>;
    } {
      const tm = stubToolManager();
      const switchTool = vi.fn();
      const ctx: ToolContext = { ...stubToolContext(), switchTool };
      handler.destroy();
      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: ctx,
        shortcuts,
      });
      return { switchTool };
    }

    it('tool key dispatches switchTool', () => {
      const { switchTool } = setupWithTools();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).toHaveBeenCalledWith('pencil');
    });

    it('tool key is ignored mid-gesture', () => {
      const { switchTool } = setupWithTools();
      pointerDown(element, { button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).not.toHaveBeenCalled();
      pointerUp(element, { button: 0 });
    });

    it('custom binding from options takes effect and default is replaced', () => {
      const { switchTool } = setupWithTools({ bindings: { 'tool:pencil': 'b' } });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).not.toHaveBeenCalled();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      expect(switchTool).toHaveBeenCalledWith('pencil');
    });

    it('runtime rebind takes effect', () => {
      const { switchTool } = setupWithTools();
      handler.shortcuts.rebind('tool:pencil', 'b');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      expect(switchTool).toHaveBeenCalledWith('pencil');
    });

    it('disabled action is dead', () => {
      const { switchTool } = setupWithTools({ bindings: { 'tool:pencil': null } });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).not.toHaveBeenCalled();
    });

    it('delete shortcut prevents default (Backspace back-nav)', () => {
      setupWithTools();
      const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('warns on unknown non-tool action ids', () => {
      setupWithTools();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      handler.shortcuts.rebind('my-typo-action', 'k');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('my-typo-action'));
      warnSpy.mockRestore();
    });
  });

  describe('focus scoping', () => {
    it('shortcuts are ignored when focus is outside the canvas (default scope)', () => {
      const tm = stubToolManager();
      const switchTool = vi.fn();
      handler.destroy();
      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: { ...stubToolContext(), switchTool },
      });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).not.toHaveBeenCalled();

      element.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).toHaveBeenCalledWith('pencil');
      document.body.removeChild(outside);
    });

    it("scope: 'window' restores page-wide handling", () => {
      const tm = stubToolManager();
      const switchTool = vi.fn();
      handler.destroy();
      handler = new InputHandler(element, camera, {
        toolManager: tm,
        toolContext: { ...stubToolContext(), switchTool },
        shortcuts: { scope: 'window' },
      });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(switchTool).toHaveBeenCalledWith('pencil');
      document.body.removeChild(outside);
    });

    it('makes the element focusable and focuses it on pointer down', () => {
      expect(element.tabIndex).toBe(0);
      expect(element.style.outline).toBe('none');
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      expect(document.activeElement).toBe(outside);

      pointerDown(element, { button: 0, clientX: 5, clientY: 5, pointerType: 'mouse' });
      expect(document.activeElement).toBe(element);
      pointerUp(element, { button: 0 });
      document.body.removeChild(outside);
    });

    it('space-pan is scope-gated but space release outside still clears pan mode', () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      keyDown(' ');
      pointerDown(element, { button: 0, clientX: 100, clientY: 100 });
      pointerMove(element, { button: 0, clientX: 160, clientY: 140 });
      pointerUp(element, { button: 0 });
      expect(camera.position).toEqual({ x: 0, y: 0 });
      keyUp(' ');
      document.body.removeChild(outside);
    });

    it('pointer down does not steal focus from a focused child inside the element', () => {
      const child = document.createElement('input');
      element.appendChild(child);
      child.focus();
      expect(document.activeElement).toBe(child);

      pointerDown(element, { button: 0, clientX: 5, clientY: 5, pointerType: 'mouse' });
      expect(document.activeElement).toBe(child);
      pointerUp(element, { button: 0 });
      element.removeChild(child);
    });
  });

  describe('destroy DOM cleanup', () => {
    it('removes the tabindex and outline it set in focus scope', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const h = new InputHandler(el, new Camera());
      expect(el.tabIndex).toBe(0);
      h.destroy();
      expect(el.hasAttribute('tabindex')).toBe(false);
      expect(el.style.outline).toBe('');
      document.body.removeChild(el);
    });

    it('leaves the element untouched in window scope', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const h = new InputHandler(el, new Camera(), { shortcuts: { scope: 'window' } });
      expect(el.hasAttribute('tabindex')).toBe(false);
      h.destroy();
      expect(el.hasAttribute('tabindex')).toBe(false);
      document.body.removeChild(el);
    });
  });
});
