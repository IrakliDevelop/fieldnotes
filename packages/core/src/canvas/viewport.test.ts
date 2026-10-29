/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import type { PluginConfigureContext, ViewportPlugin } from './viewport';
import type { Tool } from '../tools/types';
import {
  createNote,
  createText,
  createStroke,
  createShape,
  createArrow,
  createHtmlElement,
  createImage,
} from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';
import { renderImage } from '../elements/renderers/image-renderer';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  HtmlElement,
  ImageElement,
} from '../elements/types';
import type { HtmlPaintDiagnostic } from './html-paint-diagnostics';
import { HtmlPainterRegistry } from './html-painter-registry';
import type { ElementActivationEvent } from './element-activation';
import { LEGACY_ACTION_IDS } from '../actions/legacy-action-ids';
import { createTestBoxRegistry } from '../test-helpers/test-box-type';
import { recordingCanvas } from '../test-helpers/recording-canvas';

function wrapperOf(container: HTMLElement): HTMLDivElement {
  const w = container.firstElementChild;
  if (!(w instanceof HTMLDivElement)) throw new Error('viewport wrapper not found');
  return w;
}

function layerCacheOf(viewport: Viewport) {
  return (
    viewport as unknown as {
      layerCache: { getCanvas(id: string): unknown; canvases: Map<string, unknown> };
    }
  ).layerCache;
}

function focusCanvas(container: HTMLElement): void {
  wrapperOf(container).focus();
}

function proxyContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === 'measureText') return () => ({ width: 0 });
      if (
        prop === 'createPattern' ||
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient'
      ) {
        return () => null;
      }
      if (prop === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      }
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
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
    vi.unstubAllGlobals();
  });

  it('sets overscroll-behavior: none on wrapper', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);
    expect(wrapper.style.overscrollBehavior).toBe('none');
    viewport.destroy();
  });

  it('gives the select tool the selectionColor option', () => {
    const viewport = new Viewport(container, { selectionColor: '#B8322A' });
    const selectTool = new SelectTool();
    viewport.toolManager.register(selectTool);
    viewport.toolManager.setTool('select', viewport.toolContext);
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    viewport.store.add(note);
    selectTool.setSelection([note.id]);

    const { ctx, styles } = recordingCanvas();
    selectTool.renderOverlay(ctx);

    expect(styles).toContain('#B8322A');
    expect(styles).not.toContain('#2196F3');
    viewport.destroy();
  });

  it('sets user-select: none on wrapper', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);
    expect(wrapper.style.userSelect).toBe('none');
    viewport.destroy();
  });

  it('creates a wrapper with canvas, paint-stack, and DOM overlay layers', () => {
    const viewport = new Viewport(container);
    const wrapper = wrapperOf(container);
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector('canvas')).not.toBeNull();
    expect(wrapper.children.length).toBe(3);
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

  it('keeps the context-loss mask through base recovery until the real render loop completes a frame', () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return proxyContext(this);
      } as never);
    try {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as {
        background: { invalidate(): void };
        renderLoop: {
          requestRender(): void;
          markAllLayersDirty(): void;
          flush(): void;
        };
      };
      const wrapper = wrapperOf(container);
      const canvas = wrapper.querySelector<HTMLCanvasElement>(':scope > canvas');
      if (!canvas) throw new Error('base canvas not found');
      priv.renderLoop.requestRender();
      priv.renderLoop.flush();
      const invalidate = vi.spyOn(priv.background, 'invalidate');
      const dirty = vi.spyOn(priv.renderLoop, 'markAllLayersDirty');
      const request = vi.spyOn(priv.renderLoop, 'requestRender');

      canvas.dispatchEvent(new Event('contextlost', { cancelable: true }));
      const mask = wrapper.querySelector('[data-fieldnotes-context-loss-mask]');
      expect(mask).not.toBeNull();
      canvas.dispatchEvent(new Event('contextrestored'));
      expect(invalidate).toHaveBeenCalledOnce();
      expect(dirty).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      expect(wrapper.contains(mask)).toBe(true);
      priv.renderLoop.flush();
      expect(wrapper.contains(mask)).toBe(false);

      viewport.destroy();
      canvas.dispatchEvent(new Event('contextlost', { cancelable: true }));
      expect(wrapper.querySelector('[data-fieldnotes-context-loss-mask]')).toBeNull();
    } finally {
      getContext.mockRestore();
    }
  });

  it('recreates and re-watches dynamic hybrid and layer-cache canvases through one recovery mask', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return proxyContext(this);
      } as never);
    try {
      const viewport = new Viewport(container);
      const priv = viewport as unknown as {
        paintStack: HTMLDivElement;
        layerCache: { getCanvas(id: string): HTMLCanvasElement };
        renderLoop: { requestRender(): void; flush(): void };
      };
      const html = document.createElement('div');
      viewport.addHtmlElement(html, { x: 20, y: 20 }, { w: 30, h: 30 });
      viewport.addShape({ position: { x: 20, y: 20 }, size: { w: 30, h: 30 } });
      priv.renderLoop.requestRender();
      priv.renderLoop.flush();
      const hybrid = priv.paintStack.querySelector<HTMLCanvasElement>('canvas[data-paint-order]');
      if (!hybrid) throw new Error('hybrid canvas not created');
      const order = hybrid.dataset['paintOrder'];
      if (!order) throw new Error('hybrid paint order missing');
      const cached = priv.layerCache.getCanvas(viewport.layerManager.activeLayerId);

      hybrid.dispatchEvent(new Event('contextlost', { cancelable: true }));
      cached.dispatchEvent(new Event('contextlost', { cancelable: true }));
      const mask = wrapperOf(container).querySelector('[data-fieldnotes-context-loss-mask]');
      expect(mask).not.toBeNull();
      expect(
        wrapperOf(container).querySelectorAll('[data-fieldnotes-context-loss-mask]'),
      ).toHaveLength(1);
      hybrid.dispatchEvent(new Event('contextrestored'));
      expect(wrapperOf(container).contains(mask)).toBe(true);
      cached.dispatchEvent(new Event('contextrestored'));
      priv.renderLoop.flush();

      const replacement = priv.paintStack.querySelector<HTMLCanvasElement>(
        `canvas[data-paint-order="${order}"]`,
      );
      const replacementCached = priv.layerCache.getCanvas(viewport.layerManager.activeLayerId);
      expect(replacement).not.toBeNull();
      expect(replacement).not.toBe(hybrid);
      expect(replacement?.dataset['paintOrder']).toBe(order);
      expect(replacementCached).not.toBe(cached);

      replacement?.dispatchEvent(new Event('contextlost', { cancelable: true }));
      replacementCached.dispatchEvent(new Event('contextlost', { cancelable: true }));
      expect(
        wrapperOf(container).querySelectorAll('[data-fieldnotes-context-loss-mask]'),
      ).toHaveLength(1);
      expect(wrapperOf(container).querySelector('[data-fieldnotes-context-loss-mask]')).toBe(mask);
      replacement?.dispatchEvent(new Event('contextrestored'));
      replacementCached.dispatchEvent(new Event('contextrestored'));
      priv.renderLoop.flush();
      expect(wrapperOf(container).contains(mask)).toBe(false);
      viewport.destroy();
    } finally {
      getContext.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does not watch opacity scratch or export canvases for context loss', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const listenerTypes = (target: EventTarget): string[] =>
      addListener.mock.calls.flatMap((call, index) =>
        addListener.mock.contexts[index] === target ? [call[0]] : [],
      );
    const created: HTMLCanvasElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(function (
      this: Document,
      tagName: string,
      options?: ElementCreationOptions,
    ) {
      const element = originalCreateElement(tagName, options);
      if (tagName === 'canvas') created.push(element as HTMLCanvasElement);
      return element;
    });
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return proxyContext(this);
      } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['fake'], { type: 'image/png' }));
    });
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,AAAA');
    try {
      const viewport = new Viewport(container);
      const base = wrapperOf(container).querySelector('canvas');
      if (!(base instanceof HTMLCanvasElement)) throw new Error('base canvas not found');
      Object.defineProperties(base, {
        clientWidth: { value: 800, configurable: true },
        clientHeight: { value: 600, configurable: true },
      });
      const priv = viewport as unknown as {
        renderLoop: {
          requestRender(): void;
          flush(): void;
          setCanvasSize(width: number, height: number): void;
          htmlScratchCanvas: HTMLCanvasElement | null;
          hybridActive: boolean;
          firstDomIndex: number;
          layerOpacities: Map<string, number>;
        };
        renderer: { isDomElement(element: HtmlElement): boolean };
      };
      const html = document.createElement('div');
      viewport.addHtmlElement(html, { x: 0, y: 0 }, { w: 30, h: 30 });
      viewport.expectCanvasHtmlTypes(['context-loss-marker']);
      const painter = vi.fn();
      viewport.registerHtmlPainter('context-loss-marker', painter);
      const marker = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 30, h: 30 },
        htmlType: 'context-loss-marker',
        layerId: viewport.layerManager.activeLayerId,
        index: 'zzzz',
      });
      viewport.store.add(marker);
      viewport.layerManager.setLayerOpacity(viewport.layerManager.activeLayerId, 0.5);
      priv.renderLoop.setCanvasSize(800, 600);
      viewport.requestRender();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(priv.renderLoop.hybridActive).toBe(true);
      expect(priv.renderLoop.firstDomIndex).toBe(0);
      expect(priv.renderLoop.layerOpacities.get(viewport.layerManager.activeLayerId)).toBe(0.5);
      expect(priv.renderer.isDomElement(marker)).toBe(false);
      expect(painter).toHaveBeenCalledOnce();
      const scratch = priv.renderLoop.htmlScratchCanvas;
      expect(scratch).not.toBeNull();
      expect(listenerTypes(scratch as HTMLCanvasElement)).not.toContain('contextlost');
      expect(listenerTypes(scratch as HTMLCanvasElement)).not.toContain('contextrestored');

      created.length = 0;
      await viewport.exportImage();
      expect(created.length).toBeGreaterThan(0);
      for (const canvas of created) {
        expect(listenerTypes(canvas)).not.toContain('contextlost');
        expect(listenerTypes(canvas)).not.toContain('contextrestored');
      }
      created.length = 0;
      await viewport.exportSVG();
      expect(created.length).toBeGreaterThan(0);
      for (const canvas of created) {
        expect(listenerTypes(canvas)).not.toContain('contextlost');
        expect(listenerTypes(canvas)).not.toContain('contextrestored');
      }
      viewport.destroy();
    } finally {
      toDataURL.mockRestore();
      toBlob.mockRestore();
      getContext.mockRestore();
      createElement.mockRestore();
      addListener.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('destroy twice is a no-op', () => {
    const dispose = vi.fn();
    const viewport = new Viewport(container, {
      plugins: [{ name: 'p', start: () => ({ dispose }) }],
    });
    const remove = vi.spyOn(wrapperOf(container), 'remove');

    viewport.destroy();
    viewport.destroy();

    expect(dispose).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('drops the layer cache entry of a removed layer', () => {
    const viewport = new Viewport(container);
    const layerCache = layerCacheOf(viewport);
    const layer = viewport.layerManager.createLayer('extra');
    layerCache.getCanvas(layer.id);
    viewport.removeLayer(layer.id);
    expect(layerCache.canvases.has(layer.id)).toBe(false);
    viewport.destroy();
  });

  it('drops layer cache entries of layers replaced by a state load', () => {
    const viewport = new Viewport(container);
    const layerCache = layerCacheOf(viewport);
    const saved = viewport.exportState();
    const layer = viewport.layerManager.createLayer('extra');
    layerCache.getCanvas(layer.id);
    viewport.loadState(saved);
    expect(layerCache.canvases.has(layer.id)).toBe(false);
    viewport.destroy();
  });

  it('destroy releases layer, paint-stack, and image caches, closing bitmaps once', () => {
    const viewport = new Viewport(container);
    const priv = viewport as unknown as {
      layerCache: { getCanvas(id: string): unknown; canvases: Map<string, unknown> };
      hybridSurface: { beginFrame(orders: Set<number>, w: number, h: number): void };
      renderer: { imageCache: Map<string, unknown> };
    };
    const wrapper = wrapperOf(container);
    priv.layerCache.getCanvas('some-layer');
    priv.hybridSurface.beginFrame(new Set([1]), 10, 10);
    const bitmap = { close: vi.fn() };
    priv.renderer.imageCache.set('bitmap.png', bitmap);
    priv.renderer.imageCache.set('pending.png', new Image());
    priv.renderer.imageCache.set('broken.png', 'failed');

    viewport.destroy();
    viewport.destroy();

    expect(priv.layerCache.canvases.size).toBe(0);
    expect(wrapper.querySelector('[data-paint-order]')).toBeNull();
    expect(priv.renderer.imageCache.size).toBe(0);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('sizes the canvas backing store from client size, not the transformed rect', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const scaled = document.createElement('div');
    Object.defineProperties(scaled, {
      getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    document.body.appendChild(scaled);
    const viewport = new Viewport(scaled);
    const canvas = scaled.querySelector('canvas');
    expect([canvas?.width, canvas?.height]).toEqual([1600, 1200]);
    viewport.destroy();
    scaled.remove();
  });

  it('applies camera transform to the public DOM overlay on camera change', () => {
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

  it('addHtmlElement with an external origin records no undo step and stamps transient', () => {
    const viewport = new Viewport(container);
    viewport.history.clear();
    const origins: (string | undefined)[] = [];
    viewport.store.on('add', (_el, meta) => origins.push(meta.origin));
    const dom = document.createElement('div');

    const id = viewport.addHtmlElement(
      dom,
      { x: 0, y: 0 },
      { w: 100, h: 100 },
      { transient: true, origin: 'host' },
    );

    expect(viewport.history.undoCount).toBe(0);
    const el = viewport.store.getById(id);
    expect(el?.type === 'html' && el.transient).toBe(true);
    expect(origins).toEqual(['host']);
    viewport.destroy();
  });

  it('addHtmlElement without opts still records one undo step', () => {
    const viewport = new Viewport(container);
    viewport.history.clear();
    const dom = document.createElement('div');

    viewport.addHtmlElement(dom, { x: 0, y: 0 });

    expect(viewport.history.undoCount).toBe(1);
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
      const captured: { onload: (() => void) | null } = { onload: null };
      const OrigFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        result: unknown = 'data:image/png;base64,abc';
        readAsDataURL = vi.fn();
        set onload(fn: (() => void) | null) {
          captured.onload = fn;
        }
      } as unknown as typeof FileReader;

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [mockFile] },
        clientX: 100,
        clientY: 100,
      };
      priv.onDrop(mockEvent);

      if (captured.onload) {
        captured.onload();
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
      const captured: { onload: (() => void) | null } = { onload: null };
      const OrigFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        result: unknown = new ArrayBuffer(0);
        readAsDataURL = vi.fn();
        set onload(fn: (() => void) | null) {
          captured.onload = fn;
        }
      } as unknown as typeof FileReader;

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [mockFile] },
        clientX: 100,
        clientY: 100,
      };
      priv.onDrop(mockEvent);
      if (captured.onload) {
        captured.onload();
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

    it('a remote removal unbinds arrows with the same meta and records no undo step', () => {
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
      viewport.history.clear();

      const seen: (string | undefined)[] = [];
      viewport.store.on('update', (_data, meta) => seen.push(meta.origin));

      viewport.store.remove(note.id, { origin: 'remote' });

      const updated = viewport.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.fromBinding).toBeUndefined();
      }
      expect(seen).toEqual(['remote']);
      expect(viewport.history.undoCount).toBe(0);
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
    describe('public transactions', () => {
      it('groups multiple store mutations into one undo step and returns the callback result', () => {
        const viewport = new Viewport(container);
        const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, index: 'a0' });
        const b = createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 }, index: 'a0' });
        viewport.store.add(a);
        viewport.store.add(b);
        viewport.history.clear();

        const result = viewport.transaction(() => {
          viewport.store.remove(a.id);
          viewport.store.remove(b.id);
          return 'removed';
        });

        expect(result).toBe('removed');
        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.store.count).toBe(0);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(a.id)).toEqual(a);
        expect(viewport.store.getById(b.id)).toEqual(b);
        expect(viewport.undo()).toBe(false);
        viewport.destroy();
      });

      it('keeps nested transactions in the outer transaction', () => {
        const viewport = new Viewport(container);
        const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
        const b = createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 } });
        viewport.history.clear();

        viewport.transaction(() => {
          viewport.store.add(a);
          viewport.transaction(() => viewport.store.add(b));
        });

        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.count).toBe(0);
        viewport.destroy();
      });

      it.each([
        ['applyStyleToSelection', (v: Viewport) => v.applyStyleToSelection({ color: '#ff0000' })],
        ['groupSelection', (v: Viewport) => v.groupSelection()],
      ])('a host transaction wrapping addShape and %s is one undo step', (_name, action) => {
        const viewport = new Viewport(container);
        const selectTool = new SelectTool();
        viewport.toolManager.register(selectTool);
        viewport.history.clear();

        viewport.transaction(() => {
          const a = viewport.addShape({ position: { x: 0, y: 0 } });
          const b = viewport.addShape({ position: { x: 200, y: 0 } });
          selectTool.setSelection([a, b]);
          action(viewport);
        });

        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.count).toBe(0);
        viewport.destroy();
      });

      it('commits mutations for undo before rethrowing a callback error', () => {
        const viewport = new Viewport(container);
        const shape = createShape({
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
          index: 'a0',
        });
        viewport.history.clear();

        expect(() =>
          viewport.transaction(() => {
            viewport.store.add(shape);
            throw new Error('consumer failed');
          }),
        ).toThrow('consumer failed');

        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.store.getById(shape.id)).toEqual(shape);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(shape.id)).toBeUndefined();
        viewport.destroy();
      });

      it('removeElements ignores missing and duplicate ids and records one undo step', () => {
        const viewport = new Viewport(container);
        const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, index: 'a0' });
        const b = createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 }, index: 'a0' });
        viewport.store.add(a);
        viewport.store.add(b);
        viewport.history.clear();

        expect(viewport.removeElements([a.id, 'missing', a.id, b.id])).toBe(2);
        expect(viewport.store.count).toBe(0);
        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(a.id)).toEqual(a);
        expect(viewport.store.getById(b.id)).toEqual(b);
        viewport.destroy();
      });

      it('removeElements is a history no-op when no ids exist', () => {
        const viewport = new Viewport(container);
        viewport.history.clear();

        expect(viewport.removeElements(['missing'])).toBe(0);
        expect(viewport.history.undoCount).toBe(0);
        viewport.destroy();
      });

      it('removeElements expands a parent through descendants in child-first order', () => {
        const viewport = new Viewport(container);
        const parent = {
          ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, index: 'a0' }),
          id: 'parent',
        };
        const child = {
          ...createShape({
            position: { x: 2, y: 2 },
            size: { w: 5, h: 5 },
            index: 'a1',
            parentId: parent.id,
          }),
          id: 'child',
        };
        viewport.store.add(parent);
        viewport.store.add(child);
        viewport.history.clear();
        const removed: string[] = [];
        viewport.store.on('remove', (element) => removed.push(element.id));

        expect(viewport.removeElements([parent.id, child.id, 'missing'])).toBe(2);
        expect(removed).toEqual(['child', 'parent']);
        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getAll().map((element) => element.id)).toEqual(['parent', 'child']);
        viewport.destroy();
      });
    });

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

    it.each([
      ['alignSelection', (v: Viewport) => v.alignSelection('left')],
      ['addShape', (v: Viewport) => void v.addShape({ position: { x: 500, y: 500 } })],
    ])('%s during a pending nudge is a separate undo step', (_name, action) => {
      vi.useFakeTimers();
      const viewport = new Viewport(container);
      const selectTool = new SelectTool();
      viewport.toolManager.register(selectTool);
      viewport.toolManager.setTool('select', viewport.toolContext);
      const layerId = viewport.layerManager.activeLayerId;
      const a = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 }, layerId });
      const b = createNote({ position: { x: 300, y: 300 }, size: { w: 100, h: 50 }, layerId });
      viewport.store.add(a);
      viewport.store.add(b);
      viewport.history.clear();
      selectTool.setSelection([a.id, b.id]);
      focusCanvas(container);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      action(viewport);

      expect(viewport.history.undoCount).toBe(2);
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
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      const viewport = new Viewport(container, { panBufferMargin: 0 });
      const mv = (viewport as unknown as { marginViewport: { physicalWidth: () => number } })
        .marginViewport;
      // cssW = 800 (container clientWidth), dpr = 1, margin = 0
      expect(mv.physicalWidth()).toBe(800);
      viewport.destroy();
    });

    it('defaults panBufferMargin to 256', () => {
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      const viewport = new Viewport(container);
      const mv = (viewport as unknown as { marginViewport: { physicalWidth: () => number } })
        .marginViewport;
      // cssW = 800, dpr = 1, margin = 256 → 800 + 2*256 = 1312
      expect(mv.physicalWidth()).toBe(1312);
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

    it('keeps host-mounted content alive across a painter register/unregister round trip', () => {
      // The host wires live content straight into the node the callback hands it; nothing
      // records that content anywhere. A painter registering for the htmlType detaches the
      // node, and unregistering routes it back to the DOM — the ORIGINAL content must come
      // back, not a fresh empty node.
      const vp = new Viewport(container);
      const el = createHtmlElement({
        position: { x: 10, y: 20 },
        size: { w: 200, h: 150 },
        htmlType: 'chart',
        layerId: vp.layerManager.activeLayerId,
      });
      vp.store.add(el);
      const state = vp.exportState();
      vp.destroy();

      const vp2 = new Viewport(container, {
        onHtmlElementMount: (_id, _domId, node) => {
          const live = document.createElement('div');
          live.dataset['host'] = 'live-chart';
          live.textContent = 'host content';
          node.appendChild(live);
        },
      });
      vp2.loadState(state);
      const paintStack = (vp2 as unknown as { paintStack: HTMLDivElement }).paintStack;
      const mountedNode = (): Element | null =>
        paintStack.querySelector(`[data-element-id="${el.id}"]`);
      expect(mountedNode()?.querySelector('[data-host="live-chart"]')?.textContent).toBe(
        'host content',
      );

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const unregister = vp2.registerHtmlPainter('chart', () => {});
      expect(mountedNode()).toBeNull(); // canvas-routed: node detached

      unregister();
      expect(mountedNode()?.querySelector('[data-host="live-chart"]')?.textContent).toBe(
        'host content',
      );

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
    it('frames extension elements with the viewport element registry bounds', () => {
      const elementRegistry = createTestBoxRegistry({ w: 200, h: 100 });
      const viewport = new Viewport(container, { elementRegistry });
      const wrapper = wrapperOf(container);
      Object.defineProperty(wrapper, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(wrapper, 'clientHeight', { value: 600, configurable: true });
      viewport.store.add({
        id: 'box',
        type: 'extension',
        extensionType: 'test:box',
        position: { x: 1000, y: 1000 },
        index: 'a0',
        version: 1,
        locked: false,
        layerId: viewport.layerManager.activeLayerId,
        data: {},
      });

      viewport.fitToContent();

      const cam = viewport.camera;
      expect(cam.position.x + 1100 * cam.zoom).toBeCloseTo(400, 0);
      expect(cam.position.y + 1050 * cam.zoom).toBeCloseTo(300, 0);
      viewport.destroy();
    });

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
      expect(viewport.shortcuts.getBindings()['edit.duplicate']).toEqual(['mod+shift+d']);
      viewport.shortcuts.rebind('edit.undo', 'mod+u');
      expect(viewport.shortcuts.getBindings()['edit.undo']).toEqual(['mod+u']);
      viewport.shortcuts.disable('edit.copy');
      expect(viewport.shortcuts.getBindings()['edit.copy']).toEqual([]);
      viewport.shortcuts.reset();
      expect(viewport.shortcuts.getBindings()['edit.undo']).toEqual(['mod+z']);
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

    function twoImageLayers(viewport: Viewport) {
      const layerA = viewport.layerManager.activeLayerId;
      const layerB = viewport.layerManager.createLayer('B').id;
      const size = { w: 10, h: 10 };
      viewport.store.add(
        createImage({ src: 'a.png', position: { x: 0, y: 0 }, size, layerId: layerA }),
      );
      viewport.store.add(
        createImage({ src: 'b.png', position: { x: 0, y: 0 }, size, layerId: layerB }),
      );
      const layerCache = (
        viewport as unknown as {
          layerCache: { markClean(id: string): void; isDirty(id: string): boolean };
        }
      ).layerCache;
      layerCache.markClean(layerA);
      layerCache.markClean(layerB);
      return { layerA, layerB, layerCache };
    }

    it.each(['load', 'error'] as const)(
      'an image %s marks dirty only layers holding an image with that src',
      (outcome) => {
        const viewport = new Viewport(container);
        const { layerA, layerB, layerCache } = twoImageLayers(viewport);
        loadImage(viewport, 'a.png');
        const img = (
          viewport as unknown as { renderer: { imageCache: Map<string, unknown> } }
        ).renderer.imageCache.get('a.png');
        if (!(img instanceof HTMLImageElement)) throw new Error('expected a pending image');

        if (outcome === 'load') img.onload?.(new Event('load'));
        else img.onerror?.(new Event('error') as never);

        expect([layerCache.isDirty(layerA), layerCache.isDirty(layerB)]).toEqual([true, false]);
        viewport.destroy();
      },
    );
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

    it('applyStyleToSelection sets strokeStyle on arrows only, in ONE undo step', () => {
      const arrow = createArrow({
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        position: { x: 0, y: 0 },
      });
      const note = createNote({ position: { x: 0, y: 0 }, text: 'hi' });
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
      viewport.store.add(arrow);
      viewport.store.add(note);
      viewport.store.add(shape);
      select([arrow.id, note.id, shape.id]);

      const before = viewport.history.undoCount;
      viewport.applyStyleToSelection({ strokeStyle: 'dashed' });

      expect((viewport.store.getById(arrow.id) as { strokeStyle?: string }).strokeStyle).toBe(
        'dashed',
      );
      expect(
        (viewport.store.getById(note.id) as { strokeStyle?: string }).strokeStyle,
      ).toBeUndefined();
      expect(
        (viewport.store.getById(shape.id) as { strokeStyle?: string }).strokeStyle,
      ).toBeUndefined();
      expect(viewport.history.undoCount).toBe(before + 1);
    });

    it('getSelectionStyle surfaces a selected arrow strokeStyle', () => {
      const arrow = createArrow({
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        position: { x: 0, y: 0 },
        strokeStyle: 'dotted',
      });
      viewport.store.add(arrow);
      select([arrow.id]);
      expect(viewport.getSelectionStyle()?.strokeStyle).toBe('dotted');
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

    it('no-ops alignment when a locked root leaves fewer than two eligible roots', () => {
      const a = createNote({ position: { x: 0, y: 0 }, text: 'a' });
      a.size = { w: 10, h: 10 };
      a.locked = true;
      const b = createNote({ position: { x: 50, y: 0 }, text: 'b' });
      b.size = { w: 10, h: 10 };
      viewport.store.add(a);
      viewport.store.add(b);
      const before = viewport.history.undoCount;
      const storedA = viewport.store.getById(a.id);
      const storedB = viewport.store.getById(b.id);
      selectAll([a.id, b.id]);
      viewport.alignSelection('left');
      expect(viewport.store.getById(a.id)).toEqual(storedA);
      expect(viewport.store.getById(b.id)).toEqual(storedB);
      expect(viewport.history.undoCount).toBe(before);
    });
  });

  describe('rotateSelection', () => {
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

    it('rotates the selected element 90° clockwise', () => {
      const a = createShape({
        position: { x: 0, y: 0 },
        size: { w: 20, h: 20 },
        shape: 'rectangle',
      });
      viewport.store.add(a);
      selectAll([a.id]);

      viewport.rotateSelection('cw');

      expect(viewport.store.getById(a.id)?.rotation).toBeCloseTo(Math.PI / 2);
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

    it.each([
      [undefined, 'rgb(33, 150, 243)'],
      ['#B8322A', 'rgb(184, 50, 42)'],
    ])('borders the label input in selectionColor %s', (selectionColor, expected) => {
      const viewport = new Viewport(container, { selectionColor });
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      viewport.store.add(arrow);
      const priv = (
        viewport as unknown as { interactions: { startArrowLabelEdit: (a: typeof arrow) => void } }
      ).interactions;
      priv.startArrowLabelEdit(arrow);
      expect(viewport.domLayer.querySelector('input')?.style.borderColor).toBe(expected);
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
      expect(updated?.type === 'note' && updated.size.h).toBe(200);
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
      viewport.runAction('edit.delete');
      expect(viewport.store.getById(a.id)).toBeUndefined();
      viewport.destroy();
    });

    it('runAction accepts legacy ids', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
        index: 'a0',
        version: 1,
      });
      const b = createNote({
        position: { x: 100, y: 0 },
        text: 'b',
        layerId: viewport.layerManager.activeLayerId,
        index: 'a1',
        version: 1,
      });
      viewport.store.add(a);
      viewport.store.add(b);
      select([a.id]);
      viewport.runAction('z-front');
      expect(viewport.store.getAll().map((el) => el.id)).toEqual([b.id, a.id]);
      viewport.destroy();
    });

    it('viewport.actions.list() contains the 31 built-ins followed by tool.* for every registered tool, and shortcuts.getBindings() has canonical keys only', () => {
      const viewport = new Viewport(container);
      setupSelect(viewport);
      const list = viewport.actions.list();
      // 31 built-ins + tool.select (registered by setupSelect)
      const builtins = list.filter((a) => !a.id.startsWith('tool.'));
      expect(builtins).toHaveLength(31);
      const tools = list.filter((a) => a.id.startsWith('tool.'));
      expect(tools.some((t) => t.id === 'tool.select')).toBe(true);
      // getBindings has only canonical keys (every key contains '.')
      const bindings = viewport.shortcuts.getBindings();
      const bindingKeys = Object.keys(bindings);
      for (const key of bindingKeys) {
        expect(key).toContain('.');
      }
      // None of the 28 legacy ids is present
      for (const legacyId of Object.keys(LEGACY_ACTION_IDS)) {
        expect(bindingKeys).not.toContain(legacyId);
      }
      viewport.destroy();
    });

    it('ViewportOptions.shortcuts.bindings with a legacy key rebinds the canonical id', () => {
      const viewport = new Viewport(container, {
        shortcuts: { bindings: { undo: 'mod+u' } },
      });
      const bindings = viewport.shortcuts.getBindings();
      expect(bindings['edit.undo']).toEqual(['mod+u']);
      expect(bindings['undo']).toBeUndefined();
      viewport.destroy();
    });

    it('a plugin tool registered via configure gets a tool.<name> action; the action reports disabled after the plugin is disposed', () => {
      const plugin = {
        name: 'test-plugin',
        configure: (ctx: PluginConfigureContext) => {
          ctx.registerTool({
            name: 'custom-tool',
            onPointerDown() {
              /* noop */
            },
            onPointerMove() {
              /* noop */
            },
            onPointerUp() {
              /* noop */
            },
          });
          // Throw to trigger rollback of the tool registration
          throw new Error('intentional plugin failure');
        },
      };
      const viewport = new Viewport(container, { plugins: [plugin] });
      // Tool action was created during onRegister
      const action = viewport.actions.get('tool.custom-tool');
      expect(action).toBeDefined();
      // But the tool was rolled back, so the action is disabled
      expect(viewport.actions.isEnabled('tool.custom-tool')).toBe(false);
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
      viewport.runAction('edit.copy');
      expect(viewport.canPaste()).toBe(true);
      viewport.destroy();
    });

    function menuLabels(): string[] {
      return Array.from(document.querySelectorAll('.fieldnotes-context-menu-item')).map(
        (el) => el.textContent ?? '',
      );
    }

    /** Returns label strings for buttons and '---' for separator divs. */
    function menuEntries(): string[] {
      const root = document.querySelector('.fieldnotes-context-menu');
      if (!root) return [];
      return Array.from(root.children).map((el) => {
        if (el.getAttribute('role') === 'separator') return '---';
        return el.textContent ?? '';
      });
    }

    it('with a selection the menu includes frame selection after the z-order items', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      // Copy to fill clipboard so Paste is visible
      viewport.runAction('edit.copy');
      viewport.openContextMenu({ x: 5, y: 5 });
      expect(menuEntries()).toEqual([
        'Cut',
        'Copy',
        'Paste',
        'Duplicate',
        'Delete',
        '---',
        'Bring to Front',
        'Bring Forward',
        'Send Backward',
        'Send to Back',
        'Frame selection',
        '---',
        'Rotate 90° CW',
        'Rotate 90° CCW',
        '---',
        'Lock',
      ]);
      viewport.destroy();
    });

    it('with a selection and no clipboard, Paste is absent', () => {
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
      expect(labels).not.toContain('Paste');
      expect(labels).toContain('Cut');
      expect(labels).toContain('Delete');
      viewport.destroy();
    });

    it('empty canvas with clipboard shows only Paste; without clipboard does not open', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);

      // Empty canvas, no clipboard → no menu
      viewport.openContextMenu({ x: 5, y: 5 });
      expect(document.querySelector('.fieldnotes-context-menu')).toBeNull();

      // Copy an element to fill the clipboard, then deselect
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      viewport.runAction('edit.copy');
      select([]);
      viewport.openContextMenu({ x: 5, y: 5 });
      expect(menuLabels()).toEqual(['Paste']);
      viewport.destroy();
    });

    it('clicking an item runs the action with source menu', () => {
      const viewport = new Viewport(container);
      const select = setupSelect(viewport);
      const a = createNote({
        position: { x: 0, y: 0 },
        text: 'a',
        layerId: viewport.layerManager.activeLayerId,
      });
      viewport.store.add(a);
      select([a.id]);
      const runSpy = vi.spyOn(viewport.actions, 'run');
      viewport.openContextMenu({ x: 5, y: 5 });
      // Click the first button (Cut)
      const firstButton = document.querySelector('.fieldnotes-context-menu-item') as HTMLElement;
      firstButton.click();
      expect(runSpy).toHaveBeenCalledWith('edit.cut', { source: 'menu' });
      runSpy.mockRestore();
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

  describe('minimap', () => {
    function minimapCanvas(wrapper: HTMLDivElement): HTMLCanvasElement | undefined {
      return Array.from(wrapper.querySelectorAll('canvas')).find(
        (c) => c.style.position === 'absolute' && c.style.bottom !== '',
      );
    }

    it('adds a minimap canvas to the wrapper when minimap: true', () => {
      const viewport = new Viewport(container, { minimap: true });
      const wrapper = wrapperOf(container);
      expect(wrapper.querySelectorAll('canvas').length).toBe(2);
      expect(minimapCanvas(wrapper)).toBeDefined();
      viewport.destroy();
    });

    it('does not add a minimap by default', () => {
      const viewport = new Viewport(container);
      const wrapper = wrapperOf(container);
      expect(wrapper.querySelectorAll('canvas').length).toBe(1);
      expect(minimapCanvas(wrapper)).toBeUndefined();
      viewport.destroy();
    });

    it('survives element add + camera pan (smoke)', () => {
      const viewport = new Viewport(container, { minimap: true });
      const wrapper = wrapperOf(container);
      expect(() => {
        viewport.store.add(
          createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, text: 'hi' }),
        );
        viewport.camera.pan(120, 90);
      }).not.toThrow();
      expect(minimapCanvas(wrapper)).toBeDefined();
      viewport.destroy();
    });

    it('removes the minimap canvas on destroy', () => {
      const viewport = new Viewport(container, { minimap: true });
      const wrapper = wrapperOf(container);
      expect(minimapCanvas(wrapper)).toBeDefined();
      viewport.destroy();
      expect(minimapCanvas(wrapper)).toBeUndefined();
    });

    // Repaint-on-layer-change coverage now lives in MinimapController's own
    // tests (it self-subscribes to layerManager 'change' via the same
    // debounced-render path exercised there for store add/remove/update) —
    // Viewport no longer drives the minimap's redraw explicitly.
  });

  describe('viewport public camera/viewport surface', () => {
    it('getVisibleRect delegates to camera with the canvas dimensions', () => {
      const vp = new Viewport(container);
      const rect = vp.getVisibleRect();
      // jsdom canvas is 0×0 → rect equals camera.getVisibleRect(0, 0)
      expect(rect).toEqual(vp.camera.getVisibleRect(0, 0));
      vp.destroy();
    });

    it('centerCameraAt moves the camera so the world point maps to the canvas center', () => {
      const vp = new Viewport(container);
      vp.camera.setZoom(2);
      vp.centerCameraAt({ x: 30, y: 40 });
      // moveTo(clientWidth/2 - 30*2, clientHeight/2 - 40*2); jsdom dims are 0
      expect(vp.camera.position).toEqual({ x: -60, y: -80 });
      vp.destroy();
    });

    it('syncCanvasSize keeps the canvas buffer at least 1x1 for a zero-height container', () => {
      const collapsed = document.createElement('div');
      Object.defineProperty(collapsed, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 800, height: 0 }),
      });
      document.body.appendChild(collapsed);
      const vp = new Viewport(collapsed);
      try {
        (vp as unknown as { syncCanvasSize(): void }).syncCanvasSize();
        const canvas = collapsed.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas not found');
        expect(canvas.width).toBeGreaterThanOrEqual(1);
        expect(canvas.height).toBeGreaterThanOrEqual(1);
      } finally {
        vp.destroy();
        document.body.removeChild(collapsed);
      }
    });

    it('onResize notifies after syncCanvasSize and unsubscribes cleanly', () => {
      const vp = new Viewport(container);
      const listener = vi.fn();
      const unsub = vp.onResize(listener);
      // syncCanvasSize is private; trigger through the same path the ResizeObserver uses.
      (vp as unknown as { syncCanvasSize(): void }).syncCanvasSize();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      (vp as unknown as { syncCanvasSize(): void }).syncCanvasSize();
      expect(listener).toHaveBeenCalledTimes(1);
      vp.destroy();
    });
  });

  describe('getCanvasSize', () => {
    it('returns the canvas element dimensions', () => {
      const vp = new Viewport(container);
      const canvas = container.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas not found');
      Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
      expect(vp.getCanvasSize()).toEqual({ w: 800, h: 600 });
      vp.destroy();
    });

    it('agrees with getVisibleRect scaled by zoom at several zoom levels', () => {
      const vp = new Viewport(container);
      const canvas = container.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas not found');
      // Stub the canvas and wrapper to different non-zero sizes so this test
      // actually discriminates which element getCanvasSize()/getVisibleRect()
      // measure. Without this, jsdom reports clientWidth/clientHeight as 0 for
      // every element, both accessors collapse to {w:0,h:0}, and the
      // assertions below hold vacuously regardless of which element is read.
      Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
      const wrapper = wrapperOf(container);
      Object.defineProperty(wrapper, 'clientWidth', { value: 1024, configurable: true });
      Object.defineProperty(wrapper, 'clientHeight', { value: 768, configurable: true });
      for (const zoom of [0.5, 1, 2.5]) {
        vp.camera.setZoom(zoom);
        const size = vp.getCanvasSize();
        const visible = vp.getVisibleRect();
        expect(visible.w * vp.camera.zoom).toBeCloseTo(size.w, 6);
        expect(visible.h * vp.camera.zoom).toBeCloseTo(size.h, 6);
      }
      vp.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// Viewport html painters (Task A5)
//
// jsdom ships no real 2D canvas backend (no `canvas` npm package installed in
// this repo), so `HTMLCanvasElement.getContext('2d')` normally returns null
// and RenderLoop.render() bails out at its first line. A Proxy-based context
// stub (any method -> no-op, any property settable) is installed for this
// block only, so Viewport's REAL render loop — Background, LayerCache offscreen
// canvases, HybridRenderSurface, ElementRenderer — can run end to end without
// throwing, exercising the actual painter-invocation and DOM-node-reconciliation
// paths rather than a mocked stand-in for them.
// ---------------------------------------------------------------------------
describe('Viewport html painters', () => {
  function makeStubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const state: Record<string, unknown> = { canvas };
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (prop === 'measureText') return () => ({ width: 0 });
        if (
          prop === 'createPattern' ||
          prop === 'createLinearGradient' ||
          prop === 'createRadialGradient'
        ) {
          return () => null;
        }
        if (prop === 'getImageData') {
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        }
        return () => undefined;
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    };
    return new Proxy(state, handler) as unknown as CanvasRenderingContext2D;
  }

  let getContextSpy: ReturnType<typeof vi.spyOn>;
  const created: { vp: Viewport; container: HTMLDivElement }[] = [];

  beforeEach(() => {
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return makeStubContext(this);
      } as never);
  });

  afterEach(() => {
    while (created.length > 0) {
      const entry = created.pop();
      entry?.vp.destroy();
      entry?.container.remove();
    }
    getContextSpy.mockRestore();
  });

  function makeViewport(options?: ConstructorParameters<typeof Viewport>[1]): Viewport {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    document.body.appendChild(container);
    const vp = new Viewport(container, options);
    const canvas = container.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas not found');
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
    created.push({ vp, container });
    return vp;
  }

  function markerElement(): HtmlElement {
    return createHtmlElement({
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'rk-marker',
    });
  }

  // Real requestAnimationFrame (not faked): the Viewport's own RAF-driven render
  // loop already has a pending frame from construction, registered before this
  // call, so a single further rAF tick lands after that pending frame runs.
  async function nextFrame(_vp: Viewport): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  // DomNodeManager mounts synced nodes into the private `paintStack` layer, not
  // the public `domLayer` (which carries unrelated overlays such as the note
  // toolbar). Reached via cast rather than a new accessor, matching this file's
  // existing `(viewport as unknown as {...}).domNodeManager` convention.
  function paintStackOf(vp: Viewport): HTMLDivElement {
    return (vp as unknown as { paintStack: HTMLDivElement }).paintStack;
  }

  it("getHtmlPainters returns the viewport's own live registry", () => {
    const vp = makeViewport();
    const painter = vi.fn();
    // A painter registered via the viewport's own registerHtmlPainter(...)
    // must be visible through the registry getHtmlPainters() hands out --
    // proving it is the SAME instance the viewport routes elements through,
    // not a copy or a freshly constructed one.
    const unregister = vp.registerHtmlPainter('rk-marker', painter);
    const registry = vp.getHtmlPainters();
    expect(registry.getActivePainter('rk-marker')).toBe(painter);
    // Repeated calls return the identical instance, not a new wrapper each time.
    expect(vp.getHtmlPainters()).toBe(registry);
    unregister();
  });

  it('paints a registered marker on the next frame with no DOM node created', async () => {
    const vp = makeViewport();
    const painter = vi.fn();
    vp.expectCanvasHtmlTypes(['rk-marker']);
    vp.registerHtmlPainter('rk-marker', painter);
    const marker = markerElement();
    vp.store.add(marker);
    // Control element: an html element whose htmlType nobody claims stays DOM-routed and
    // DOES get a node in this very frame. Without it the "no node for the marker"
    // assertion would hold vacuously — the marker has no stored content either way.
    const domEmbed = createHtmlElement({
      position: { x: 0, y: 0 },
      size: { w: 50, h: 50 },
      htmlType: 'legacy-embed',
    });
    vp.store.add(domEmbed);

    await nextFrame(vp);

    expect(painter).toHaveBeenCalled();
    expect(paintStackOf(vp).querySelector(`[data-element-id="${domEmbed.id}"]`)).not.toBeNull();
    expect(paintStackOf(vp).querySelector(`[data-element-id="${marker.id}"]`)).toBeNull();
  });

  it('hands the painter globalAlpha 1 on a translucent layer, hybrid path included', async () => {
    // Every other surface (cached-layer composite, minimap, both exports) paints html at
    // globalAlpha 1 and applies layer opacity to the RESULT. The hybrid screen path must
    // agree, or adding an unrelated note (which is what flips the frame into hybrid mode)
    // silently changes a marker's on-screen opacity and screen stops matching the export.
    const vp = makeViewport();
    const layerId = vp.layerManager.activeLayerId;
    const seen: unknown[] = [];
    vp.expectCanvasHtmlTypes(['rk-marker']);
    vp.registerHtmlPainter('rk-marker', ({ ctx }) => {
      seen.push(ctx.globalAlpha);
    });
    // A DOM-routed element FIRST, then the marker: that ordering is what makes the frame
    // hybrid and moves the marker onto the hybrid surface instead of a cached layer.
    vp.store.add(
      createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, text: 'note', layerId }),
    );
    const marker = markerElement();
    vp.store.add({ ...marker, layerId });
    vp.layerManager.setLayerOpacity(layerId, 0.5);

    await nextFrame(vp);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(seen.map(() => 1));
  });

  it('repaints elements that already existed when the painter registers later', async () => {
    const vp = makeViewport();
    vp.store.add(markerElement());
    await nextFrame(vp);
    const painter = vi.fn();
    vp.expectCanvasHtmlTypes(['rk-marker']);
    vp.registerHtmlPainter('rk-marker', painter);
    await nextFrame(vp);
    expect(painter).toHaveBeenCalled();
  });

  it('detaches an existing DOM node synchronously when a painter registers', () => {
    const vp = makeViewport();
    const el = markerElement();
    vp.store.add(el);
    vp.updateHtmlElement(el.id, document.createElement('span'));
    // Content mounts synchronously (no render pass has run): without this, the final
    // assertion below would hold vacuously whether or not registration ever detaches
    // anything, since there would never have been a node to begin with.
    expect(paintStackOf(vp).querySelector(`[data-element-id="${el.id}"]`)).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    vp.registerHtmlPainter('rk-marker', () => {});
    expect(paintStackOf(vp).querySelector(`[data-element-id="${el.id}"]`)).toBeNull();
  });

  it('forwards missing-painter diagnostics to onHtmlPaintDiagnostic', async () => {
    const vp = makeViewport();
    const sink = vi.fn<(d: HtmlPaintDiagnostic) => void>();
    vp.onHtmlPaintDiagnostic(sink);
    vp.expectCanvasHtmlTypes(['rk-marker']);
    vp.store.add(markerElement());
    await nextFrame(vp);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'missing-painter' }));
  });

  it('clears diagnostic dedupe state when the element is removed', async () => {
    const vp = makeViewport();
    const sink = vi.fn<(d: HtmlPaintDiagnostic) => void>();
    vp.onHtmlPaintDiagnostic(sink);
    vp.expectCanvasHtmlTypes(['rk-marker']);
    const el = markerElement();
    vp.store.add(el);
    await nextFrame(vp);
    vp.store.remove(el.id);
    vp.store.add(el);
    await nextFrame(vp);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('re-emits missing-painter diagnostics after loadState reloads the same document', async () => {
    const vp = makeViewport();
    const sink = vi.fn<(d: HtmlPaintDiagnostic) => void>();
    vp.onHtmlPaintDiagnostic(sink);
    vp.expectCanvasHtmlTypes(['rk-marker']);
    const el = markerElement();
    vp.store.add(el);
    await nextFrame(vp);
    expect(sink).toHaveBeenCalledTimes(1);

    // Reload the identical document through the same public path a host uses
    // (loadState/loadJSON). ElementStore.clear()/loadSnapshot() emit a single
    // 'clear' event with no per-element 'remove' events, so the dedupe state
    // keyed on this element's id must be reset independently of 'remove'.
    const state = vp.exportState();
    vp.loadState(state);
    await nextFrame(vp);

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('leaves no node and no empty stratum behind for a canvas-routed marker', async () => {
    const vp = makeViewport();
    const el = markerElement();
    vp.store.add(el);
    vp.updateHtmlElement(el.id, document.createElement('span')); // becomes DOM-backed
    await nextFrame(vp);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    vp.registerHtmlPainter('rk-marker', () => {}); // now canvas-routed
    await nextFrame(vp);
    expect(paintStackOf(vp).querySelector(`[data-element-id="${el.id}"]`)).toBeNull();
    expect(paintStackOf(vp).querySelector('[data-paint-order]')).toBeNull();
  });

  describe('export delegation', () => {
    // jsdom implements neither method (both log "Not implemented" and no-op) — export-image.ts
    // and export-svg.ts's own test suites stub them the same way for any test that expects a
    // real result out of exportImage()/exportSVG().
    let toBlobSpy: ReturnType<typeof vi.spyOn>;
    let toDataURLSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
      ) {
        cb(new Blob(['fake'], { type: 'image/png' }));
      });
      toDataURLSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
        .mockReturnValue('data:image/png;base64,AAAA');
    });

    afterEach(() => {
      toBlobSpy.mockRestore();
      toDataURLSpy.mockRestore();
    });

    function htmlElement(htmlType: string): HtmlElement {
      return createHtmlElement({
        position: { x: 200, y: 200 },
        size: { w: 50, h: 50 },
        htmlType,
      });
    }

    it('injects the viewport registry when the caller passes no html options', async () => {
      const vp = makeViewport();
      const painter = vi.fn();
      vp.expectCanvasHtmlTypes(['rk-marker']);
      vp.registerHtmlPainter('rk-marker', painter);
      vp.store.add(markerElement());
      await vp.exportImage();
      expect(painter).toHaveBeenCalled();
    });

    it('lets an explicitly passed registry replace the viewport one', async () => {
      const vp = makeViewport();
      const viewportPainter = vi.fn();
      const callerPainter = vi.fn();
      vp.registerHtmlPainter('rk-marker', viewportPainter);
      const caller = new HtmlPainterRegistry();
      caller.register('rk-marker', callerPainter);
      vp.store.add(markerElement());
      await vp.exportImage({ htmlPainters: caller });
      expect(callerPainter).toHaveBeenCalled();
      expect(viewportPainter).not.toHaveBeenCalled();
    });

    it('unions an explicit expectedCanvasTypes with the registry declarations', async () => {
      const vp = makeViewport();
      vp.expectCanvasHtmlTypes(['rk-marker']);
      vp.store.add(markerElement());
      vp.store.add(htmlElement('other-canvas-type'));
      const onHtmlError = vi.fn();
      await vp.exportImage({ expectedCanvasTypes: new Set(['other-canvas-type']), onHtmlError });
      // Filter to 'missing-painter' specifically: an element that falls through to the
      // DOM-raster path instead (because it was never actually canvas-routed) reports
      // 'unsupported' instead, with the same htmlType field — an unfiltered read would
      // let that unrelated path satisfy this assertion by coincidence.
      const missingPainterTypes = onHtmlError.mock.calls
        .filter((c) => c[0].reason === 'missing-painter')
        .map((c) => c[0].htmlType)
        .sort();
      expect(missingPainterTypes).toEqual(['other-canvas-type', 'rk-marker']);
    });

    // Black-box coverage above cannot distinguish the union computation from a naive
    // "caller's set replaces declared" implementation: resolveHtmlRouting ORs
    // registry.canvasTypes directly (the same registry withHtmlDefaults injects as
    // htmlPainters), so a declared-but-unioned type still routes to canvas regardless
    // of whether the union actually happened. This white-box test reads
    // withHtmlDefaults's return value directly to pin the union itself — see the
    // mutation-verification note in the task report for the empirical confirmation.
    it('withHtmlDefaults unions expectedCanvasTypes with the registry declarations (white-box)', () => {
      const vp = makeViewport();
      vp.expectCanvasHtmlTypes(['rk-marker']);
      const withHtmlDefaults = (
        vp as unknown as {
          withHtmlDefaults: (options?: { expectedCanvasTypes?: ReadonlySet<string> }) => {
            expectedCanvasTypes: ReadonlySet<string>;
          };
        }
      ).withHtmlDefaults.bind(vp);
      const result = withHtmlDefaults({ expectedCanvasTypes: new Set(['other-canvas-type']) });
      expect([...result.expectedCanvasTypes].sort()).toEqual(['other-canvas-type', 'rk-marker']);
    });

    it('defaults strictMissingCanvasHtml to false from the viewport', async () => {
      const vp = makeViewport();
      vp.expectCanvasHtmlTypes(['rk-marker']);
      vp.store.add(markerElement());
      await expect(vp.exportImage()).resolves.not.toThrow();
    });

    it('applies the same delegation to exportSVG', async () => {
      const vp = makeViewport();
      const painter = vi.fn();
      vp.registerHtmlPainter('rk-marker', painter);
      vp.store.add(markerElement());
      await vp.exportSVG();
      expect(painter).toHaveBeenCalled();
    });
  });
});

describe('Viewport element activation', () => {
  const created: { vp: Viewport; container: HTMLDivElement }[] = [];

  afterEach(() => {
    while (created.length > 0) {
      const entry = created.pop();
      entry?.vp.destroy();
      entry?.container.remove();
    }
  });

  function makeViewport(): { vp: Viewport; wrapper: HTMLDivElement } {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    document.body.appendChild(container);
    const vp = new Viewport(container);
    created.push({ vp, container });
    vp.registerHtmlPainter('rk-marker', () => {
      /* canvas routing for markers */
    });
    vp.store.add(
      createHtmlElement({
        position: { x: 100, y: 100 },
        size: { w: 40, h: 40 },
        htmlType: 'rk-marker',
      }),
    );
    return { vp, wrapper: wrapperOf(container) };
  }

  function tapMarker(wrapper: HTMLDivElement): void {
    for (const type of ['pointerdown', 'pointerup']) {
      wrapper.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          clientX: 120,
          clientY: 120,
        }),
      );
    }
  }

  it('is off by default and activates only once setActivation enables it', () => {
    const { vp, wrapper } = makeViewport();
    const events: ElementActivationEvent[] = [];
    vp.onElementActivate((e) => events.push(e));

    tapMarker(wrapper);
    expect(events).toEqual([]);

    vp.setActivation({ gesture: 'single' });
    tapMarker(wrapper);
    expect(events).toHaveLength(1);
    expect(events[0]?.gesture).toBe('single');
  });

  it('returns a disposer that clears only its own generation', () => {
    const { vp, wrapper } = makeViewport();
    const events: ElementActivationEvent[] = [];
    vp.onElementActivate((e) => events.push(e));

    const staleDisposer = vp.setActivation({ gesture: 'single' });
    vp.setActivation({ gesture: 'single' });

    // A stale Strict-Mode cleanup must not tear down the newer registration.
    staleDisposer();
    tapMarker(wrapper);
    expect(events).toHaveLength(1);

    // The current generation's disposer does tear it down, and is idempotent.
    const currentDisposer = vp.setActivation({ gesture: 'single' });
    events.length = 0;
    currentDisposer();
    currentDisposer();
    tapMarker(wrapper);
    expect(events).toEqual([]);
  });

  it('rejects invalid options with RangeError and keeps the existing activation', () => {
    const { vp, wrapper } = makeViewport();
    const events: ElementActivationEvent[] = [];
    vp.onElementActivate((e) => events.push(e));
    vp.setActivation({ gesture: 'single' });

    expect(() => vp.setActivation({ gesture: 'single', slopPx: -1 })).toThrow(RangeError);
    expect(() => vp.setActivation({ gesture: 'single', doubleDelayMs: 0 })).toThrow(RangeError);

    tapMarker(wrapper);
    expect(events).toHaveLength(1);
  });

  it('isolates a throwing onElementActivate listener from its siblings', () => {
    const { vp, wrapper } = makeViewport();
    const seen: string[] = [];
    vp.onElementActivate(() => {
      seen.push('throwing');
      throw new Error('boom');
    });
    const unsub = vp.onElementActivate(() => seen.push('second'));
    vp.setActivation({ gesture: 'single' });

    tapMarker(wrapper);
    expect(seen).toEqual(['throwing', 'second']);

    unsub();
    tapMarker(wrapper);
    expect(seen).toEqual(['throwing', 'second', 'throwing']);
  });

  it('destroy() disposes the activation controller', () => {
    const { vp, wrapper } = makeViewport();
    const events: ElementActivationEvent[] = [];
    vp.onElementActivate((e) => events.push(e));
    vp.setActivation({ gesture: 'single' });
    tapMarker(wrapper);
    expect(events).toHaveLength(1);

    vp.destroy();
    events.length = 0;
    tapMarker(wrapper);
    expect(events).toEqual([]);
  });
});

describe('Viewport tools option and onStateChange', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  const fooTool: Tool = {
    name: 'foo',
    onPointerDown: () => undefined,
    onPointerMove: () => undefined,
    onPointerUp: () => undefined,
  };

  it("tools: 'default' registers the default bundle and activates select", () => {
    const viewport = new Viewport(container, { tools: 'default' });
    expect(viewport.toolManager.toolNames).toEqual([
      'hand',
      'select',
      'pencil',
      'eraser',
      'arrow',
      'note',
      'text',
      'shape',
      'frame',
    ]);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
    viewport.destroy();
  });

  it('selects a completed default frame gesture and undoes it once', () => {
    const viewport = new Viewport(container, { tools: 'default' });
    const wrapper = wrapperOf(container);
    viewport.runAction('tool.frame');
    for (const [type, clientX, clientY] of [
      ['pointerdown', 10, 20],
      ['pointerup', 110, 120],
    ] as const) {
      wrapper.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX,
          clientY,
        }),
      );
    }

    expect(viewport.store.count).toBe(1);
    expect(viewport.getSelectedIds()).toHaveLength(1);
    expect(viewport.history.undoCount).toBe(1);
    expect(viewport.undo()).toBe(true);
    expect(viewport.store.count).toBe(0);
    viewport.destroy();
  });

  it('leaves selection and history unchanged when a default frame gesture is cancelled', () => {
    const viewport = new Viewport(container, { tools: 'default' });
    const wrapper = wrapperOf(container);
    viewport.runAction('tool.frame');
    for (const [type, clientX, clientY] of [
      ['pointerdown', 10, 20],
      ['pointermove', 110, 120],
      ['pointercancel', 110, 120],
      ['pointerup', 110, 120],
    ] as const) {
      wrapper.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX,
          clientY,
        }),
      );
    }

    expect(viewport.store.count).toBe(0);
    expect(viewport.getSelectedIds()).toEqual([]);
    expect(viewport.history.undoCount).toBe(0);
    viewport.destroy();
  });

  it('a tools array without select registers it and leaves no tool active', () => {
    const viewport = new Viewport(container, { tools: [fooTool] });
    expect(viewport.toolManager.toolNames).toEqual(['foo']);
    expect(viewport.toolManager.activeTool).toBeNull();
    viewport.destroy();
  });

  it('an option tool replaces a same-named plugin tool', () => {
    const pluginFoo: Tool = { ...fooTool };
    const plugin: ViewportPlugin = {
      name: 'foo-tool-plugin',
      configure: (ctx) => ctx.registerTool(pluginFoo),
    };
    const viewport = new Viewport(container, { plugins: [plugin], tools: [fooTool] });
    expect(viewport.toolManager.getTool('foo')).toBe(fooTool);
    viewport.destroy();
  });

  it('an option tool gets a tool.<name> action that activates it', () => {
    const viewport = new Viewport(container, { tools: [fooTool] });
    expect(viewport.actions.run('tool.foo')).toBe(true);
    expect(viewport.toolManager.activeTool?.name).toBe('foo');
    viewport.destroy();
  });

  it('omitting tools registers nothing', () => {
    const viewport = new Viewport(container);
    expect(viewport.toolManager.toolNames).toEqual([]);
    viewport.destroy();
  });

  describe('onStateChange', () => {
    const listener = vi.fn();
    let notifyPlugin: () => void = () => undefined;
    const plugin: ViewportPlugin = {
      name: 'state-change-probe',
      start: (ctx) => {
        notifyPlugin = () => ctx.notifyChange();
        return undefined;
      },
    };
    const note = (v: Viewport) =>
      createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        layerId: v.layerManager.activeLayerId,
      });

    beforeEach(() => listener.mockClear());
    afterEach(() => vi.unstubAllGlobals());

    it.each<[string, (viewport: Viewport) => void]>([
      ['store add', (v) => v.store.add(note(v))],
      [
        'element update',
        (v) => {
          const n = note(v);
          v.store.add(n);
          listener.mockClear();
          v.store.update(n.id, { position: { x: 5, y: 5 } });
        },
      ],
      [
        'store clear',
        (v) => {
          v.store.add(note(v));
          listener.mockClear();
          v.store.clear();
        },
      ],
      ['camera move', (v) => v.camera.pan(10, 0)],
      ['layer create', (v) => v.layerManager.createLayer('Layer 2')],
      ['plugin notifyChange', () => notifyPlugin()],
    ])('fires once on %s', (_name, mutate) => {
      const viewport = new Viewport(container, { plugins: [plugin] });
      viewport.onStateChange(listener);
      mutate(viewport);
      expect(listener).toHaveBeenCalledTimes(1);
      viewport.destroy();
    });

    it('isolates a throwing listener and reports its error', () => {
      const reportSpy = vi.fn();
      vi.stubGlobal('reportError', reportSpy);
      const viewport = new Viewport(container);
      const boom = new Error('listener failed');
      viewport.onStateChange(() => {
        throw boom;
      });
      viewport.onStateChange(listener);
      const n = note(viewport);
      viewport.store.add(n);
      viewport.camera.pan(10, 0);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(reportSpy).toHaveBeenCalledWith(boom);
      expect(viewport.undo()).toBe(true);
      expect(viewport.store.getById(n.id)).toBeUndefined();
      viewport.destroy();
    });

    it('does not fire after its disposer is called', () => {
      const viewport = new Viewport(container, { plugins: [plugin] });
      viewport.onStateChange(listener)();
      viewport.store.add(note(viewport));
      viewport.camera.pan(10, 0);
      notifyPlugin();
      expect(listener).not.toHaveBeenCalled();
      viewport.destroy();
    });

    it('does not fire after destroy()', () => {
      const viewport = new Viewport(container, { plugins: [plugin] });
      viewport.onStateChange(listener);
      viewport.destroy();
      viewport.store.add(note(viewport));
      viewport.camera.pan(10, 0);
      notifyPlugin();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('Viewport overlays', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let container: HTMLDivElement;
  let vp: Viewport;

  beforeEach(() => {
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        const ctx: Record<string, unknown> = { canvas: this };
        return new Proxy(ctx, {
          get: (target, prop) => (prop in target ? target[prop as string] : () => undefined),
        });
      } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    vp = new Viewport(container);
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
    getContextSpy.mockRestore();
  });

  function flush(): void {
    (vp as unknown as { renderLoop: { flush(): void } }).renderLoop.flush();
  }

  it('registerOverlay draws via the overlay hook, isolates a throwing overlay every frame without quarantining it', () => {
    let frame = 0;
    const flaky = vi.fn(() => {
      if (frame === 1) throw new Error('boom');
    });
    const sibling = vi.fn();
    const renderOverlay = vi.fn();
    vp.toolManager.register({
      name: 'overlay-tool',
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      renderOverlay,
    });
    vp.setTool('overlay-tool');
    vp.registerOverlay(flaky);
    vp.registerOverlay(sibling);

    frame = 1;
    flush();
    expect(flaky).toHaveBeenCalledTimes(1);
    expect(sibling).toHaveBeenCalledTimes(1);
    expect(renderOverlay).toHaveBeenCalledTimes(1);

    frame = 2;
    vp.requestOverlayRender();
    flush();
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(flaky).toHaveLastReturnedWith(undefined);
    expect(sibling).toHaveBeenCalledTimes(2);
  });

  it('registerOverlay unsubscribe stops drawing and is idempotent', () => {
    const draw = vi.fn();
    const unsubscribe = vp.registerOverlay(draw);
    flush();
    expect(draw).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    flush();
    vp.requestRender();
    flush();
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

describe('Viewport live element wiring', () => {
  it('passes store updates to noteElementUpdate and removals to forgetElement', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const vp = new Viewport(container);
    const { renderLoop } = vp as unknown as {
      renderLoop: {
        noteElementUpdate(previous: unknown, current: unknown): void;
        forgetElement(id: string, layerId: string): void;
      };
    };
    const noteElementUpdate = vi.spyOn(renderLoop, 'noteElementUpdate');
    const forgetElement = vi.spyOn(renderLoop, 'forgetElement');
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    vp.store.add(shape);

    vp.store.update(shape.id, { position: { x: 5, y: 0 } });
    vp.store.remove(shape.id);

    expect(noteElementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: shape.id, position: { x: 0, y: 0 } }),
      expect.objectContaining({ id: shape.id, position: { x: 5, y: 0 } }),
    );
    expect(forgetElement).toHaveBeenCalledWith(shape.id, shape.layerId);
    vp.destroy();
    container.remove();
  });
});

describe('Viewport live html elements', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let container: HTMLDivElement;
  let vp: Viewport;

  beforeEach(() => {
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        const ctx: Record<string, unknown> = { canvas: this };
        return new Proxy(ctx, {
          get: (target, prop) => (prop in target ? target[prop as string] : () => undefined),
        });
      } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    vp = new Viewport(container);
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
    getContextSpy.mockRestore();
  });

  function priv() {
    return vp as unknown as {
      renderLoop: { flush(): void };
      domNodeManager: { getNode(id: string): HTMLDivElement | undefined };
      interactMode: { startInteracting(id: string): void; interactingId: string | null };
    };
  }

  it('addHtmlElement interactive option is stored and exported', () => {
    const id = vp.addHtmlElement(
      document.createElement('div'),
      { x: 0, y: 0 },
      { w: 100, h: 50 },
      { interactive: true },
    );
    priv().renderLoop.flush();

    const el = vp.store.getById(id);
    expect(el?.type === 'html' && el.interactive).toBe(true);
    expect(priv().domNodeManager.getNode(id)?.style.pointerEvents).toBe('auto');
    const exported = vp.exportState().elements.find((e) => e.id === id);
    expect(exported?.type === 'html' && exported.interactive).toBe(true);
  });

  it('turning interactive on while in InteractMode stops interacting; turning it off leaves pointer-events none', () => {
    const id = vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, { w: 100, h: 50 });
    priv().renderLoop.flush();
    priv().interactMode.startInteracting(id);
    const node = priv().domNodeManager.getNode(id);
    expect(node?.style.pointerEvents).toBe('auto');

    vp.store.update(id, { interactive: true });
    expect(priv().interactMode.interactingId).toBeNull();
    expect(node?.style.pointerEvents).toBe('auto');

    vp.store.update(id, { interactive: false });
    priv().renderLoop.flush();
    expect(node?.style.pointerEvents).toBe('none');
  });

  it('turning interactive on inside a notification batch stops interacting', () => {
    const id = vp.addHtmlElement(document.createElement('div'), { x: 0, y: 0 }, { w: 100, h: 50 });
    priv().renderLoop.flush();
    priv().interactMode.startInteracting(id);

    const notifications = vp.suspendNotifications();
    vp.store.update(id, { interactive: true });
    notifications.resume();

    expect(priv().interactMode.interactingId).toBeNull();
    expect(priv().domNodeManager.getNode(id)?.style.pointerEvents).toBe('auto');
  });

  function addLive(interactive: boolean) {
    const content = document.createElement('div');
    const padding = document.createElement('p');
    const link = document.createElement('a');
    link.setAttribute('href', '#');
    content.append(padding, link);
    const id = vp.addHtmlElement(
      content,
      { x: 0, y: 0 },
      { w: 100, h: 50 },
      interactive ? { interactive } : undefined,
    );
    priv().renderLoop.flush();
    return { id, padding, link };
  }

  function dragStart(target: Element): Event {
    const e = new Event('dragstart', { bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  }

  it('dragstart from live padding is prevented, from a live link is not', () => {
    const { padding, link } = addLive(true);

    expect(dragStart(padding).defaultPrevented).toBe(true);
    expect(dragStart(link).defaultPrevented).toBe(false);
  });

  it('dragstart inside a non-live html element is left alone', () => {
    const { padding } = addLive(false);

    expect(dragStart(padding).defaultPrevented).toBe(false);
  });

  it('dragstart inside host markup carrying data-fn-live in a non-live html element is left alone', () => {
    const { padding } = addLive(false);
    const hostLive = document.createElement('div');
    hostLive.setAttribute('data-fn-live', '');
    const inner = document.createElement('span');
    hostLive.appendChild(inner);
    padding.appendChild(hostLive);

    expect(dragStart(inner).defaultPrevented).toBe(false);
  });

  it.each(['scrollTop', 'scrollLeft'] as const)(
    'wrapper %s resets to 0 with a live node',
    (key) => {
      addLive(true);
      const wrapper = wrapperOf(container);
      wrapper[key] = 40;
      expect(wrapper[key]).toBe(40);

      wrapper.dispatchEvent(new Event('scroll'));

      expect(wrapper[key]).toBe(0);
    },
  );

  it('wrapper scroll offsets are left alone with no live node and no embedding', () => {
    addLive(false);
    const wrapper = wrapperOf(container);
    wrapper.scrollTop = 40;

    wrapper.dispatchEvent(new Event('scroll'));

    expect(wrapper.scrollTop).toBe(40);
  });

  it('sets, clears, undoes, and keeps no-op parenting commands history-silent', () => {
    const viewport = vp;
    const parent = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const child = createNote({ position: { x: 20, y: 20 }, size: { w: 40, h: 20 } });
    viewport.store.add(parent);
    viewport.store.add(child);
    const select = new SelectTool();
    viewport.toolManager.register(select);
    viewport.toolManager.setTool('select', viewport.toolContext);
    select.setSelection([child.id]);
    viewport.history.clear();
    const updates = vi.fn();
    viewport.store.on('update', updates);
    const render = vi.spyOn(viewport, 'requestRender');

    viewport.setParent(child.id, parent.id);
    expect(viewport.store.getById(child.id)?.parentId).toBe(parent.id);
    expect(viewport.history.undoCount).toBe(1);
    expect(viewport.undo()).toBe(true);
    expect(viewport.store.getById(child.id)?.parentId).toBeUndefined();
    expect(viewport.redo()).toBe(true);
    expect(viewport.store.getById(child.id)?.parentId).toBe(parent.id);

    updates.mockClear();
    render.mockClear();
    for (const command of [
      () => viewport.setParent(child.id, 'missing'),
      () => viewport.setParent(parent.id, parent.id),
      () => viewport.setParent(parent.id, child.id),
    ]) {
      expect(command).toThrow(/Invalid hierarchy/);
      expect(viewport.store.getById(child.id)?.parentId).toBe(parent.id);
      expect(updates).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(viewport.history.undoCount).toBe(1);
      expect(viewport.getSelectedIds()).toEqual([child.id]);
    }
    viewport.setParent(child.id, parent.id);
    viewport.setParent('missing', parent.id);
    expect(updates).not.toHaveBeenCalled();
    expect(viewport.history.undoCount).toBe(1);
  });

  it('rejects parenting a frame before recording history but allows frame children', () => {
    const viewport = vp;
    const frame = createFrame({
      position: { x: 0, y: 0 },
      size: { w: 120, h: 90 },
      layerId: viewport.layerManager.activeLayerId,
    });
    const parent = createNote({
      position: { x: 0, y: 0 },
      size: { w: 20, h: 20 },
      layerId: frame.layerId,
    });
    const child = createNote({
      position: { x: 20, y: 30 },
      size: { w: 20, h: 20 },
      layerId: frame.layerId,
    });
    viewport.store.add(frame);
    viewport.store.add(parent);
    viewport.store.add(child);
    viewport.history.clear();

    expect(() => viewport.setParent(frame.id, parent.id)).toThrow(/Invalid hierarchy/);
    expect(viewport.store.getById(frame.id)?.parentId).toBeUndefined();
    expect(viewport.history.undoCount).toBe(0);
    viewport.setParent(child.id, frame.id);
    expect(viewport.store.getById(child.id)?.parentId).toBe(frame.id);
    viewport.setParent(child.id, null);
    expect(viewport.store.getById(child.id)?.parentId).toBeUndefined();
  });

  it('keeps literal selection and renders only successful parenting commands', () => {
    const viewport = vp;
    const parent = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const child = createNote({ position: { x: 20, y: 20 }, size: { w: 40, h: 20 } });
    viewport.store.add(parent);
    viewport.store.add(child);
    const select = new SelectTool();
    viewport.toolManager.register(select);
    viewport.toolManager.setTool('select', viewport.toolContext);
    select.setSelection([child.id]);
    viewport.history.clear();
    const render = vi.spyOn(viewport, 'requestRender');
    const updates = vi.fn();
    viewport.store.on('update', updates);

    viewport.setParent(child.id, parent.id);
    expect(viewport.history.undoCount).toBe(1);
    expect(viewport.getSelectedIds()).toEqual([child.id]);
    expect(render).toHaveBeenCalled();
    viewport.setParent(child.id, null);
    expect(viewport.history.undoCount).toBe(2);
    expect(viewport.getSelectedIds()).toEqual([child.id]);
    expect(viewport.undo()).toBe(true);
    expect(viewport.getSelectedIds()).toEqual([child.id]);
    expect(viewport.redo()).toBe(true);
    expect(viewport.getSelectedIds()).toEqual([child.id]);

    updates.mockClear();
    render.mockClear();
    viewport.setParent(child.id, null);
    viewport.setParent('missing', parent.id);
    expect(updates).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(viewport.history.undoCount).toBe(2);
  });

  describe('frame membership commands', () => {
    function select(viewport: Viewport): SelectTool {
      const tool = new SelectTool();
      viewport.toolManager.register(tool);
      viewport.toolManager.setTool('select', viewport.toolContext);
      return tool;
    }

    it('rejects a missing literal frame selection without changing history, selection, or render', () => {
      const viewport = vp;
      const root = createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 } });
      viewport.store.add(root);
      const tool = select(viewport);
      tool.setSelection([root.id]);
      viewport.history.clear();
      const before = structuredClone(viewport.store.snapshot());
      const render = vi.spyOn(viewport, 'requestRender');
      render.mockClear();

      expect(() => viewport.frameSelection([root.id, 'missing'])).toThrow(
        'Cannot change frame membership: element "missing" is missing',
      );
      expect(viewport.store.snapshot()).toEqual(before);
      expect(viewport.getSelectedIds()).toEqual([root.id]);
      expect(viewport.history.undoCount).toBe(0);
      expect(viewport.history.redoCount).toBe(0);
      expect(render).not.toHaveBeenCalled();
    });

    function expectLateRehearsalRejection(
      extensionType: string,
      validateElement: (element: ExtensionElementEnvelope) => boolean,
    ): void {
      const viewport = vp;
      const layerId = viewport.layerManager.activeLayerId;
      viewport.elementRegistry.register<ExtensionElementEnvelope>({
        type: extensionType,
        legacyTypes: [],
        decodeLegacy: () => {
          throw new Error('no legacy');
        },
        validateData: () => true,
        validateElement,
        unwrap: (element) => element,
        wrap: (element) => element,
        bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 20, h: 20 }),
      });
      const extension: ExtensionElementEnvelope = {
        id: `extension-${extensionType}`,
        type: 'extension',
        extensionType,
        position: { x: 0, y: 0 },
        index: 'a0',
        version: 1,
        locked: false,
        layerId,
        data: {},
      };
      const first = createShape({ position: { x: 40, y: 0 }, size: { w: 10, h: 10 }, layerId });
      const second = createShape({ position: { x: 60, y: 0 }, size: { w: 10, h: 10 }, layerId });
      const arrow = createArrow({
        position: { x: 80, y: 0 },
        from: { x: 80, y: 0 },
        to: { x: 100, y: 20 },
        bend: 12,
        layerId,
      });
      delete arrow.cachedControlPoint;
      viewport.store.add(extension);
      viewport.store.add(first);
      viewport.store.add(second);
      viewport.store.add(arrow);
      const tool = select(viewport);
      viewport.history.clear();
      viewport.transaction(() => viewport.store.update(first.id, { position: { x: 41, y: 0 } }));
      viewport.transaction(() => viewport.store.update(second.id, { position: { x: 61, y: 0 } }));
      expect(viewport.undo()).toBe(true);
      tool.setSelection([extension.id]);

      const before = {
        snapshot: structuredClone(viewport.store.snapshot()),
        count: viewport.store.count,
        order: viewport.store.getAll().map((element) => element.id),
        indices: viewport.store.getAll().map(({ id, index }) => ({ id, index })),
        layers: viewport.layerManager.snapshot(),
        selection: viewport.getSelectedIds(),
        undoCount: viewport.history.undoCount,
        redoCount: viewport.history.redoCount,
      };
      const add = vi.fn();
      const update = vi.fn();
      const remove = vi.fn();
      const change = vi.fn();
      viewport.store.on('add', add);
      viewport.store.on('update', update);
      viewport.store.on('remove', remove);
      viewport.store.onChange(change);
      const render = vi.spyOn(viewport, 'requestRender');

      expect(() => viewport.frameSelection([extension.id])).toThrow(
        `Invalid extension envelope "${extension.id}" of type "${extensionType}"`,
      );
      expect({
        snapshot: viewport.store.snapshot(),
        count: viewport.store.count,
        order: viewport.store.getAll().map((element) => element.id),
        indices: viewport.store.getAll().map(({ id, index }) => ({ id, index })),
        layers: viewport.layerManager.snapshot(),
        selection: viewport.getSelectedIds(),
        undoCount: viewport.history.undoCount,
        redoCount: viewport.history.redoCount,
      }).toEqual(before);
      expect(
        viewport.store.getAll().some((element) => element.extensionType === 'core:frame'),
      ).toBe(false);
      expect(Object.hasOwn(viewport.store.getById(arrow.id) ?? {}, 'cachedControlPoint')).toBe(
        false,
      );
      expect(add).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    }

    it.each([
      [
        'a frame command rehearses a late extension-envelope rejection before mutating live state',
        'test:reject-parent',
        (element: ExtensionElementEnvelope) => element.parentId === undefined,
      ],
      [
        'a frame command rehearses an incremented extension-envelope version before mutating live state',
        'test:reject-parent-version-2',
        (element: ExtensionElementEnvelope) =>
          element.parentId === undefined || element.version === 1,
      ],
    ] as const)('%s', (_name, extensionType, validateElement) => {
      expectLateRehearsalRejection(extensionType, validateElement);
    });

    it('frames, adds, removes, and dissolves members as undoable commands', () => {
      const viewport = vp;
      const layerId = viewport.layerManager.activeLayerId;
      const first = createShape({
        position: { x: 10, y: 20 },
        size: { w: 30, h: 40 },
        layerId,
        index: 'a0',
      });
      const second = createShape({
        position: { x: 80, y: 20 },
        size: { w: 20, h: 20 },
        layerId,
        index: 'a1',
      });
      const incoming = createShape({
        position: { x: 140, y: 20 },
        size: { w: 20, h: 20 },
        layerId,
        index: 'a2',
      });
      viewport.store.add(first);
      viewport.store.add(second);
      viewport.store.add(incoming);
      const tool = select(viewport);
      tool.setSelection([first.id, second.id]);
      viewport.history.clear();

      const frameId = viewport.frameSelection([first.id, second.id], { padding: 10 });
      expect(viewport.store.getById(frameId)).toMatchObject({
        position: { x: 0, y: -14 },
        size: { w: 110, h: 84 },
      });
      expect(viewport.store.getById(first.id)?.parentId).toBe(frameId);
      expect(viewport.store.getById(second.id)?.parentId).toBe(frameId);
      expect(viewport.getSelectedIds()).toEqual([frameId]);
      expect(viewport.history.undoCount).toBe(1);
      expect(viewport.undo()).toBe(true);
      expect(viewport.store.getById(frameId)).toBeUndefined();
      expect(viewport.redo()).toBe(true);
      expect(viewport.store.getById(first.id)?.parentId).toBe(frameId);

      tool.setSelection([incoming.id]);
      viewport.addToFrame(frameId, [incoming.id]);
      expect(viewport.store.getById(incoming.id)?.parentId).toBe(frameId);
      viewport.removeFromFrame(frameId, [incoming.id]);
      expect(viewport.store.getById(incoming.id)?.parentId).toBeUndefined();
      viewport.dissolveFrame(frameId);
      expect(viewport.store.getById(frameId)).toBeUndefined();
      expect(viewport.store.getById(first.id)?.parentId).toBeUndefined();
      expect(viewport.store.getById(second.id)?.parentId).toBeUndefined();
    });

    it('dissolves an empty frame between duplicate root keys and replays it safely', () => {
      const viewport = vp;
      const layerId = viewport.layerManager.activeLayerId;
      const before = createShape({
        position: { x: 0, y: 0 },
        size: { w: 20, h: 20 },
        layerId,
        index: 'a0',
      });
      const frame = {
        ...createFrame({ position: { x: 30, y: 0 }, size: { w: 80, h: 60 }, layerId, index: 'a0' }),
        id: 'empty-frame',
      };
      const after = createShape({
        position: { x: 120, y: 0 },
        size: { w: 20, h: 20 },
        layerId,
        index: 'a0',
      });
      viewport.store.add(before);
      viewport.store.add(frame);
      viewport.store.add(after);
      viewport.history.clear();

      viewport.dissolveFrame(frame.id);
      expect(viewport.store.getById(frame.id)).toBeUndefined();
      expect(viewport.undo()).toBe(true);
      expect(viewport.store.getById(frame.id)?.parentId).toBeUndefined();
      expect(viewport.redo()).toBe(true);
      expect(viewport.store.getById(frame.id)).toBeUndefined();
    });

    it.each(['frame', 'add', 'remove', 'dissolve'] as const)(
      '%s joins an outer transaction and replays membership on undo and redo',
      (command) => {
        const viewport = vp;
        const layerId = viewport.layerManager.activeLayerId;
        const root = {
          ...createShape({
            position: { x: 0, y: 0 },
            size: { w: 20, h: 20 },
            layerId,
            index: 'a0',
          }),
          id: 'root',
        };
        const frame = {
          ...createFrame({
            position: { x: 30, y: 0 },
            size: { w: 100, h: 80 },
            layerId,
            index: 'a1',
          }),
          id: 'frame',
        };
        const member = {
          ...createShape({
            position: { x: 40, y: 30 },
            size: { w: 20, h: 20 },
            layerId,
            index: 'a0',
          }),
          id: 'member',
          parentId: frame.id,
        };
        const grandchild = {
          ...createShape({
            position: { x: 45, y: 35 },
            size: { w: 5, h: 5 },
            layerId,
            index: 'a0',
          }),
          id: 'grandchild',
          parentId: command === 'add' ? root.id : member.id,
        };
        const unrelated = {
          ...createShape({
            position: { x: 150, y: 0 },
            size: { w: 20, h: 20 },
            layerId,
            index: 'a2',
          }),
          id: 'unrelated',
        };
        viewport.store.add(root);
        viewport.store.add(frame);
        viewport.store.add(member);
        viewport.store.add(grandchild);
        viewport.store.add(unrelated);
        const tool = select(viewport);
        viewport.history.clear();
        if (command === 'frame') tool.setSelection([root.id]);
        if (command === 'add') tool.setSelection([root.id, grandchild.id]);
        if (command === 'remove') tool.setSelection([member.id, grandchild.id]);
        if (command === 'dissolve')
          tool.setSelection([frame.id, member.id, grandchild.id, unrelated.id]);
        let frameSelectionId: string | undefined;
        viewport.transaction(() => {
          viewport.store.update(unrelated.id, { position: { x: 200, y: 0 } });
          if (command === 'frame') frameSelectionId = viewport.frameSelection([root.id]);
          if (command === 'add') viewport.addToFrame(frame.id, [root.id]);
          if (command === 'remove') viewport.removeFromFrame(frame.id, [member.id, grandchild.id]);
          if (command === 'dissolve') {
            viewport.dissolveFrame(frame.id);
            expect(viewport.getSelectedIds()).toEqual([
              frame.id,
              member.id,
              grandchild.id,
              unrelated.id,
            ]);
          }
        });
        expect(viewport.history.undoCount).toBe(1);
        expect(viewport.store.getById(unrelated.id)?.position).toEqual({ x: 200, y: 0 });
        if (command === 'frame') {
          if (!frameSelectionId) throw new Error('frame command did not return an id');
          const created = viewport.store.getById(frameSelectionId);
          expect(created).toMatchObject({
            position: { x: -24, y: -48 },
            size: { w: 80, h: 92 },
            index: 'a0',
          });
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: frameSelectionId,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([frameSelectionId]);
        }
        if (command === 'add') {
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: frame.id,
            index: 'a1',
          });
          expect(viewport.getSelectedIds()).toEqual([root.id, grandchild.id]);
        }
        if (command === 'remove') {
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: undefined,
            index: 'a1V',
          });
          expect(viewport.store.getById(grandchild.id)).toMatchObject({
            parentId: member.id,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id]);
        }
        if (command === 'dissolve') {
          expect(viewport.store.getById(frame.id)).toBeUndefined();
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: undefined,
            index: 'a1',
          });
          expect(viewport.store.getById(grandchild.id)).toMatchObject({
            parentId: member.id,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id, unrelated.id]);
        }
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(unrelated.id)?.position).toEqual({ x: 150, y: 0 });
        if (command === 'frame') {
          if (!frameSelectionId) throw new Error('frame command did not return an id');
          expect(viewport.store.getById(frameSelectionId)).toBeUndefined();
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: undefined,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([]);
        }
        if (command === 'add') {
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: undefined,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([root.id, grandchild.id]);
        }
        if (command === 'remove') {
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: frame.id,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id]);
        }
        if (command === 'dissolve') {
          expect(viewport.store.getById(frame.id)?.parentId).toBeUndefined();
          expect(viewport.store.getById(frame.id)?.index).toBe('a1');
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: frame.id,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id, unrelated.id]);
        }
        expect(viewport.redo()).toBe(true);
        expect(viewport.store.getById(unrelated.id)?.position).toEqual({ x: 200, y: 0 });
        if (command === 'frame') {
          if (!frameSelectionId) throw new Error('frame command did not return an id');
          expect(viewport.store.getById(frameSelectionId)).toMatchObject({
            position: { x: -24, y: -48 },
            size: { w: 80, h: 92 },
            index: 'a0',
          });
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: frameSelectionId,
            index: 'a0',
          });
          expect(viewport.getSelectedIds()).toEqual([]);
        }
        if (command === 'add') {
          expect(viewport.store.getById(root.id)).toMatchObject({
            parentId: frame.id,
            index: 'a1',
          });
          expect(viewport.getSelectedIds()).toEqual([root.id, grandchild.id]);
        }
        if (command === 'remove') {
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: undefined,
            index: 'a1V',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id]);
        }
        if (command === 'dissolve') {
          expect(viewport.store.getById(frame.id)).toBeUndefined();
          expect(viewport.store.getById(member.id)).toMatchObject({
            parentId: undefined,
            index: 'a1',
          });
          expect(viewport.getSelectedIds()).toEqual([member.id, grandchild.id, unrelated.id]);
        }
      },
    );
  });

  it('rejects cross-layer, full-canvas, and depth-33 parenting without side effects', () => {
    const viewport = vp;
    const layer = viewport.layerManager.createLayer('other');
    const parent = createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const child = createNote({
      position: { x: 20, y: 0 },
      size: { w: 10, h: 10 },
      layerId: layer.id,
    });
    viewport.store.add(parent);
    viewport.store.add(child);
    const select = new SelectTool();
    viewport.toolManager.register(select);
    viewport.toolManager.setTool('select', viewport.toolContext);
    select.setSelection([child.id]);
    const render = vi.spyOn(viewport, 'requestRender');
    const updates = vi.fn();
    viewport.store.on('update', updates);
    viewport.history.clear();
    const expectRejected = (command: () => void, id: string) => {
      updates.mockClear();
      render.mockClear();
      const history = viewport.history.undoCount;
      expect(command).toThrow(/Invalid hierarchy/);
      expect(viewport.store.getById(id)?.parentId).toBeUndefined();
      expect(updates).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(viewport.history.undoCount).toBe(history);
      expect(viewport.getSelectedIds()).toEqual([child.id]);
    };
    expectRejected(() => viewport.setParent(child.id, parent.id), child.id);

    viewport.elementRegistry.register({
      type: 'test:full-parent',
      legacyTypes: [],
      fullCanvas: true,
      decodeLegacy: () => {
        throw new Error('no legacy');
      },
      validateData: () => true,
      unwrap: (element) => element,
      wrap: (element) => ({
        ...element,
        type: 'extension',
        extensionType: 'test:full-parent',
        data: {},
      }),
      bounds: () => null,
    } satisfies ElementTypeDefinition<BaseElement>);
    const full: ExtensionElementEnvelope = {
      id: 'full',
      type: 'extension',
      extensionType: 'test:full-parent',
      position: { x: 0, y: 0 },
      index: 'z',
      version: 1,
      locked: false,
      layerId: viewport.layerManager.activeLayerId,
      data: {},
    };
    const local = createNote({ position: { x: 40, y: 0 }, size: { w: 10, h: 10 } });
    viewport.store.add(full);
    viewport.store.add(local);
    expectRejected(() => viewport.setParent(local.id, full.id), local.id);
    expectRejected(() => viewport.setParent(full.id, local.id), full.id);

    const chain = Array.from({ length: 34 }, (_, index) =>
      Object.assign(
        createNote({
          position: { x: index * 20, y: 100 },
          size: { w: 10, h: 10 },
        }),
        { id: `depth-${index}` },
      ),
    );
    for (const element of chain) viewport.store.add(element);
    for (let index = 1; index < 33; index += 1) {
      const childElement = chain[index];
      const parentElement = chain[index - 1];
      if (!childElement || !parentElement) throw new Error('depth fixture incomplete');
      viewport.setParent(childElement.id, parentElement.id);
    }
    const tail = chain[33];
    const previous = chain[32];
    if (!tail || !previous) throw new Error('depth fixture incomplete');
    updates.mockClear();
    render.mockClear();
    const history = viewport.history.undoCount;
    expect(() => viewport.setParent(tail.id, previous.id)).toThrow(/Invalid hierarchy/);
    expect(viewport.store.getById(tail.id)?.parentId).toBeUndefined();
    expect(updates).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(viewport.history.undoCount).toBe(history);
  });

  it.each(['success', 'same-parent', 'missing-child'] as const)(
    'flushes a pending nudge before a %s parenting command',
    (kind) => {
      vi.useFakeTimers();
      const viewport = vp;
      const select = new SelectTool();
      viewport.toolManager.register(select);
      viewport.toolManager.setTool('select', viewport.toolContext);
      const layerId = viewport.layerManager.activeLayerId;
      const parent = createNote({
        position: { x: 0, y: 0 },
        size: { w: 20, h: 20 },
        layerId,
      });
      const child = createNote({
        position: { x: 100, y: 0 },
        size: { w: 20, h: 20 },
        layerId,
      });
      viewport.store.add(parent);
      viewport.store.add(child);
      if (kind === 'same-parent') viewport.setParent(child.id, parent.id);
      viewport.history.clear();
      select.setSelection([child.id]);
      focusCanvas(container);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(viewport.store.getById(child.id)?.position.x).toBe(101);
      const updates = vi.fn();
      viewport.store.on('update', updates);
      const render = vi.spyOn(viewport, 'requestRender');

      if (kind === 'success') viewport.setParent(child.id, parent.id);
      else if (kind === 'same-parent') viewport.setParent(child.id, parent.id);
      else viewport.setParent('missing', parent.id);

      expect(viewport.history.undoCount).toBe(kind === 'success' ? 2 : 1);
      if (kind !== 'success') {
        expect(updates).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
      }
      if (kind === 'success') {
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(child.id)?.parentId).toBeUndefined();
        expect(viewport.store.getById(child.id)?.position.x).toBe(101);
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(child.id)?.position.x).toBe(100);
      } else {
        expect(viewport.undo()).toBe(true);
        expect(viewport.store.getById(child.id)?.position.x).toBe(100);
      }
      vi.useRealTimers();
    },
  );
});
