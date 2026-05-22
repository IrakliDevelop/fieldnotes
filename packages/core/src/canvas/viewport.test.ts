/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import { createNote, createText, createStroke, createArrow } from '../elements/element-factory';

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

    it('ignores non-text elements', () => {
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
});
