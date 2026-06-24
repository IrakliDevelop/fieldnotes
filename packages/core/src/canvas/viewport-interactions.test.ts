/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { ViewportInteractions } from './viewport-interactions';
import type { ViewportInteractionsDeps } from './viewport-interactions';
import { ElementStore } from '../elements/element-store';
import { createNote, createArrow, createShape } from '../elements/element-factory';
import type { ArrowElement, CanvasElement } from '../elements/types';

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
