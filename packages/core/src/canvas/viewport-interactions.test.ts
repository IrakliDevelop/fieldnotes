/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewportInteractions } from './viewport-interactions';
import type { ViewportInteractionsDeps } from './viewport-interactions';
import { ElementStore } from '../elements/element-store';
import {
  createNote,
  createArrow,
  createShape,
  createText,
  createHtmlElement,
} from '../elements/element-factory';
import type { CanvasElement, HtmlElement, TextElement } from '../elements/types';
import type { ToolContext } from '../tools/types';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import { NoteEditor } from '../elements/note-editor';

function heightOf(element: CanvasElement | undefined): number {
  if (!element || !('size' in element) || element.type === 'extension') {
    throw new Error('expected a sized element');
  }
  return element.size.h;
}

function textOf(store: ElementStore, id: string): TextElement {
  const element = store.getById(id);
  if (!element || element.type !== 'text') throw new Error('expected text element');
  return element;
}

function nodeWithHeight(h: number): HTMLDivElement {
  const node = document.createElement('div');
  Object.defineProperty(node, 'scrollHeight', { value: h, configurable: true });
  return node;
}

function nodeWithSize(height: number, width: number): HTMLDivElement {
  const node = nodeWithHeight(height);
  Object.defineProperty(node, 'scrollWidth', { value: width, configurable: true });
  return node;
}

function makeDeps(store: ElementStore, overrides: Partial<ViewportInteractionsDeps> = {}) {
  const nodes = new Map<string, HTMLElement>();
  const camera = { zoom: 1, screenToWorld: (p: { x: number; y: number }) => p } as never;
  const deps: ViewportInteractionsDeps = {
    store,
    camera,
    wrapper: document.createElement('div') as HTMLDivElement,
    domLayer: document.createElement('div') as HTMLDivElement,
    renderLoop: { flush: vi.fn() } as never,
    domNodeManager: {
      getNode: (id: string) => nodes.get(id),
    } as never,
    noteEditor: { startEditing: vi.fn() } as never,
    interactMode: { startInteracting: vi.fn(), stopInteracting: vi.fn() } as never,
    recorder: { begin: vi.fn(), commit: vi.fn() } as never,
    toolContext: { camera, store, requestRender: vi.fn(), requestOverlayRender: vi.fn() },
    requestRender: vi.fn(),
    addImage: vi.fn(() => 'img-id'),
    ...overrides,
  };
  return { deps, nodes };
}

describe('ViewportInteractions', () => {
  it('syncs a new bound editor from the installed text element', () => {
    const store = new ElementStore();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(store, stack);
    const shape = createShape({
      position: { x: 100, y: 200 },
      size: { w: 300, h: 200 },
      shape: 'rectangle',
    });
    store.add(shape);
    const node = document.createElement('div');
    const { deps, nodes } = makeDeps(store, {
      recorder,
      noteEditor: {
        isEditingOrPending: () => false,
        stopEditing: vi.fn(),
        startEditing: vi.fn(),
      } as never,
    });
    const sync = vi.fn((element: CanvasElement) => nodes.set(element.id, node));
    deps.domNodeManager = { getNode: (id: string) => nodes.get(id), syncDomNode: sync } as never;

    expect(new ViewportInteractions(deps).editBoundText(shape.id)).toBe(true);

    const text = store
      .getAll()
      .find((element) => element.type === 'text' && element.containerId === shape.id);
    if (!text) throw new Error('expected bound text');
    expect(sync).toHaveBeenCalledWith(text);
    expect(sync.mock.calls[0]?.[0]).toBe(text);
  });

  it('edits advisory mismatches and later siblings as ordinary text', () => {
    const store = new ElementStore();
    const host = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 60 } }),
      id: 'host',
    };
    const otherParent = {
      ...createShape({ position: { x: 200, y: 0 }, size: { w: 100, h: 60 } }),
      id: 'other',
    };
    const actual = {
      ...createText({ position: { x: 0, y: 0 }, parentId: host.id, index: 'a' }),
      id: 'actual',
      containerId: host.id,
    };
    const mismatched = {
      ...createText({ position: { x: 0, y: 0 }, parentId: otherParent.id, index: 'b' }),
      id: 'mismatched',
      containerId: host.id,
    };
    const later = { ...actual, id: 'later', index: 'b' };
    for (const element of [host, otherParent, actual, mismatched, later]) store.add(element);
    const noteEditor = new NoteEditor({ toolbar: false });
    const startEditing = vi.spyOn(noteEditor, 'startEditing').mockImplementation(() => undefined);
    vi.spyOn(noteEditor, 'stopEditing').mockImplementation(() => undefined);
    vi.spyOn(noteEditor, 'isEditingOrPending').mockReturnValue(false);
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame');
    const { deps, nodes } = makeDeps(store, { noteEditor });
    for (const id of [actual.id, mismatched.id, later.id])
      nodes.set(id, document.createElement('div'));
    const interactions = new ViewportInteractions(deps);

    interactions.startEditingElement(mismatched.id);
    interactions.startEditingElement(later.id);
    expect(startEditing).toHaveBeenNthCalledWith(1, nodes.get(mismatched.id), mismatched.id, store);
    expect(startEditing).toHaveBeenNthCalledWith(2, nodes.get(later.id), later.id, store);
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

    expect(interactions.editBoundText(actual.id)).toBe(true);
    expect(startEditing).toHaveBeenNthCalledWith(
      3,
      nodes.get(actual.id),
      actual.id,
      store,
      expect.any(Function),
    );
    expect(interactions.editBoundText(mismatched.id)).toBe(false);
    expect(interactions.editBoundText(later.id)).toBe(false);
  });

  describe('bound text locks', () => {
    it.each([
      ['container lock', { locked: true }],
      ['layer lock', { layerId: 'locked' }],
    ])('refuses a %s without creating text or starting an editor', (_name, input) => {
      const store = new ElementStore();
      const container = createShape({
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 60 },
        ...input,
      });
      store.add(container);
      const before = store.getAll();
      const { deps } = makeDeps(store, {
        toolContext: {
          camera: { zoom: 1, screenToWorld: (p: { x: number; y: number }) => p } as never,
          store,
          requestRender: vi.fn(),
          requestOverlayRender: vi.fn(),
          isLayerLocked: (id) => id === 'locked',
        },
      });

      expect(new ViewportInteractions(deps).editBoundText(container.id)).toBe(false);
      expect(store.getAll()).toEqual(before);
      expect(deps.noteEditor.startEditing).not.toHaveBeenCalled();
    });

    it.each([
      ['locked container', { locked: true }],
      ['locked layer', { layerId: 'locked' }],
    ])('does not fall through a %s to an overlapping eligible container', (_name, input) => {
      const store = new ElementStore();
      const lower = createShape({
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 60 },
      });
      const top = createShape({
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 60 },
        ...input,
      });
      store.add(lower);
      store.add(top);
      const before = store.getAll();
      const { deps } = makeDeps(store, {
        toolContext: {
          camera: { zoom: 1, screenToWorld: (p: { x: number; y: number }) => p } as never,
          store,
          requestRender: vi.fn(),
          requestOverlayRender: vi.fn(),
          isLayerLocked: (id) => id === 'locked',
        },
      });
      document.elementFromPoint = () => null;

      const interactions = new ViewportInteractions(deps);
      interactions.onTapDown({ clientX: 50, clientY: 30 } as PointerEvent);
      interactions.onDoubleTap({ clientX: 50, clientY: 30 } as PointerEvent);

      expect(store.getAll()).toEqual(before);
      expect(deps.noteEditor.startEditing).not.toHaveBeenCalled();
    });
  });

  describe('onDoubleTap html activation', () => {
    const originalElementFromPoint = document.elementFromPoint;

    beforeEach(() => {
      vi.useFakeTimers();
      document.elementFromPoint = () => null;
    });

    afterEach(() => {
      vi.useRealTimers();
      document.elementFromPoint = originalElementFromPoint;
    });

    function doubleTap(interactions: ViewportInteractions, x: number, y: number): void {
      const event = { clientX: x, clientY: y } as PointerEvent;
      for (let i = 0; i < 2; i++) {
        interactions.onTapDown(event);
        interactions.onDoubleTap(event);
      }
    }

    function setup(html: HtmlElement, ...above: CanvasElement[]) {
      const store = new ElementStore();
      store.add(html);
      above.forEach((el) => store.add(el));
      const camera = { zoom: 1, screenToWorld: (p: { x: number; y: number }) => p } as never;
      const toolContext: ToolContext = {
        camera,
        store,
        requestRender: vi.fn(),
        requestOverlayRender: vi.fn(),
        isLayerVisible: (id) => id !== 'hidden',
        isLayerLocked: (id) => id === 'locked',
      };
      const { deps } = makeDeps(store, { camera, toolContext });
      return { interactions: new ViewportInteractions(deps), deps };
    }

    it('activates a rotated html element tapped inside its visual area', () => {
      const html = {
        ...createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 200, h: 20 } }),
        rotation: Math.PI / 2,
      };
      const { interactions, deps } = setup(html);
      doubleTap(interactions, 100, 80);
      expect(deps.interactMode.startInteracting).toHaveBeenCalledWith(html.id);
    });

    it.each([
      ['on a locked layer', { layerId: 'locked' }],
      ['that is itself locked', { locked: true }],
    ])('activates an html element %s', (_label, input) => {
      const html = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        ...input,
      });
      const { interactions, deps } = setup(html);
      doubleTap(interactions, 50, 50);
      expect(deps.interactMode.startInteracting).toHaveBeenCalledWith(html.id);
    });

    it('activates an html element under an arrow passing near the tap', () => {
      const html = createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 } });
      const arrow = {
        ...createArrow({ from: { x: 0, y: 55 }, to: { x: 200, y: 55 } }),
        index: 'a1',
      };
      const { interactions, deps } = setup(html, arrow);
      doubleTap(interactions, 50, 50);
      expect(deps.interactMode.startInteracting).toHaveBeenCalledWith(html.id);
    });

    it('does not activate an html element on a hidden layer', () => {
      const html = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        layerId: 'hidden',
      });
      const { interactions, deps } = setup(html);
      doubleTap(interactions, 50, 50);
      expect(deps.interactMode.startInteracting).not.toHaveBeenCalled();
    });

    it('double-tap on a live html element does not enter InteractMode', () => {
      const html = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        interactive: true,
      });
      const arrow = {
        ...createArrow({ from: { x: 0, y: 55 }, to: { x: 200, y: 55 } }),
        index: 'a1',
      };
      const { interactions, deps } = setup(html, arrow);
      doubleTap(interactions, 50, 50);
      expect(deps.interactMode.startInteracting).not.toHaveBeenCalled();
    });

    it('double-tap on a non-live html element still enters InteractMode', () => {
      const html = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        interactive: false,
      });
      const { interactions, deps } = setup(html);
      doubleTap(interactions, 50, 50);
      expect(deps.interactMode.startInteracting).toHaveBeenCalledWith(html.id);
    });
  });

  describe('liveFitHeight', () => {
    it('shrinks and grows wrapped text height without changing its width', () => {
      const store = new ElementStore();
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 80 },
        text: 'wrapped',
        wrap: true,
      });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      const node = nodeWithSize(24, 400);
      nodes.set(text.id, node);
      const interactions = new ViewportInteractions(deps);

      interactions.liveFitHeight(text.id);
      expect(textOf(store, text.id).size).toEqual({ w: 100, h: 24 });
      Object.defineProperty(node, 'scrollHeight', { value: 120, configurable: true });
      interactions.liveFitHeight(text.id);
      expect(textOf(store, text.id).size).toEqual({ w: 100, h: 120 });
    });

    it('shrinks and grows unwrapped text width from its content', () => {
      const store = new ElementStore();
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 40 },
        text: 'single line',
        wrap: false,
      });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      const node = nodeWithSize(40, 180);
      nodes.set(text.id, node);
      const interactions = new ViewportInteractions(deps);

      interactions.liveFitHeight(text.id);
      expect(textOf(store, text.id).size).toEqual({ w: 180, h: 40 });
      Object.defineProperty(node, 'scrollWidth', { value: 60, configurable: true });
      interactions.liveFitHeight(text.id);
      expect(textOf(store, text.id).size).toEqual({ w: 60, h: 40 });
    });

    it('preserves both dimensions when text autoResize is false', () => {
      const store = new ElementStore();
      const text = createText({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 40 },
        text: 'fixed',
        autoResize: false,
      });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      nodes.set(text.id, nodeWithSize(120, 220));

      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(textOf(store, text.id).size).toEqual({ w: 100, h: 40 });
    });

    it('moves the visible toolbar after each actual text fit', async () => {
      const store = new ElementStore();
      const text = createText({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(text);
      const editor = new NoteEditor();
      const { deps, nodes } = makeDeps(store, { noteEditor: editor });
      const node = nodeWithSize(80, 100);
      let top = 100;
      Object.defineProperty(node, 'getBoundingClientRect', {
        value: () => ({ top, left: 50, bottom: top + 40, right: 150, width: 100, height: 40 }),
      });
      document.body.appendChild(node);
      nodes.set(text.id, node);
      editor.startEditing(node, text.id, store);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const toolbar = document.querySelector<HTMLElement>('[data-note-toolbar]');
      if (!toolbar) throw new Error('expected toolbar');

      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(toolbar.style.top).toBe('44px');
      top = 200;
      Object.defineProperty(node, 'scrollHeight', { value: 120, configurable: true });
      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(toolbar.style.top).toBe('144px');
      editor.destroy(store);
      node.remove();
    });
    it('does not change a note height while editing', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(120));
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(heightOf(store.getById(note.id))).toBe(40);
    });

    it('keeps a manually enlarged note height while editing', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 120 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(20));
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(heightOf(store.getById(note.id))).toBe(120);
    });

    it('grows a text element to the measured scrollHeight', () => {
      const store = new ElementStore();
      const text = createText({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      nodes.set(text.id, nodeWithHeight(120));
      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(heightOf(store.getById(text.id))).toBe(120);
    });

    it('shrinks a text element to the measured scrollHeight', () => {
      const store = new ElementStore();
      const text = createText({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      nodes.set(text.id, nodeWithHeight(20));
      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(heightOf(store.getById(text.id))).toBe(20);
    });

    it('is a no-op when scrollHeight equals current height', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(40));
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(spy).not.toHaveBeenCalled();
      expect(heightOf(store.getById(note.id))).toBe(40);
    });

    it('is a no-op when scrollHeight is 0', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(0));
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(spy).not.toHaveBeenCalled();
      expect(heightOf(store.getById(note.id))).toBe(40);
    });

    it('is a no-op for a non-note/text element', () => {
      const store = new ElementStore();
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 } });
      store.add(shape);
      const { deps, nodes } = makeDeps(store);
      nodes.set(shape.id, nodeWithHeight(120));
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).liveFitHeight(shape.id);
      expect(spy).not.toHaveBeenCalled();
      expect(heightOf(store.getById(shape.id))).toBe(40);
    });

    it('is a no-op when there is no DOM node', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps } = makeDeps(store);
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(spy).not.toHaveBeenCalled();
      expect(heightOf(store.getById(note.id))).toBe(40);
    });
  });

  describe('fitNoteHeight (manual resize path is grow-only)', () => {
    it('grows a note to the measured scrollHeight', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(120));
      new ViewportInteractions(deps).fitNoteHeight(note.id);
      expect(heightOf(store.getById(note.id))).toBe(120);
    });

    it('does not shrink a note below its dragged height', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 200 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(30));
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).fitNoteHeight(note.id);
      expect(spy).not.toHaveBeenCalled();
      expect(heightOf(store.getById(note.id))).toBe(200);
    });

    it('editing a note keeps the same height as the manual resize path', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 200 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(30));
      const interactions = new ViewportInteractions(deps);
      interactions.fitNoteHeight(note.id);
      expect(heightOf(store.getById(note.id))).toBe(200);
      interactions.liveFitHeight(note.id);
      expect(heightOf(store.getById(note.id))).toBe(200);
    });
  });

  describe('one undo step for a live-resized edit session', () => {
    it('collapses live size updates and the text write into a single undo step', () => {
      const store = new ElementStore();
      const stack = new HistoryStack();
      const recorder = new HistoryRecorder(store, stack);
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 40 },
        text: 'before',
      });
      store.add(note);
      stack.clear();
      const before = stack.undoCount;

      recorder.begin();
      store.update(note.id, { size: { w: 100, h: 60 } });
      store.update(note.id, { size: { w: 100, h: 80 } });
      store.update(note.id, { text: 'after' });
      recorder.commit();

      expect(stack.undoCount).toBe(before + 1);

      stack.undo(store);
      const restored = store.getById(note.id);
      expect(restored && 'text' in restored ? restored.text : '').toBe('before');
      expect(heightOf(restored)).toBe(40);
    });
  });

  describe('onTextEditStop', () => {
    it('removes an empty note', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 }, text: '' });
      store.add(note);
      const removeSpy = vi.spyOn(store, 'remove');
      const { deps } = makeDeps(store);
      const interactions = new ViewportInteractions(deps);
      interactions.onTextEditStop(note.id);
      expect(removeSpy).toHaveBeenCalledWith(note.id);
      expect(store.getById(note.id)).toBeUndefined();
    });

    it('keeps a non-empty note', () => {
      const store = new ElementStore();
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 50 },
        text: 'hello',
      });
      store.add(note);
      const removeSpy = vi.spyOn(store, 'remove');
      const { deps, nodes } = makeDeps(store);
      const node = document.createElement('div');
      Object.defineProperty(node, 'scrollHeight', { value: 30, configurable: true });
      nodes.set(note.id, node);
      const interactions = new ViewportInteractions(deps);
      interactions.onTextEditStop(note.id);
      expect(removeSpy).not.toHaveBeenCalled();
      expect(store.getById(note.id)).toBeDefined();
    });
  });
});
