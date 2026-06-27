/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { ViewportInteractions } from './viewport-interactions';
import type { ViewportInteractionsDeps } from './viewport-interactions';
import { ElementStore } from '../elements/element-store';
import { createNote, createArrow, createShape, createText } from '../elements/element-factory';
import type { ArrowElement, CanvasElement } from '../elements/types';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';

function nodeWithHeight(h: number): HTMLDivElement {
  const node = document.createElement('div');
  Object.defineProperty(node, 'scrollHeight', { value: h, configurable: true });
  return node;
}

function makeDeps(store: ElementStore, overrides: Partial<ViewportInteractionsDeps> = {}) {
  const nodes = new Map<string, HTMLElement>();
  const deps: ViewportInteractionsDeps = {
    store,
    camera: { screenToWorld: (p: { x: number; y: number }) => p } as never,
    wrapper: document.createElement('div') as HTMLDivElement,
    domLayer: document.createElement('div') as HTMLDivElement,
    renderLoop: { flush: vi.fn() } as never,
    domNodeManager: { getNode: (id: string) => nodes.get(id) } as never,
    noteEditor: { startEditing: vi.fn() } as never,
    arrowLabelEditor: { startEditing: vi.fn() } as never,
    interactMode: { startInteracting: vi.fn(), stopInteracting: vi.fn() } as never,
    renderer: { setLabelEditingId: vi.fn() } as never,
    recorder: { begin: vi.fn(), commit: vi.fn() } as never,
    requestRender: vi.fn(),
    addImage: vi.fn(() => 'img-id'),
    ...overrides,
  };
  return { deps, nodes };
}

interface Priv {
  hitTestWorld: (w: { x: number; y: number }) => CanvasElement | null;
  findArrowAt: (w: { x: number; y: number }) => ArrowElement | undefined;
}

describe('ViewportInteractions', () => {
  describe('hitTestWorld', () => {
    it('returns a sized element under the point', () => {
      const store = new ElementStore();
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      store.add(shape);
      const { deps } = makeDeps(store);
      const interactions = new ViewportInteractions(deps) as unknown as Priv;
      expect(interactions.hitTestWorld({ x: 50, y: 50 })?.id).toBe(shape.id);
    });

    it('returns null when the point misses every element', () => {
      const store = new ElementStore();
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      store.add(shape);
      const { deps } = makeDeps(store);
      const interactions = new ViewportInteractions(deps) as unknown as Priv;
      expect(interactions.hitTestWorld({ x: 500, y: 500 })).toBeNull();
    });
  });

  describe('findArrowAt', () => {
    it('finds an arrow near the world point', () => {
      const store = new ElementStore();
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      store.add(arrow);
      const { deps } = makeDeps(store);
      const interactions = new ViewportInteractions(deps) as unknown as Priv;
      expect(interactions.findArrowAt({ x: 50, y: 0 })?.id).toBe(arrow.id);
    });

    it('returns undefined when far from any arrow', () => {
      const store = new ElementStore();
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      store.add(arrow);
      const { deps } = makeDeps(store);
      const interactions = new ViewportInteractions(deps) as unknown as Priv;
      expect(interactions.findArrowAt({ x: 50, y: 80 })).toBeUndefined();
    });
  });

  describe('liveFitHeight', () => {
    it('grows a note to the measured scrollHeight', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(120));
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(store.getById(note.id)?.size.h).toBe(120);
    });

    it('shrinks a note to the measured scrollHeight', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(20));
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(store.getById(note.id)?.size.h).toBe(20);
    });

    it('grows a text element to the measured scrollHeight', () => {
      const store = new ElementStore();
      const text = createText({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      nodes.set(text.id, nodeWithHeight(120));
      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(store.getById(text.id)?.size.h).toBe(120);
    });

    it('shrinks a text element to the measured scrollHeight', () => {
      const store = new ElementStore();
      const text = createText({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(text);
      const { deps, nodes } = makeDeps(store);
      nodes.set(text.id, nodeWithHeight(20));
      new ViewportInteractions(deps).liveFitHeight(text.id);
      expect(store.getById(text.id)?.size.h).toBe(20);
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
      expect(store.getById(note.id)?.size.h).toBe(40);
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
      expect(store.getById(note.id)?.size.h).toBe(40);
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
      expect(store.getById(shape.id)?.size.h).toBe(40);
    });

    it('is a no-op when there is no DOM node', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, text: 'x' });
      store.add(note);
      const { deps } = makeDeps(store);
      const spy = vi.spyOn(store, 'update');
      new ViewportInteractions(deps).liveFitHeight(note.id);
      expect(spy).not.toHaveBeenCalled();
      expect(store.getById(note.id)?.size.h).toBe(40);
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
      expect(store.getById(note.id)?.size.h).toBe(120);
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
      expect(store.getById(note.id)?.size.h).toBe(200);
    });

    it('editing a note (liveFitHeight) shrinks it where manual resize would not', () => {
      const store = new ElementStore();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 200 }, text: 'x' });
      store.add(note);
      const { deps, nodes } = makeDeps(store);
      nodes.set(note.id, nodeWithHeight(30));
      const interactions = new ViewportInteractions(deps);
      interactions.fitNoteHeight(note.id);
      expect(store.getById(note.id)?.size.h).toBe(200);
      interactions.liveFitHeight(note.id);
      expect(store.getById(note.id)?.size.h).toBe(30);
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
      expect(restored?.size.h).toBe(40);
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
