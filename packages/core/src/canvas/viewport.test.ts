/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import {
  createNote,
  createText,
  createStroke,
  createShape,
  createArrow,
  createHtmlElement,
} from '../elements/element-factory';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';
import { renderImage } from '../elements/renderers/image-renderer';
import type { ImageElement } from '../elements/types';

function wrapperOf(container: HTMLElement): HTMLDivElement {
  const w = container.firstElementChild;
  if (!(w instanceof HTMLDivElement)) throw new Error('viewport wrapper not found');
  return w;
}
function focusCanvas(container: HTMLElement): void {
  wrapperOf(container).focus();
}

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
    const wrapper = wrapperOf(container);
    expect(wrapper.style.overscrollBehavior).toBe('none');
    viewport.destroy();
  });

  it('sets user-select: none on wrapper', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);
    expect(wrapper.style.userSelect).toBe('none');
    viewport.destroy();
  });

  it('creates a wrapper with canvas and DOM layers inside container', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);
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

  it('rehydrates an html element via a registered renderer on load', () => {
    const factory = (el: { data?: Record<string, unknown> }): HTMLElement => {
      const d = document.createElement('div');
      d.textContent = String(el.data?.['value']);
      return d;
    };

    const viewportA = new Viewport(container);
    viewportA.registerHtmlRenderer('chart', factory);
    const placeholder = document.createElement('div');
    const id = viewportA.addHtmlElement(
      placeholder,
      { x: 5, y: 5 },
      { w: 100, h: 80 },
      {
        htmlType: 'chart',
        data: { value: 42 },
      },
    );
    const json = viewportA.exportJSON();

    const mountSpy = vi.fn();
    const viewportB = new Viewport(container, { onHtmlElementMount: mountSpy });
    viewportB.registerHtmlRenderer('chart', factory);
    viewportB.loadJSON(json);

    const node = (
      viewportB as unknown as {
        domNodeManager: { getNode(id: string): HTMLDivElement | undefined };
      }
    ).domNodeManager.getNode(id);
    expect(node?.textContent).toContain('42');
    expect(mountSpy).toHaveBeenCalledWith(id, undefined, node);

    viewportA.destroy();
    viewportB.destroy();
  });

  it('loads an html element with no registered factory without throwing (empty node)', () => {
    const viewportA = new Viewport(container);
    const placeholder = document.createElement('div');
    const id = viewportA.addHtmlElement(
      placeholder,
      { x: 0, y: 0 },
      { w: 100, h: 80 },
      {
        htmlType: 'chart',
        data: { value: 7 },
      },
    );
    const json = viewportA.exportJSON();

    const viewportB = new Viewport(container);
    expect(() => viewportB.loadJSON(json)).not.toThrow();

    const node = (
      viewportB as unknown as {
        domNodeManager: { getNode(id: string): HTMLDivElement | undefined };
      }
    ).domNodeManager.getNode(id);
    expect(node?.textContent ?? '').not.toContain('7');

    viewportA.destroy();
    viewportB.destroy();
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

      const priv = (
        viewport as unknown as { interactions: { startEditingElement: (id: string) => void } }
      ).interactions;
      priv.startEditingElement(note.id);

      viewport.destroy();
    });

    it('ignores dblclick on non-note/text elements', () => {
      const viewport = new Viewport(container);
      const imageId = viewport.addImage('data:image/png;base64,abc', { x: 10, y: 10 });
      const wrapper = wrapperOf(container);

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
      const wrapper = wrapperOf(container);
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

      const priv = (
        viewport as unknown as { interactions: { startEditingElement: (id: string) => void } }
      ).interactions;
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
        const priv = (
          viewport as unknown as { interactions: { startEditingElement: (id: string) => void } }
        ).interactions;
        priv.startEditingElement(stroke.id);
      }).not.toThrow();
      viewport.destroy();
    });

    it('does not crash when element not found', () => {
      const viewport = new Viewport(container);
      document.elementFromPoint = vi.fn().mockReturnValue(null);

      expect(() => {
        const priv = (
          viewport as unknown as { interactions: { startEditingElement: (id: string) => void } }
        ).interactions;
        priv.startEditingElement('nonexistent');
      }).not.toThrow();
      viewport.destroy();
    });

    it('falls through to hitTestWorld when no data-element-id node found', () => {
      const viewport = new Viewport(container);
      document.elementFromPoint = vi.fn().mockReturnValue(document.createElement('span'));

      const wrapper = wrapperOf(container);
      expect(() => {
        wrapper.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 }),
        );
      }).not.toThrow();
      viewport.destroy();
    });

    it('dblclick on note node without elementId dataset is ignored', () => {
      const viewport = new Viewport(container);
      const wrapper = wrapperOf(container);
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

      const wrapper = wrapperOf(container);
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
      const priv = (
        viewport as unknown as {
          interactions: {
            onDrop: (e: { preventDefault: () => void; dataTransfer?: null }) => void;
          };
        }
      ).interactions;
      const mockEvent = { preventDefault: vi.fn(), dataTransfer: null };
      expect(() => priv.onDrop(mockEvent)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      viewport.destroy();
    });

    it('skips non-image files', () => {
      const viewport = new Viewport(container);
      const priv = (viewport as unknown as { interactions: { onDrop: (e: unknown) => void } })
        .interactions;
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
      const priv = (viewport as unknown as { interactions: { onDrop: (e: unknown) => void } })
        .interactions;
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
      const priv = (viewport as unknown as { interactions: { onDrop: (e: unknown) => void } })
        .interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
      priv.onTextEditStop(note.id);

      expect(viewport.store.getById(note.id)).toBeDefined();
      viewport.destroy();
    });

    it('ignores nonexistent element IDs', () => {
      const viewport = new Viewport(container);
      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

      const priv = (
        viewport as unknown as { interactions: { onTextEditStop: (id: string) => void } }
      ).interactions;
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

  describe('smartGuides', () => {
    it('setSmartGuides toggles the tool context flag and exposes getVisibleRect', () => {
      const viewport = new Viewport(container);
      expect(viewport.smartGuides).toBe(false);
      viewport.setSmartGuides(true);
      expect(viewport.smartGuides).toBe(true);
      expect(viewport.toolContext.smartGuides).toBe(true);
      const rect = viewport.toolContext.getVisibleRect?.();
      expect(rect).toBeDefined();
      expect(typeof rect?.w).toBe('number');
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

      focusCanvas(container);

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

      focusCanvas(container);

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

      focusCanvas(container);

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
      const wrapper = wrapperOf(container);
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
      const wrapper = wrapperOf(container);
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
      const wrapper = wrapperOf(container);
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
      const wrapper = wrapperOf(container);
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
      const wrapper = wrapperOf(container);
      wrapper.focus();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      expect(viewport.toolManager.activeTool?.name).toBe('select');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      expect(viewport.toolManager.activeTool?.name).toBe('pencil');
      viewport.destroy();
    });
  });

  describe('onImageError', () => {
    function loadImage(viewport: Viewport, src: string): void {
      const renderer = (
        viewport as unknown as {
          renderer: {
            imageCache: Map<string, ImageBitmap | HTMLImageElement | 'failed'>;
            onImageLoad: (() => void) | null;
            onImageError: ((src: string, cause?: unknown) => void) | null;
          };
        }
      ).renderer;
      // force the load attempt directly (render path may be inert in jsdom)
      const image = { src, position: { x: 0, y: 0 }, size: { w: 0, h: 0 } } as ImageElement;
      renderImage(
        {} as CanvasRenderingContext2D,
        image,
        renderer.imageCache,
        renderer.onImageLoad,
        renderer.onImageError,
      );
    }

    function triggerImageError(viewport: Viewport, src: string): void {
      loadImage(viewport, src);
      const cache = (viewport as unknown as { renderer: { imageCache: Map<string, unknown> } })
        .renderer.imageCache;
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
      loadImage(viewport, src);
      const cache = (viewport as unknown as { renderer: { imageCache: Map<string, unknown> } })
        .renderer.imageCache;
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

  describe('note text-edit undo coalescing', () => {
    it('a note text-edit that grows the note is a single undo step', () => {
      const viewport = new Viewport(container);

      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 20 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      viewport.history.clear();

      // Sync the DOM node then directly activate editing to bypass the rAF in startEditing.
      // The RenderLoop's own rAF makes vi.runAllTimers() infinite, so we go through the
      // private activateEditing path that startEditing calls after the frame fires.
      const priv = viewport as unknown as {
        domNodeManager: {
          syncDomNode: (el: unknown) => void;
          getNode: (id: string) => HTMLElement | undefined;
        };
        noteEditor: {
          stopEditing: (store: typeof viewport.store) => void;
          activateEditing: (node: HTMLDivElement, id: string, store: typeof viewport.store) => void;
        };
      };
      priv.domNodeManager.syncDomNode(note);
      const node = priv.domNodeManager.getNode(note.id) as HTMLDivElement;
      expect(node).not.toBeUndefined();

      // Activate editing synchronously (same logic startEditing's rAF would call)
      priv.noteEditor.activateEditing(node, note.id, viewport.store);

      // Simulate user typing a longer text
      node.innerHTML = 'a much longer note body that overflows';
      Object.defineProperty(node, 'scrollHeight', { value: 80, configurable: true });

      const undosBefore = viewport.history.undoCount;

      // Stop editing through the real path
      priv.noteEditor.stopEditing(viewport.store);

      const after = viewport.store.getById(note.id);
      expect(after?.type === 'note' && after.text).toContain('longer');
      expect(after?.type === 'note' && after.size.h).toBe(80);
      expect(viewport.history.undoCount).toBe(undosBefore + 1); // ONE step, not two

      viewport.history.undo(viewport.store);
      const reverted = viewport.store.getById(note.id);
      expect(reverted?.type === 'note' && reverted.text).toBe('a');
      expect(reverted?.type === 'note' && reverted.size.h).toBe(20);

      viewport.destroy();
    });
  });

  describe('selection styling API', () => {
    let viewport: Viewport;

    beforeEach(() => {
      viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
    });

    afterEach(() => {
      viewport.destroy();
    });

    function select(ids: string[]): void {
      const sel = viewport.toolManager.getTool('select');
      (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(ids);
    }

    it('applyStyleToSelection sets correct per-type fields in ONE undo step', () => {
      const stroke = createStroke({
        points: [{ x: 0, y: 0, pressure: 1 }],
        color: '#000',
        width: 2,
      });
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
      const note = createNote({ position: { x: 0, y: 0 }, text: 'hi' });
      viewport.store.add(stroke);
      viewport.store.add(shape);
      viewport.store.add(note);
      select([stroke.id, shape.id, note.id]);

      const before = viewport.history.undoCount;
      viewport.applyStyleToSelection({ color: '#f00', strokeWidth: 5 });

      expect((viewport.store.getById(stroke.id) as { color: string }).color).toBe('#f00');
      expect((viewport.store.getById(shape.id) as { strokeColor: string }).strokeColor).toBe(
        '#f00',
      );
      expect((viewport.store.getById(note.id) as { textColor: string }).textColor).toBe('#f00');
      expect((viewport.store.getById(stroke.id) as { width: number }).width).toBe(5);
      expect(viewport.history.undoCount).toBe(before + 1);

      viewport.history.undo(viewport.store);
      expect((viewport.store.getById(stroke.id) as { color: string }).color).toBe('#000');
    });

    it('getSelectionStyle returns shared values and omits mixed ones', () => {
      const a = createStroke({ points: [{ x: 0, y: 0, pressure: 1 }], color: '#111', width: 3 });
      const b = createStroke({ points: [{ x: 1, y: 1, pressure: 1 }], color: '#111', width: 9 });
      viewport.store.add(a);
      viewport.store.add(b);
      select([a.id, b.id]);
      const style = viewport.getSelectionStyle();
      expect(style?.color).toBe('#111');
      expect(style?.strokeWidth).toBeUndefined();
    });

    it('getSelectionStyle returns null for empty selection', () => {
      select([]);
      expect(viewport.getSelectionStyle()).toBeNull();
    });

    it('getSelectedIds returns a stable empty array when nothing selected', () => {
      select([]);
      expect(viewport.getSelectedIds()).toBe(viewport.getSelectedIds());
    });
  });

  describe('alignSelection / distributeSelection', () => {
    let viewport: Viewport;

    beforeEach(() => {
      viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
    });

    afterEach(() => {
      viewport.destroy();
    });

    function selectAll(ids: string[]): void {
      const sel = viewport.toolManager.getTool('select');
      (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(ids);
    }

    it('aligns left edges to the selection bbox', () => {
      const a = createNote({ position: { x: 10, y: 0 }, text: 'a' });
      a.size = { w: 20, h: 20 };
      const b = createNote({ position: { x: 50, y: 0 }, text: 'b' });
      b.size = { w: 20, h: 20 };
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      const before = viewport.history.undoCount;
      viewport.alignSelection('left');
      expect((viewport.store.getById(a.id) as { position: { x: number } }).position.x).toBe(10);
      expect((viewport.store.getById(b.id) as { position: { x: number } }).position.x).toBe(10);
      expect(viewport.history.undoCount).toBe(before + 1);
      viewport.history.undo(viewport.store);
      expect((viewport.store.getById(b.id) as { position: { x: number } }).position.x).toBe(50);
    });

    it('aligns center-x to the bbox center', () => {
      const a = createNote({ position: { x: 0, y: 0 }, text: 'a' });
      a.size = { w: 20, h: 10 };
      const b = createNote({ position: { x: 80, y: 0 }, text: 'b' });
      b.size = { w: 40, h: 10 };
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      viewport.alignSelection('center-x'); // bbox 0..120 center 60 → a.x=50, b.x=40
      expect((viewport.store.getById(a.id) as { position: { x: number } }).position.x).toBe(50);
      expect((viewport.store.getById(b.id) as { position: { x: number } }).position.x).toBe(40);
    });

    it("translates an arrow's from/to when aligning, not just position", () => {
      const note = createNote({ position: { x: 0, y: 0 }, text: 'n' });
      note.size = { w: 20, h: 20 };
      const arrow = createArrow({ from: { x: 100, y: 100 }, to: { x: 140, y: 120 } });
      viewport.store.add(note);
      viewport.store.add(arrow);
      selectAll([note.id, arrow.id]);
      viewport.alignSelection('top'); // bbox top 0; arrow top edge 100 → moves up 100
      const a = viewport.store.getById(arrow.id) as { from: { y: number }; to: { y: number } };
      expect(a.from.y).toBe(0);
      expect(a.to.y).toBe(20);
    });

    it('distributes horizontal centers evenly (extremes fixed)', () => {
      const mk = (x: number): ReturnType<typeof createNote> => {
        const n = createNote({ position: { x, y: 0 }, text: 't' });
        n.size = { w: 10, h: 10 };
        return n;
      };
      const a = mk(0),
        b = mk(30),
        c = mk(100); // centers 5,35,105
      viewport.store.add(a);
      viewport.store.add(b);
      viewport.store.add(c);
      selectAll([a.id, b.id, c.id]);
      viewport.distributeSelection('horizontal'); // c1 target 55 → b.x 50; extremes fixed
      expect((viewport.store.getById(a.id) as { position: { x: number } }).position.x).toBe(0);
      expect((viewport.store.getById(b.id) as { position: { x: number } }).position.x).toBe(50);
      expect((viewport.store.getById(c.id) as { position: { x: number } }).position.x).toBe(100);
    });

    it('no-ops align with < 2 bounded and distribute with < 3', () => {
      const a = createNote({ position: { x: 0, y: 0 }, text: 'a' });
      a.size = { w: 10, h: 10 };
      const b = createNote({ position: { x: 40, y: 0 }, text: 'b' });
      b.size = { w: 10, h: 10 };
      viewport.store.add(a);
      viewport.store.add(b);
      const before = viewport.history.undoCount; // AFTER adds
      selectAll([a.id]);
      viewport.alignSelection('left'); // 1 bounded → no-op
      selectAll([a.id, b.id]);
      viewport.distributeSelection('horizontal'); // 2 bounded → no-op
      expect(viewport.history.undoCount).toBe(before);
    });

    it('a locked element anchors the bbox but does not move', () => {
      const a = createNote({ position: { x: 0, y: 0 }, text: 'a' });
      a.size = { w: 10, h: 10 };
      a.locked = true;
      const b = createNote({ position: { x: 50, y: 0 }, text: 'b' });
      b.size = { w: 10, h: 10 };
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      viewport.alignSelection('left');
      expect((viewport.store.getById(a.id) as { position: { x: number } }).position.x).toBe(0);
      expect((viewport.store.getById(b.id) as { position: { x: number } }).position.x).toBe(0);
    });
  });

  describe('groupSelection / ungroupSelection', () => {
    let viewport: Viewport;

    beforeEach(() => {
      viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
    });

    afterEach(() => {
      viewport.destroy();
    });

    function selectAll(ids: string[]): void {
      const sel = viewport.toolManager.getTool('select');
      (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(ids);
    }

    it('groupSelection sets one shared groupId on all selected (>= 2), one undo step', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      const b = createNote({
        position: { x: 50, y: 0 },
        text: 'b',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      const before = viewport.history.undoCount;
      viewport.groupSelection();
      const ga = (viewport.store.getById(a.id) as { groupId?: string }).groupId;
      const gb = (viewport.store.getById(b.id) as { groupId?: string }).groupId;
      expect(ga).toBeDefined();
      expect(gb).toBeDefined();
      expect(ga).toBe(gb);
      expect(viewport.history.undoCount).toBe(before + 1);
      viewport.history.undo(viewport.store);
      expect((viewport.store.getById(a.id) as { groupId?: string }).groupId).toBeUndefined();
      expect((viewport.store.getById(b.id) as { groupId?: string }).groupId).toBeUndefined();
    });

    it('groupSelection is a no-op below 2 selected', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      selectAll([a.id]);
      const before = viewport.history.undoCount;
      viewport.groupSelection();
      expect((viewport.store.getById(a.id) as { groupId?: string }).groupId).toBeUndefined();
      expect(viewport.history.undoCount).toBe(before);
    });

    it('ungroupSelection clears groupId on all selected in one undo step', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      const b = createNote({
        position: { x: 50, y: 0 },
        text: 'b',
        layerId: viewport.layerManager.activeLayerId,
      });
      a.groupId = 'g1';
      b.groupId = 'g1';
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      const before = viewport.history.undoCount;
      viewport.ungroupSelection();
      expect((viewport.store.getById(a.id) as { groupId?: string }).groupId).toBeUndefined();
      expect((viewport.store.getById(b.id) as { groupId?: string }).groupId).toBeUndefined();
      expect(viewport.history.undoCount).toBe(before + 1);
    });

    it('ungroupSelection is a no-op when nothing selected is grouped', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      selectAll([a.id]);
      const before = viewport.history.undoCount;
      viewport.ungroupSelection();
      expect(viewport.history.undoCount).toBe(before);
    });
  });

  describe('toggleLockSelection', () => {
    let viewport: Viewport;

    beforeEach(() => {
      viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
    });

    afterEach(() => {
      viewport.destroy();
    });

    function selectAll(ids: string[]): void {
      const sel = viewport.toolManager.getTool('select');
      (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(ids);
    }

    it('locks all when any selected is unlocked, in one undo step', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      const b = createNote({
        position: { x: 50, y: 0 },
        text: 'b',
        layerId: viewport.layerManager.activeLayerId,
      });
      b.locked = true;
      viewport.store.add(a);
      viewport.store.add(b);
      selectAll([a.id, b.id]);
      const before = viewport.history.undoCount;
      viewport.toggleLockSelection();
      expect(viewport.store.getById(a.id)?.locked).toBe(true);
      expect(viewport.store.getById(b.id)?.locked).toBe(true);
      expect(viewport.history.undoCount).toBe(before + 1);
      viewport.history.undo(viewport.store);
      expect(viewport.store.getById(a.id)?.locked).toBe(false);
    });

    it('unlocks all when every selected is locked', () => {
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      a.locked = true;
      viewport.store.add(a);
      selectAll([a.id]);
      viewport.toggleLockSelection();
      expect(viewport.store.getById(a.id)?.locked).toBe(false);
    });

    it('is a no-op on empty selection', () => {
      selectAll([]);
      const before = viewport.history.undoCount;
      viewport.toggleLockSelection();
      expect(viewport.history.undoCount).toBe(before);
    });
  });

  describe('arrow label editing', () => {
    it('findArrowAt returns an arrow under the world point, undefined off it', () => {
      const viewport = new Viewport(container);
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      viewport.store.add(arrow);
      const priv = (
        viewport as unknown as {
          interactions: { findArrowAt: (w: { x: number; y: number }) => unknown };
        }
      ).interactions;
      expect(priv.findArrowAt({ x: 50, y: 0 })).toBeTruthy();
      expect(priv.findArrowAt({ x: 50, y: 80 })).toBeUndefined();
      viewport.destroy();
    });

    it('startArrowLabelEdit opens an input in the dom layer and sets the renderer editing id', () => {
      const viewport = new Viewport(container);
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      viewport.store.add(arrow);
      const priv = (
        viewport as unknown as { interactions: { startArrowLabelEdit: (a: typeof arrow) => void } }
      ).interactions;
      priv.startArrowLabelEdit(arrow);
      expect(viewport.domLayer.querySelector('input')).not.toBeNull();
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
        interactions: { fitNoteHeight: (id: string) => void };
        domNodeManager: {
          syncDomNode: (el: unknown) => void;
          getNode: (id: string) => HTMLElement | undefined;
        };
      };
      priv.domNodeManager.syncDomNode(note);
      const node = priv.domNodeManager.getNode(note.id);
      expect(node).not.toBeUndefined();
      Object.defineProperty(node, 'scrollHeight', { value: 80, configurable: true });
      priv.interactions.fitNoteHeight(note.id);
      const updated = viewport.store.getById(note.id);
      expect(updated?.type === 'note' && updated.size.h).toBe(80);
      viewport.destroy();
    });

    it('shrinks a note to fit when content needs less height', () => {
      const viewport = new Viewport(container);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 200 },
        text: 'real content here',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(note);
      const priv = viewport as unknown as {
        interactions: { fitNoteHeight: (id: string) => void };
        domNodeManager: {
          syncDomNode: (el: unknown) => void;
          getNode: (id: string) => HTMLElement | undefined;
        };
      };
      priv.domNodeManager.syncDomNode(note);
      const node = priv.domNodeManager.getNode(note.id);
      expect(node).not.toBeUndefined();
      Object.defineProperty(node, 'scrollHeight', { value: 30, configurable: true });
      priv.interactions.fitNoteHeight(note.id);
      const updated = viewport.store.getById(note.id);
      expect(updated?.type === 'note' && updated.size.h).toBe(30);
      viewport.destroy();
    });
  });

  describe('programmatic runAction + canPaste', () => {
    function setupSelect(viewport: Viewport): (ids: string[]) => void {
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
      return (ids: string[]) =>
        (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(ids);
    }

    it('runAction dispatches a named action programmatically', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      viewport.runAction('delete');
      expect(viewport.store.getById(a.id)).toBeUndefined();
      viewport.destroy();
    });

    it('canPaste reflects clipboard state', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      expect(viewport.canPaste()).toBe(false);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      viewport.runAction('copy');
      expect(viewport.canPaste()).toBe(true);
      viewport.destroy();
    });

    function menuLabels(): string[] {
      return Array.from(document.querySelectorAll('.fieldnotes-context-menu-item')).map(
        (el) => el.textContent ?? '',
      );
    }

    it('openContextMenu builds the full item set for a selection', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      viewport.openContextMenu({ x: 5, y: 5 });
      const labels = menuLabels();
      expect(labels).toContain('Cut');
      expect(labels).toContain('Copy');
      expect(labels).toContain('Duplicate');
      expect(labels).toContain('Delete');
      expect(labels).toContain('Bring to Front');
      expect(labels).toContain('Lock');
      viewport.destroy();
    });

    it('shows Unlock when all selected are locked', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      a.locked = true;
      viewport.store.add(a);
      select([a.id]);
      viewport.openContextMenu({ x: 5, y: 5 });
      const labels = menuLabels();
      expect(labels).toContain('Unlock');
      expect(labels).not.toContain('Lock');
      viewport.destroy();
    });

    it('empty selection + empty clipboard yields no menu', () => {
      const viewport = new Viewport(container);
      setupSelect(viewport);
      viewport.openContextMenu({ x: 5, y: 5 });
      expect(document.querySelector('.fieldnotes-context-menu')).toBeNull();
      viewport.destroy();
    });

    it('contextMenu: false yields no menu', () => {
      const viewport = new Viewport(container, { contextMenu: false });
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      viewport.openContextMenu({ x: 5, y: 5 });
      expect(document.querySelector('.fieldnotes-context-menu')).toBeNull();
      viewport.destroy();
    });
  });

  describe('addShape', () => {
    it('adds a default 100x100 rectangle, one undo step, and selects it', () => {
      const viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);
      const before = viewport.history.undoCount;

      const id = viewport.addShape();

      const el = viewport.store.getById(id);
      expect(el?.type).toBe('shape');
      expect((el as { shape: string }).shape).toBe('rectangle');
      expect((el as { size: { w: number; h: number } }).size).toEqual({ w: 100, h: 100 });
      expect(viewport.history.undoCount).toBe(before + 1);
      expect(viewport.getSelectedIds()).toContain(id);

      viewport.history.undo(viewport.store);
      expect(viewport.store.getById(id)).toBeUndefined();
      viewport.destroy();
    });

    it('honors opts (shape, size, position)', () => {
      const viewport = new Viewport(container);
      const sel = new SelectTool();
      viewport.toolManager.register(sel);
      viewport.toolManager.setTool('select', viewport.toolContext);

      const id = viewport.addShape({
        shape: 'ellipse',
        size: { w: 40, h: 40 },
        position: { x: 5, y: 6 },
      });

      const el = viewport.store.getById(id) as {
        shape: string;
        size: { w: number; h: number };
        position: { x: number; y: number };
      };
      expect(el.shape).toBe('ellipse');
      expect(el.size).toEqual({ w: 40, h: 40 });
      expect(el.position).toEqual({ x: 5, y: 6 });
      viewport.destroy();
    });
  });
});
