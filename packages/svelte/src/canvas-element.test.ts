import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Viewport } from '@fieldnotes/core';
import type { CanvasElementProps } from './index.js';
import CanvasChildren from './test-fixtures/CanvasChildren.svelte';
import CanvasList from './test-fixtures/CanvasList.svelte';

type Element = Omit<CanvasElementProps, 'children'>;

/** Renders a canvas holding one CanvasElement with `element` geometry. */
function renderElement(element: Element, onready?: (viewport: Viewport) => void) {
  const captured: { vp: Viewport | null } = { vp: null };
  const result = render(CanvasChildren, {
    props: {
      element,
      onready: (v: Viewport) => {
        captured.vp = v;
        onready?.(v);
      },
    },
  });
  const vp = captured.vp;
  if (!vp) throw new Error('onready was not called');
  return { ...result, vp };
}

const portalChild = () => document.querySelector('[data-testid="portal-child"]');

describe('CanvasElement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds a transient html element at the given position on mount', () => {
    const { vp } = renderElement({ position: { x: 10, y: 20 } });
    const elements = vp.store.getElementsByType('html');
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
    expect(elements[0]?.transient).toBe(true);
  });

  it('renders the children inside the canvas, leaving no orphan container in the DOM layer', () => {
    const { vp } = renderElement({ position: { x: 0, y: 0 } });
    expect(portalChild()?.textContent).toBe('Portal Content');
    expect(vp.domLayer.parentElement?.contains(portalChild())).toBe(true);
    expect(vp.domLayer.children.length).toBe(0);
  });

  it('removes the element and its content on unmount', async () => {
    const { vp, rerender } = renderElement({ position: { x: 0, y: 0 } });
    expect(vp.store.getElementsByType('html').length).toBe(1);
    await rerender({ element: undefined });
    expect(vp.store.getElementsByType('html').length).toBe(0);
    expect(portalChild()).toBeNull();
    expect(vp.domLayer.children.length).toBe(0);
  });

  it('uses the size prop when provided', () => {
    const { vp } = renderElement({ position: { x: 0, y: 0 }, size: { w: 400, h: 300 } });
    expect(vp.store.getElementsByType('html')[0]?.size).toEqual({ w: 400, h: 300 });
  });

  it('updates geometry on prop change and never records undo steps', async () => {
    const { vp, rerender } = renderElement({
      position: { x: 10, y: 0 },
      size: { w: 200, h: 100 },
    });
    expect(vp.history.undoCount).toBe(0);

    await rerender({ element: { position: { x: 55, y: 0 }, size: { w: 320, h: 100 } } });
    const elements = vp.store.getElementsByType('html');
    expect(elements[0]?.position).toEqual({ x: 55, y: 0 });
    expect(elements[0]?.size).toEqual({ w: 320, h: 100 });
    expect(vp.history.undoCount).toBe(0);

    await rerender({ element: undefined });
    expect(vp.history.undoCount).toBe(0);
  });

  it('does not update the store when new props carry equal geometry', async () => {
    const { vp, rerender } = renderElement({ position: { x: 1, y: 2 }, size: { w: 3, h: 4 } });
    const updates = vi.fn();
    vp.store.on('update', updates);
    await rerender({ element: { position: { x: 1, y: 2 }, size: { w: 3, h: 4 } } });
    expect(updates).not.toHaveBeenCalled();
  });

  it('is excluded from exported state', () => {
    const { vp } = renderElement({ position: { x: 10, y: 20 }, size: { w: 200, h: 100 } });
    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(vp.exportState().elements.filter((el) => el.type === 'html')).toEqual([]);
  });

  it('tags its store mutations with origin host', async () => {
    const origins: (string | undefined)[] = [];
    const { rerender, unmount } = renderElement({ position: { x: 0, y: 0 } }, (v) => {
      v.store.on('add', (_el, meta) => origins.push(meta.origin));
      v.store.on('update', (_ev, meta) => origins.push(meta.origin));
      v.store.on('remove', (_el, meta) => origins.push(meta.origin));
    });
    await rerender({ element: { position: { x: 40, y: 0 } } });
    await rerender({ element: undefined });
    unmount();
    expect(origins).toEqual(['host', 'host', 'host']);
  });

  it('stays mounted and rendered after a remote clear', async () => {
    const { vp } = renderElement({ position: { x: 10, y: 20 } });
    const id = vp.store.getElementsByType('html')[0]?.id;

    // Replays the sync client's remote clear: transients snapshotted, store cleared, re-added.
    const transients = vp.store.snapshot().filter((el) => el.type === 'html' && el.transient);
    vp.store.clear({ origin: 'remote' });
    for (const el of transients) vp.store.add(el, { origin: 'remote' });
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(id);
    expect(portalChild()).not.toBeNull();
  });

  it('is re-added at its latest position after a local clear, without an undo step', async () => {
    const { vp, rerender } = renderElement({ position: { x: 10, y: 20 } });
    await rerender({ element: { position: { x: 70, y: 20 } } });

    vp.store.clear();
    const undoCountAfterClear = vp.history.undoCount;
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.position).toEqual({ x: 70, y: 20 });
    expect(portalChild()).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterClear);
  });

  it('stays mounted and rendered after viewport.loadState', async () => {
    const { vp } = renderElement({ position: { x: 10, y: 20 } });
    // The exported state omits the transient element; loadState emits one coalesced `batch`.
    vp.loadState(vp.exportState());
    const undoCountAfterLoad = vp.history.undoCount;
    await Promise.resolve();

    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(portalChild()).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterLoad);
  });

  it('does not re-register when unmounted before the clear recovery microtask runs', async () => {
    const { vp, rerender } = renderElement({ position: { x: 0, y: 0 } });
    vp.store.clear();
    await rerender({ element: undefined });
    await Promise.resolve();
    expect(vp.store.getElementsByType('html').length).toBe(0);
  });
});

describe('unmounting a whole canvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('tears down a CanvasElement and a Minimap with the viewport, without errors', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { container, unmount } = render(CanvasChildren, {
      props: { element: { position: { x: 0, y: 0 } }, minimap: {} },
    });
    expect(container.querySelector('[aria-label="Collapse minimap"]')).not.toBeNull();
    expect(portalChild()).not.toBeNull();

    expect(() => unmount()).not.toThrow();
    await Promise.resolve();
    expect(portalChild()).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('CanvasElement in keyed and conditional blocks', () => {
  function renderList(props: { items?: number[]; toggled?: boolean }) {
    const captured: { vp: Viewport | null } = { vp: null };
    const result = render(CanvasList, {
      props: { ...props, onready: (v: Viewport) => (captured.vp = v) },
    });
    const vp = captured.vp;
    if (!vp) throw new Error('onready was not called');
    return { ...result, vp };
  }

  const items = () => [...document.querySelectorAll<HTMLElement>('[data-testid="item"]')];
  const texts = () => items().map((n) => n.textContent);
  const plains = () => [...document.querySelectorAll<HTMLElement>('[data-testid="plain"]')];
  const contentsRoots = () => [
    ...document.querySelectorAll<HTMLElement>('div[style*="display: contents"]'),
  ];

  /** Asserts the plain siblings stay in source order and outside every canvas wrapper. */
  function expectPlainsInPlace() {
    expect(plains().map((p) => p.textContent)).toEqual(['p-before', 'p-after']);
    for (const p of plains()) expect(p.closest('[data-element-id]')).toBeNull();
  }

  /** Asserts each content node sits inside the core wrapper of the html element holding it. */
  function expectAllOnCanvas(vp: Viewport) {
    const ids = vp.store.getElementsByType('html').map((el) => el.id);
    for (const node of items()) {
      const wrapperId = node.closest<HTMLElement>('[data-element-id]')?.dataset['elementId'];
      expect(ids).toContain(wrapperId);
    }
  }

  it('keeps every content node in its canvas wrapper across a keyed reorder', async () => {
    const { vp, rerender } = renderList({ items: [1, 2, 3] });
    await rerender({ items: [3, 2, 1] });
    expect(vp.store.getElementsByType('html').length).toBe(3);
    expect(texts().sort()).toEqual(['1', '2', '3']);
    expectAllOnCanvas(vp);
    for (const el of vp.store.getElementsByType('html')) {
      const wrapper = vp.domLayer.parentElement?.querySelector<HTMLElement>(
        `[data-element-id="${el.id}"]`,
      );
      expect(wrapper?.textContent).toBe(String(el.position.x));
    }
    expect(contentsRoots()).toHaveLength(3);
    for (const root of contentsRoots()) expect(root.children.length).toBe(0);
  });

  it('removes only the removed item from a keyed list, leaving no orphan nodes', async () => {
    const { vp, rerender, container } = renderList({ items: [1, 2, 3] });
    await rerender({ items: [1, 3] });
    expect(vp.store.getElementsByType('html').length).toBe(2);
    expect(texts().sort()).toEqual(['1', '3']);
    expectAllOnCanvas(vp);
    expect(vp.domLayer.children.length).toBe(0);
    expect(container.textContent).not.toContain('2');
  });

  it('toggles a CanvasElement between siblings without disturbing them', async () => {
    const { vp, rerender } = renderList({ toggled: true });
    expect(texts().sort()).toEqual(['after', 'before', 'toggled']);
    expectPlainsInPlace();
    expect(plains()[0]?.nextElementSibling?.getAttribute('style')).toBe('display: contents');

    await rerender({ toggled: false });
    expect(vp.store.getElementsByType('html').length).toBe(2);
    expect(texts().sort()).toEqual(['after', 'before']);
    expectAllOnCanvas(vp);
    expectPlainsInPlace();

    await rerender({ toggled: true });
    expect(vp.store.getElementsByType('html').length).toBe(3);
    expect(texts().sort()).toEqual(['after', 'before', 'toggled']);
    expectAllOnCanvas(vp);
    expectPlainsInPlace();
    expect(plains()[0]?.nextElementSibling?.getAttribute('style')).toBe('display: contents');
    expect(vp.domLayer.children.length).toBe(0);
  });
});
