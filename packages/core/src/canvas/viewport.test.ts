/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import {
  createNote,
  createText,
  createStroke,
  createArrow,
  createHtmlElement,
} from '../elements/element-factory';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';

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

  it('sets overscroll-behavior: none on wrapper', () => {
    const viewport = new Viewport(container);
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.style.overscrollBehavior).toBe('none');
    viewport.destroy();
  });

  it('sets user-select: none on wrapper', () => {
    const viewport = new Viewport(container);
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.style.userSelect).toBe('none');
    viewport.destroy();
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

  it('addImage returns the element ID', () => {
    const viewport = new Viewport(container);
    const id = viewport.addImage('data:image/png;base64,abc', { x: 0, y: 0 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const el = viewport.store.getById(id);
    expect(el).toBeDefined();
    expect(el?.type).toBe('image');
    viewport.destroy();
  });

  it('addHtmlElement returns the element ID', () => {
    const viewport = new Viewport(container);
    const dom = document.createElement('div');
    const id = viewport.addHtmlElement(dom, { x: 0, y: 0 });
    expect(typeof id).toBe('string');
    const el = viewport.store.getById(id);
    expect(el).toBeDefined();
    expect(el?.type).toBe('html');
    viewport.destroy();
  });

  it('addHtmlElement captures domId from DOM element id', () => {
    const viewport = new Viewport(container);
    const dom = document.createElement('div');
    dom.id = 'my-chart';
    const id = viewport.addHtmlElement(dom, { x: 0, y: 0 });
    const el = viewport.store.getById(id);
    expect(el?.type).toBe('html');
    if (el?.type === 'html') {
      expect(el.domId).toBe('my-chart');
    }
    viewport.destroy();
  });

  it('loadState reattaches HTML elements by domId', () => {
    const viewport = new Viewport(container);
    const dom = document.createElement('div');
    dom.id = 'persistent-widget';
    dom.textContent = 'Hello';
    document.body.appendChild(dom);

    const id = viewport.addHtmlElement(dom, { x: 10, y: 20 });
    const state = viewport.exportState();

    const viewport2 = new Viewport(container);
    viewport2.loadState(state);

    const el = viewport2.store.getById(id);
    expect(el?.type).toBe('html');
    if (el?.type === 'html') {
      expect(el.domId).toBe('persistent-widget');
    }
    viewport2.destroy();
    viewport.destroy();
    dom.remove();
  });

  describe('HTML element interact mode', () => {
    it('stopInteracting is safe to call when not interacting', () => {
      const viewport = new Viewport(container);
      expect(() => viewport.stopInteracting()).not.toThrow();
      viewport.destroy();
    });

    it('addHtmlElement stores the element for later interaction', () => {
      const viewport = new Viewport(container);
      const dom = document.createElement('div');
      const id = viewport.addHtmlElement(dom, { x: 0, y: 0 });
      expect(viewport.store.getById(id)?.type).toBe('html');
      viewport.destroy();
    });
  });

  describe('startEditingElement via dblclick', () => {
    let origElementFromPoint: typeof document.elementFromPoint;

    beforeEach(() => {
      origElementFromPoint = document.elementFromPoint;
    });

    afterEach(() => {
      document.elementFromPoint = origElementFromPoint;
    });

    it('starts editing a note via startEditingElement', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 10, y: 10 },
        size: { w: 200, h: 100 },
        text: 'Test',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);

      const priv = viewport as unknown as { startEditingElement: (id: string) => void };
      priv.startEditingElement(note.id);

      viewport.destroy();
    });

    it('ignores dblclick on non-note/text elements', () => {
      const viewport = new Viewport(container);
      const imageId = viewport.addImage('data:image/png;base64,abc', { x: 10, y: 10 });
      const wrapper = container.firstElementChild as HTMLDivElement;

      const fakeNode = document.createElement('div');
      fakeNode.dataset['elementId'] = imageId;
      wrapper.appendChild(fakeNode);
      document.elementFromPoint = vi.fn().mockReturnValue(fakeNode);

      expect(() => {
        wrapper.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 20, clientY: 20 }),
        );
      }).not.toThrow();
      wrapper.removeChild(fakeNode);
      viewport.destroy();
    });

    it('ignores dblclick when element id does not exist in store', () => {
      const viewport = new Viewport(container);
      const wrapper = container.firstElementChild as HTMLDivElement;
      const fakeNode = document.createElement('div');
      fakeNode.dataset['elementId'] = 'nonexistent-id';
      wrapper.appendChild(fakeNode);

      document.elementFromPoint = vi.fn().mockReturnValue(fakeNode);

      expect(() => {
        wrapper.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 5, clientY: 5 }),
        );
      }).not.toThrow();
      wrapper.removeChild(fakeNode);
      viewport.destroy();
    });

    it('starts editing a text element via startEditingElement', () => {
      const viewport = new Viewport(container);
      const text = createText({
        position: { x: 10, y: 10 },
        size: { w: 200, h: 50 },
        text: 'Title',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(text);

      const priv = viewport as unknown as { startEditingElement: (id: string) => void };
      priv.startEditingElement(text.id);

      viewport.destroy();
    });

    it('does not start editing for non-editable element types', () => {
      const viewport = new Viewport(container);
      const stroke = createStroke({
        position: { x: 0, y: 0 },
        points: [{ x: 0, y: 0, pressure: 1 }],
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(stroke);

      document.elementFromPoint = vi.fn().mockReturnValue(null);

      expect(() => {
        const priv = viewport as unknown as { startEditingElement: (id: string) => void };
        priv.startEditingElement(stroke.id);
      }).not.toThrow();
      viewport.destroy();
    });

    it('does not crash when element not found', () => {
      const viewport = new Viewport(container);
      document.elementFromPoint = vi.fn().mockReturnValue(null);

      expect(() => {
        const priv = viewport as unknown as { startEditingElement: (id: string) => void };
        priv.startEditingElement('nonexistent');
      }).not.toThrow();
      viewport.destroy();
    });

    it('falls through to hitTestWorld when no data-element-id node found', () => {
      const viewport = new Viewport(container);
      document.elementFromPoint = vi.fn().mockReturnValue(document.createElement('span'));

      const wrapper = container.firstElementChild as HTMLDivElement;
      expect(() => {
        wrapper.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 }),
        );
      }).not.toThrow();
      viewport.destroy();
    });

    it('dblclick on note node without elementId dataset is ignored', () => {
      const viewport = new Viewport(container);
      const wrapper = container.firstElementChild as HTMLDivElement;
      const node = document.createElement('div');
      wrapper.appendChild(node);
      document.elementFromPoint = vi.fn().mockReturnValue(node);

      expect(() => {
        wrapper.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 10 }),
        );
      }).not.toThrow();
      wrapper.removeChild(node);
      viewport.destroy();
    });
  });

  describe('onDblClick — html element interact mode', () => {
    it('activates interact mode when dblclick hits an html element', () => {
      const viewport = new Viewport(container);
      const dom = document.createElement('div');
      dom.style.width = '200px';
      dom.style.height = '100px';
      const htmlId = viewport.addHtmlElement(dom, { x: 0, y: 0 }, { w: 200, h: 100 });

      viewport.requestRender();

      viewport.store.queryPoint = () => {
        const el = viewport.store.getById(htmlId);
        return el ? [el] : [];
      };

      document.elementFromPoint = vi.fn().mockReturnValue(document.createElement('span'));

      const wrapper = container.firstElementChild as HTMLDivElement;
      wrapper.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 }),
      );

      viewport.stopInteracting();
      viewport.destroy();
    });
  });

  describe('onDrop', () => {
    it('handles drop with no dataTransfer files', () => {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as {
        onDrop: (e: { preventDefault: () => void; dataTransfer?: null }) => void;
      };
      const mockEvent = { preventDefault: vi.fn(), dataTransfer: null };
      expect(() => priv.onDrop(mockEvent)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      viewport.destroy();
    });

    it('skips non-image files', () => {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as { onDrop: (e: unknown) => void };
      const mockFile = { type: 'text/plain' };
      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [mockFile] },
        clientX: 100,
        clientY: 100,
      };
      priv.onDrop(mockEvent);
      expect(viewport.store.getElementsByType('image').length).toBe(0);
      viewport.destroy();
    });

    it('processes image files via FileReader', () => {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as { onDrop: (e: unknown) => void };
      const mockFile = { type: 'image/png' };
      let capturedOnload: (() => void) | null = null;
      const OrigFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        result: unknown = 'data:image/png;base64,abc';
        readAsDataURL = vi.fn();
        set onload(fn: (() => void) | null) {
          capturedOnload = fn;
        }
      } as unknown as typeof FileReader;

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [mockFile] },
        clientX: 100,
        clientY: 100,
      };
      priv.onDrop(mockEvent);

      if (capturedOnload) {
        capturedOnload();
      }
      expect(viewport.store.getElementsByType('image').length).toBe(1);

      globalThis.FileReader = OrigFileReader;
      viewport.destroy();
    });

    it('skips non-string FileReader results', () => {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as { onDrop: (e: unknown) => void };
      const mockFile = { type: 'image/png' };
      let capturedOnload: (() => void) | null = null;
      const OrigFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        result: unknown = new ArrayBuffer(0);
        readAsDataURL = vi.fn();
        set onload(fn: (() => void) | null) {
          capturedOnload = fn;
        }
      } as unknown as typeof FileReader;

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [mockFile] },
        clientX: 100,
        clientY: 100,
      };
      priv.onDrop(mockEvent);
      if (capturedOnload) {
        capturedOnload();
      }
      expect(viewport.store.getElementsByType('image').length).toBe(0);

      globalThis.FileReader = OrigFileReader;
      viewport.destroy();
    });
  });

  describe('unbindArrowsFrom on element removal', () => {
    it('unbinds arrows with fromBinding when source element is removed', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const arrow = createArrow({
        from: { x: 200, y: 150 },
        to: { x: 400, y: 300 },
        fromBinding: { elementId: note.id },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(arrow);

      viewport.store.remove(note.id);

      const updated = viewport.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.fromBinding).toBeUndefined();
      }
      viewport.destroy();
    });

    it('unbinds arrows with toBinding when target element is removed', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 300, y: 300 },
        size: { w: 200, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const arrow = createArrow({
        from: { x: 100, y: 100 },
        to: { x: 400, y: 350 },
        toBinding: { elementId: note.id },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(arrow);

      viewport.store.remove(note.id);

      const updated = viewport.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.toBinding).toBeUndefined();
      }
      viewport.destroy();
    });

    it('handles element removal with no bound arrows', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      expect(() => viewport.store.remove(note.id)).not.toThrow();
      viewport.destroy();
    });

    it('unbinds arrows with both from and to bindings to same element', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const arrow = createArrow({
        from: { x: 200, y: 150 },
        to: { x: 200, y: 150 },
        fromBinding: { elementId: note.id },
        toBinding: { elementId: note.id },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(arrow);

      viewport.store.remove(note.id);

      const updated = viewport.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.fromBinding).toBeUndefined();
        expect(updated.toBinding).toBeUndefined();
      }
      viewport.destroy();
    });
  });

  describe('onTextEditStop', () => {
    it('removes empty text elements when editing stops', () => {
      const viewport = new Viewport(container);
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(text);

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(text.id);

      expect(viewport.store.getById(text.id)).toBeUndefined();
      viewport.destroy();
    });

    it('removes whitespace-only text elements when editing stops', () => {
      const viewport = new Viewport(container);
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '   ',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(text);

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(text.id);

      expect(viewport.store.getById(text.id)).toBeUndefined();
      viewport.destroy();
    });

    it('removes a note emptied during editing', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '<div><br></div>',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(note.id);

      expect(viewport.store.getById(note.id)).toBeUndefined();
      viewport.destroy();
    });

    it('empty-note removal is one undo step', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(note.id);
      expect(viewport.store.getById(note.id)).toBeUndefined();

      expect(viewport.undo()).toBe(true);
      expect(viewport.store.getById(note.id)).toBeDefined();
      viewport.destroy();
    });

    it('keeps a note with real content', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: '<b>hi</b>',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(note.id);

      expect(viewport.store.getById(note.id)).toBeDefined();
      viewport.destroy();
    });

    it('ignores nonexistent element IDs', () => {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      expect(() => priv.onTextEditStop('nonexistent')).not.toThrow();
      viewport.destroy();
    });

    it('keeps text element with content and does not resize if height matches', () => {
      const viewport = new Viewport(container);
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 50 },
        text: 'Hello world',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(text);

      viewport.requestRender();

      const priv = viewport as unknown as { onTextEditStop: (id: string) => void };
      priv.onTextEditStop(text.id);

      expect(viewport.store.getById(text.id)).toBeDefined();
      viewport.destroy();
    });
  });

  describe('snapToGrid', () => {
    it('defaults to false', () => {
      const viewport = new Viewport(container);
      expect(viewport.snapToGrid).toBe(false);
      viewport.destroy();
    });

    it('can be toggled on and off', () => {
      const viewport = new Viewport(container);
      viewport.setSnapToGrid(true);
      expect(viewport.snapToGrid).toBe(true);
      viewport.setSnapToGrid(false);
      expect(viewport.snapToGrid).toBe(false);
      viewport.destroy();
    });
  });

  describe('undo/redo', () => {
    it('undo returns false when nothing to undo', () => {
      const viewport = new Viewport(container);
      expect(viewport.undo()).toBe(false);
      viewport.destroy();
    });

    it('redo returns false when nothing to redo', () => {
      const viewport = new Viewport(container);
      expect(viewport.redo()).toBe(false);
      viewport.destroy();
    });

    it('undo/redo round-trips an addImage operation', () => {
      const viewport = new Viewport(container);
      const id = viewport.addImage('data:image/png;base64,abc', { x: 0, y: 0 });
      expect(viewport.store.getById(id)).toBeDefined();
      viewport.undo();
      expect(viewport.store.getById(id)).toBeUndefined();
      viewport.redo();
      expect(viewport.store.getById(id)).toBeDefined();
      viewport.destroy();
    });

    it('undo flushes a pending nudge transaction before popping the history stack', () => {
      vi.useFakeTimers();
      const viewport = new Viewport(container);

      const selectTool = new SelectTool();
      viewport.toolManager.register(selectTool);
      viewport.toolManager.setTool('select', viewport.toolContext);

      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 100, h: 50 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.history.clear();

      selectTool.setSelection([note.id]);

      (container.firstElementChild as HTMLDivElement).focus();

      // ArrowRight nudge: opens a 400ms-coalesced transaction, does NOT fire the timer yet
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      const nudgedX = viewport.store.getById(note.id)?.position.x;
      expect(nudgedX).toBe(101);

      // undo() within 400ms must flush the nudge FIRST, then undo it
      // Without the fix, undo() would pop the add-note entry (history is empty for nudge),
      // leaving the note at x=101. With the fix, nudge is committed then undone → x=100.
      viewport.undo();

      expect(viewport.store.getById(note.id)?.position.x).toBe(100);

      vi.useRealTimers();
      viewport.destroy();
    });

    it('redo flushes a pending nudge transaction before re-applying history', () => {
      vi.useFakeTimers();
      const viewport = new Viewport(container);

      const selectTool = new SelectTool();
      viewport.toolManager.register(selectTool);
      viewport.toolManager.setTool('select', viewport.toolContext);

      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 100, h: 50 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.history.clear();

      selectTool.setSelection([note.id]);

      (container.firstElementChild as HTMLDivElement).focus();

      // Nudge once, then immediately redo (timer not fired)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      // redo must flush the pending nudge (commit it) rather than discard it
      viewport.redo(); // nothing to redo, but flush must not break anything

      // The nudge is committed (flushed), position should be 101
      expect(viewport.store.getById(note.id)?.position.x).toBe(101);

      vi.useRealTimers();
      viewport.destroy();
    });
  });

  describe('loadState', () => {
    it('loads state without layers', () => {
      const viewport = new Viewport(container);
      viewport.addImage('data:image/png;base64,abc', { x: 0, y: 0 });
      const state = viewport.exportState();
      state.layers = [];

      const viewport2 = new Viewport(container);
      expect(() => viewport2.loadState(state)).not.toThrow();
      viewport2.destroy();
      viewport.destroy();
    });

    it('clears history after loading state', () => {
      const viewport = new Viewport(container);
      viewport.addImage('data:image/png;base64,abc', { x: 0, y: 0 });
      const state = viewport.exportState();
      viewport.loadState(state);
      expect(viewport.undo()).toBe(false);
      viewport.destroy();
    });

    it('flushes a pending nudge before clearing history so stale nudge cannot corrupt the fresh stack', () => {
      vi.useFakeTimers();
      const viewport = new Viewport(container);

      const selectTool = new SelectTool();
      viewport.toolManager.register(selectTool);
      viewport.toolManager.setTool('select', viewport.toolContext);

      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 100, h: 50 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.history.clear();
      selectTool.setSelection([note.id]);

      (container.firstElementChild as HTMLDivElement).focus();

      // Start a pending nudge (timer not fired)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(viewport.store.getById(note.id)?.position.x).toBe(101);

      // Take a snapshot of current state (note at x=101) and loadState
      const snapshot = viewport.exportState();
      viewport.loadState(snapshot);

      // Advance timers — the nudge timer must be gone (flushed by loadState)
      vi.advanceTimersByTime(400);

      // History was cleared by loadState; undo should be a no-op
      expect(viewport.undo()).toBe(false);

      vi.useRealTimers();
      viewport.destroy();
    });
  });

  describe('panBufferMargin option', () => {
    it('respects panBufferMargin: 0 (exact-viewport caches, no margin)', () => {
      const viewport = new Viewport(container, { panBufferMargin: 0 });
      const mv = (viewport as unknown as { marginViewport: { physicalWidth: () => number } })
        .marginViewport;
      // cssW = 800 (clientWidth is 0 in jsdom, fallback is 800), dpr = 1, margin = 0
      expect(mv.physicalWidth()).toBe(800);
      viewport.destroy();
    });

    it('defaults panBufferMargin to 256', () => {
      const viewport = new Viewport(container);
      const mv = (viewport as unknown as { marginViewport: { physicalWidth: () => number } })
        .marginViewport;
      // cssW = 800, dpr = 1, margin = 256 → 800 + 2*256 = 1312
      expect(mv.physicalWidth()).toBe(1312);
      viewport.destroy();
    });
  });

  describe('addGrid', () => {
    it('replaces existing grid when adding a new one', () => {
      const viewport = new Viewport(container);
      viewport.addGrid({ gridType: 'square', cellSize: 40 });
      const grids1 = viewport.store.getElementsByType('grid');
      expect(grids1.length).toBe(1);

      viewport.addGrid({ gridType: 'hex', cellSize: 60 });
      const grids2 = viewport.store.getElementsByType('grid');
      expect(grids2.length).toBe(1);
      expect(grids2[0]?.gridType).toBe('hex');
      viewport.destroy();
    });
  });

  describe('updateGrid', () => {
    it('no-ops when no grid exists', () => {
      const viewport = new Viewport(container);
      expect(() => viewport.updateGrid({ cellSize: 100 })).not.toThrow();
      viewport.destroy();
    });
  });

  describe('removeGrid', () => {
    it('no-ops when no grid exists', () => {
      const viewport = new Viewport(container);
      expect(() => viewport.removeGrid()).not.toThrow();
      viewport.destroy();
    });
  });

  describe('exportJSON/loadJSON', () => {
    it('round-trips via JSON', () => {
      const viewport = new Viewport(container);
      viewport.addImage('data:image/png;base64,abc', { x: 10, y: 20 });
      const json = viewport.exportJSON();
      const viewport2 = new Viewport(container);
      viewport2.loadJSON(json);
      const images = viewport2.store.getElementsByType('image');
      expect(images.length).toBe(1);
      viewport2.destroy();
      viewport.destroy();
    });
  });

  describe('onHtmlElementMount', () => {
    it('calls callback for HTML elements with no content after loadState', () => {
      const mountSpy = vi.fn();
      const vp = new Viewport(container, { onHtmlElementMount: mountSpy });

      const el = createHtmlElement({
        position: { x: 10, y: 20 },
        size: { w: 200, h: 150 },
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(el);
      const state = vp.exportState();

      const vp2 = new Viewport(container, { onHtmlElementMount: mountSpy });
      vp2.loadState(state);

      expect(mountSpy).toHaveBeenCalledOnce();
      expect(mountSpy).toHaveBeenCalledWith(el.id, undefined, expect.any(HTMLDivElement));

      vp.destroy();
      vp2.destroy();
    });

    it('does not call callback for HTML elements that have content', () => {
      const mountSpy = vi.fn();
      const vp = new Viewport(container, { onHtmlElementMount: mountSpy });

      const dom = document.createElement('div');
      dom.id = 'my-widget';
      document.body.appendChild(dom);

      vp.addHtmlElement(dom, { x: 0, y: 0 });
      const state = vp.exportState();

      const vp2 = new Viewport(container, { onHtmlElementMount: mountSpy });
      vp2.loadState(state);

      expect(mountSpy).not.toHaveBeenCalled();

      dom.remove();
      vp.destroy();
      vp2.destroy();
    });

    it('does not fire when no callback is provided (backward compat)', () => {
      const vp = new Viewport(container);
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(el);
      const state = vp.exportState();

      const vp2 = new Viewport(container);
      expect(() => vp2.loadState(state)).not.toThrow();

      vp.destroy();
      vp2.destroy();
    });
  });

  describe('updateHtmlElement', () => {
    it('swaps DOM content of an existing HTML element', () => {
      const vp = new Viewport(container);
      const oldContent = document.createElement('div');
      oldContent.textContent = 'old';
      const id = vp.addHtmlElement(oldContent, { x: 0, y: 0 });

      const newContent = document.createElement('div');
      newContent.textContent = 'new';
      vp.updateHtmlElement(id, newContent);

      vp.destroy();
    });

    it('throws for non-existent element', () => {
      const vp = new Viewport(container);
      const content = document.createElement('div');
      expect(() => vp.updateHtmlElement('nonexistent', content)).toThrow();
      vp.destroy();
    });

    it('throws for non-html element', () => {
      const vp = new Viewport(container);
      const img = vp.addImage('data:image/png;base64,', { x: 0, y: 0 });
      const content = document.createElement('div');
      expect(() => vp.updateHtmlElement(img, content)).toThrow();
      vp.destroy();
    });
  });

  describe('onDrop callback', () => {
    it('calls onDrop callback with world position when provided', () => {
      const dropSpy = vi.fn();
      const vp = new Viewport(container, { onDrop: dropSpy });

      const event = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(event, 'clientX', { value: 100 });
      Object.defineProperty(event, 'clientY', { value: 200 });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [] },
      });

      vp.domLayer.parentElement?.dispatchEvent(event);

      expect(dropSpy).toHaveBeenCalledOnce();
      expect(dropSpy).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      );

      vp.destroy();
    });

    it('falls through to default image handling when no callback', () => {
      const vp = new Viewport(container);

      const event = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(event, 'clientX', { value: 100 });
      Object.defineProperty(event, 'clientY', { value: 200 });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [] },
      });

      expect(() => vp.domLayer.parentElement?.dispatchEvent(event)).not.toThrow();

      vp.destroy();
    });
  });

  describe('removeLayer', () => {
    it('wraps removeLayer in a transaction for atomic undo', () => {
      const vp = new Viewport(container);
      const layer = vp.layerManager.createLayer('Extra');

      const img = vp.addImage('data:image/png;base64,', { x: 0, y: 0 }, { w: 100, h: 100 });
      vp.store.update(img, { layerId: layer.id });

      vp.history.clear();

      vp.removeLayer(layer.id);
      expect(vp.history.undoCount).toBe(1);

      vp.undo();
      expect(vp.layerManager.getLayer(layer.id)).toBeDefined();
      expect(vp.store.getById(img)?.layerId).toBe(layer.id);

      vp.destroy();
    });
  });

  describe('fitToContent', () => {
    it('frames all elements (content center maps to canvas center)', () => {
      const viewport = new Viewport(container);
      const wrapper = container.firstElementChild as HTMLElement;
      Object.defineProperty(wrapper, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(wrapper, 'clientHeight', { value: 600, configurable: true });
      viewport.store.add(
        createNote({
          position: { x: 1000, y: 1000 },
          size: { w: 200, h: 100 },
          layerId: viewport.layerManager.activeLayerId,
        }),
      );

      viewport.fitToContent();

      const cam = viewport.camera;
      // bbox center (1100, 1050) must map to canvas center (400, 300)
      expect(cam.position.x + 1100 * cam.zoom).toBeCloseTo(400, 0);
      expect(cam.position.y + 1050 * cam.zoom).toBeCloseTo(300, 0);
      viewport.destroy();
    });

    it('is a no-op on an empty canvas', () => {
      const viewport = new Viewport(container);
      const zoomBefore = viewport.camera.zoom;
      const posBefore = { ...viewport.camera.position };

      viewport.fitToContent();

      expect(viewport.camera.zoom).toBe(zoomBefore);
      expect(viewport.camera.position).toEqual(posBefore);
      viewport.destroy();
    });

    it('is a no-op when the wrapper has zero size', () => {
      const viewport = new Viewport(container);
      const wrapper = container.firstElementChild as HTMLElement;
      Object.defineProperty(wrapper, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(wrapper, 'clientHeight', { value: 0, configurable: true });
      viewport.store.add(
        createNote({
          position: { x: 100, y: 100 },
          size: { w: 200, h: 100 },
          layerId: viewport.layerManager.activeLayerId,
        }),
      );
      const zoomBefore = viewport.camera.zoom;
      const posBefore = { ...viewport.camera.position };

      viewport.fitToContent();

      expect(viewport.camera.zoom).toBe(zoomBefore);
      expect(viewport.camera.position).toEqual(posBefore);
      viewport.destroy();
    });

    it('ignores elements on hidden layers', () => {
      const viewport = new Viewport(container);
      const wrapper = container.firstElementChild as HTMLElement;
      Object.defineProperty(wrapper, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(wrapper, 'clientHeight', { value: 600, configurable: true });

      const layer2 = viewport.layerManager.createLayer('Layer 2');
      viewport.layerManager.setLayerVisible(layer2.id, false);

      // element on visible layer
      viewport.store.add(
        createNote({
          position: { x: 1000, y: 1000 },
          size: { w: 200, h: 100 },
          layerId: viewport.layerManager.activeLayerId,
        }),
      );
      // element on hidden layer — should be excluded from bbox
      viewport.store.add(
        createNote({
          position: { x: 9000, y: 9000 },
          size: { w: 200, h: 100 },
          layerId: layer2.id,
        }),
      );

      viewport.fitToContent();

      const cam = viewport.camera;
      // bbox center of visible element only: (1100, 1050) must map to canvas center (400, 300)
      expect(cam.position.x + 1100 * cam.zoom).toBeCloseTo(400, 0);
      expect(cam.position.y + 1050 * cam.zoom).toBeCloseTo(300, 0);
      viewport.destroy();
    });
  });

  describe('setTool', () => {
    it('activates the named tool without passing toolContext', () => {
      const viewport = new Viewport(container);
      viewport.toolManager.register(new PencilTool());
      viewport.toolManager.register(new SelectTool());
      viewport.setTool('pencil');
      expect(viewport.toolManager.activeTool?.name).toBe('pencil');
      viewport.setTool('select');
      expect(viewport.toolManager.activeTool?.name).toBe('select');
      viewport.destroy();
    });
  });

  describe('setTool unknown-name warning', () => {
    it('warns and does not change the active tool for an unregistered name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      const viewport = new Viewport(container);
      viewport.toolManager.register(new SelectTool());
      viewport.setTool('select');
      viewport.setTool('nonexistent');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
      expect(viewport.toolManager.activeTool?.name).toBe('select');
      warnSpy.mockRestore();
      viewport.destroy();
    });

    it('does not warn for a registered tool', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      const viewport = new Viewport(container);
      viewport.toolManager.register(new SelectTool());
      viewport.toolManager.register(new PencilTool());
      viewport.setTool('select');
      viewport.setTool('pencil');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(viewport.toolManager.activeTool?.name).toBe('pencil');
      warnSpy.mockRestore();
      viewport.destroy();
    });
  });

  describe('shortcuts API', () => {
    it('exposes rebind/getBindings and options seed the table', () => {
      const viewport = new Viewport(container, {
        shortcuts: { bindings: { duplicate: 'mod+shift+d' } },
      });
      expect(viewport.shortcuts.getBindings()['duplicate']).toEqual(['mod+shift+d']);
      viewport.shortcuts.rebind('undo', 'mod+u');
      expect(viewport.shortcuts.getBindings()['undo']).toEqual(['mod+u']);
      viewport.shortcuts.disable('copy');
      expect(viewport.shortcuts.getBindings()['copy']).toEqual([]);
      viewport.shortcuts.reset();
      expect(viewport.shortcuts.getBindings()['undo']).toEqual(['mod+z']);
      viewport.destroy();
    });

    it('keyboard tool key switches the registered tool when wrapper focused', () => {
      const viewport = new Viewport(container);
      viewport.toolManager.register(new SelectTool());
      viewport.toolManager.register(new PencilTool());
      viewport.setTool('select');
      const wrapper = container.firstElementChild as HTMLDivElement;
      wrapper.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(viewport.toolManager.activeTool?.name).toBe('pencil');
      viewport.destroy();
    });

    it('a rebound tool key dispatches end-to-end', () => {
      const viewport = new Viewport(container);
      viewport.toolManager.register(new SelectTool());
      viewport.toolManager.register(new PencilTool());
      viewport.setTool('select');
      viewport.shortcuts.rebind('tool:pencil', 'b');
      const wrapper = container.firstElementChild as HTMLDivElement;
      wrapper.focus();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(viewport.toolManager.activeTool?.name).toBe('select');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      expect(viewport.toolManager.activeTool?.name).toBe('pencil');
      viewport.destroy();
    });
  });

  describe('onImageError', () => {
    function triggerImageError(viewport: Viewport, src: string): void {
      const renderer = (
        viewport as unknown as {
          renderer: { getImage?: unknown; imageCache?: unknown };
        }
      ).renderer;
      // force the load attempt directly (render path may be inert in jsdom)
      (renderer as unknown as { getImage: (s: string) => unknown }).getImage(src);
      const cache = (renderer as unknown as { imageCache: Map<string, unknown> }).imageCache;
      const img = cache.get(src);
      if (img instanceof HTMLImageElement) {
        img.onerror?.(new Event('error') as never);
      }
    }

    it('reports src and matching element ids to the option callback', () => {
      const onImageError = vi.fn();
      const viewport = new Viewport(container, { onImageError });
      const src = 'https://broken.example/a.png';
      const id = viewport.addImage(src, { x: 0, y: 0 });

      triggerImageError(viewport, src);

      expect(onImageError).toHaveBeenCalledWith(expect.objectContaining({ src, elementIds: [id] }));
      viewport.destroy();
    });

    it('console.warns when the option is unset', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      const viewport = new Viewport(container);
      const src = 'https://broken.example/b.png';
      viewport.addImage(src, { x: 0, y: 0 });

      triggerImageError(viewport, src);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(src));
      warnSpy.mockRestore();
      viewport.destroy();
    });

    it('forwards cause in the onImageError payload', () => {
      const onImageError = vi.fn();
      const viewport = new Viewport(container, { onImageError });
      const src = 'https://broken.example/d.png';
      viewport.addImage(src, { x: 0, y: 0 });
      const renderer = (viewport as unknown as { renderer: { getImage: (s: string) => unknown } })
        .renderer;
      renderer.getImage(src);
      const cache = (renderer as unknown as { imageCache: Map<string, unknown> }).imageCache;
      const img = cache.get(src);
      const event = new Event('error');
      if (img instanceof HTMLImageElement) img.onerror?.(event as never);
      expect(onImageError).toHaveBeenCalledWith(expect.objectContaining({ src, cause: event }));
      viewport.destroy();
    });
  });

  describe('store events trigger re-render', () => {
    it('update event on different layer marks both layers dirty', () => {
      const viewport = new Viewport(container);
      const layer2 = viewport.layerManager.createLayer('Layer 2');
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.store.update(note.id, { layerId: layer2.id });
      viewport.destroy();
    });

    it('clear event clears DOM nodes and syncs grid context', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.requestRender();
      viewport.store.clear();
      viewport.destroy();
    });
  });

  describe('fitNoteHeight (auto-grow)', () => {
    it('grows a note height to fit content height', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 20 },
        text: 'multi\nline\ntext',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const priv = viewport as unknown as {
        fitNoteHeight: (id: string) => void;
        domNodeManager: {
          syncDomNode: (el: unknown) => void;
          getNode: (id: string) => HTMLElement | undefined;
        };
      };
      priv.domNodeManager.syncDomNode(note);
      const node = priv.domNodeManager.getNode(note.id);
      expect(node).not.toBeUndefined();
      Object.defineProperty(node, 'scrollHeight', { value: 80, configurable: true });
      priv.fitNoteHeight(note.id);
      const updated = viewport.store.getById(note.id);
      expect(updated?.type === 'note' && updated.size.h).toBe(80);
      viewport.destroy();
    });

    it('does not shrink a note below its dragged height', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 200 },
        text: 'real content here',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const priv = viewport as unknown as {
        fitNoteHeight: (id: string) => void;
        domNodeManager: {
          syncDomNode: (el: unknown) => void;
          getNode: (id: string) => HTMLElement | undefined;
        };
      };
      priv.domNodeManager.syncDomNode(note);
      const node = priv.domNodeManager.getNode(note.id);
      expect(node).not.toBeUndefined();
      Object.defineProperty(node, 'scrollHeight', { value: 30, configurable: true });
      priv.fitNoteHeight(note.id);
      const updated = viewport.store.getById(note.id);
      expect(updated?.type === 'note' && updated.size.h).toBe(200);
      viewport.destroy();
    });
  });
});
