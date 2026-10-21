/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Viewport } from './viewport';
import { attachHostElement } from './host-element';

const viewports: Viewport[] = [];

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const viewport = new Viewport(host);
  viewports.push(viewport);
  const container = document.createElement('div');
  return { viewport, container };
}

function htmlElements(viewport: Viewport) {
  return viewport.store.getElementsByType('html');
}

afterEach(() => {
  for (const v of viewports.splice(0)) v.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('attachHostElement', () => {
  it('registers a transient html element at the given geometry', () => {
    const { viewport, container } = setup();
    attachHostElement(viewport, container, {
      position: { x: 10, y: 20 },
      size: { w: 400, h: 300 },
    });
    const elements = htmlElements(viewport);
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
    expect(elements[0]?.size).toEqual({ w: 400, h: 300 });
    expect(elements[0]?.transient).toBe(true);
  });

  it('places the container in the document synchronously', () => {
    const { viewport, container } = setup();
    attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    expect(container.isConnected).toBe(true);
  });

  it('records no undo step and is absent from exported state', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    handle.setGeometry({ position: { x: 5, y: 0 } });
    expect(viewport.history.undoCount).toBe(0);
    expect(viewport.exportState().elements.filter((el) => el.type === 'html')).toEqual([]);
    handle.destroy();
    expect(viewport.history.undoCount).toBe(0);
  });

  it('tags add, update and remove with origin host', () => {
    const { viewport, container } = setup();
    const origins: (string | undefined)[] = [];
    viewport.store.on('add', (_el, meta) => origins.push(meta.origin));
    viewport.store.on('update', (_ev, meta) => origins.push(meta.origin));
    viewport.store.on('remove', (_el, meta) => origins.push(meta.origin));
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    handle.setGeometry({ position: { x: 40, y: 0 } });
    handle.destroy();
    expect(origins).toEqual(['host', 'host', 'host']);
  });

  it('setGeometry updates the store and requests a render', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, {
      position: { x: 10, y: 0 },
      size: { w: 200, h: 100 },
    });
    const render = vi.spyOn(viewport, 'requestRender');
    handle.setGeometry({ position: { x: 55, y: 0 }, size: { w: 320, h: 100 } });
    expect(htmlElements(viewport)[0]?.position).toEqual({ x: 55, y: 0 });
    expect(htmlElements(viewport)[0]?.size).toEqual({ w: 320, h: 100 });
    expect(render).toHaveBeenCalled();
  });

  it('setGeometry with value-equal geometry makes no store update', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, {
      position: { x: 1, y: 2 },
      size: { w: 30, h: 40 },
    });
    const updates = vi.fn();
    viewport.store.on('update', updates);
    handle.setGeometry({ position: { x: 1, y: 2 }, size: { w: 30, h: 40 } });
    expect(updates).not.toHaveBeenCalled();
  });

  it('setGeometry treats size omitted, given, and an undefined size key by value', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    const updates = vi.fn();
    viewport.store.on('update', updates);

    handle.setGeometry({ position: { x: 0, y: 0 } });
    expect(updates).toHaveBeenCalledTimes(0);

    handle.setGeometry({ position: { x: 0, y: 0 }, size: { w: 300, h: 100 } });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(htmlElements(viewport)[0]?.size).toEqual({ w: 300, h: 100 });

    handle.setGeometry({ position: { x: 0, y: 0 }, size: undefined });
    expect(updates).toHaveBeenCalledTimes(2);
    expect(htmlElements(viewport)[0]?.size).toEqual({ w: 300, h: 100 });

    handle.setGeometry({ position: { x: 0, y: 0 } });
    expect(updates).toHaveBeenCalledTimes(2);
  });

  it('stores a copy of the geometry, not the caller object', async () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 10, y: 20 } });
    const next = { position: { x: 30, y: 20 }, size: { w: 50, h: 60 } };
    handle.setGeometry(next);
    next.position.x = 99;
    next.size.w = 99;
    viewport.store.clear();
    await Promise.resolve();
    expect(htmlElements(viewport)[0]?.position).toEqual({ x: 30, y: 20 });
    expect(htmlElements(viewport)[0]?.size).toEqual({ w: 50, h: 60 });
  });

  it('re-registers at the latest geometry after a local clear, without an undo step', async () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 10, y: 20 } });
    handle.setGeometry({ position: { x: 70, y: 20 }, size: { w: 50, h: 60 } });
    viewport.store.clear();
    const undoCount = viewport.history.undoCount;
    await Promise.resolve();
    const after = htmlElements(viewport);
    expect(after.length).toBe(1);
    expect(after[0]?.position).toEqual({ x: 70, y: 20 });
    expect(after[0]?.size).toEqual({ w: 50, h: 60 });
    expect(container.isConnected).toBe(true);
    expect(viewport.history.undoCount).toBe(undoCount);
  });

  it('re-registers after loadState replaces the store in a batch', async () => {
    const { viewport, container } = setup();
    attachHostElement(viewport, container, { position: { x: 10, y: 20 } });
    viewport.loadState(viewport.exportState());
    const undoCount = viewport.history.undoCount;
    await Promise.resolve();
    expect(htmlElements(viewport).length).toBe(1);
    expect(container.isConnected).toBe(true);
    expect(viewport.history.undoCount).toBe(undoCount);
  });

  it('restores the container to a survivor re-added synchronously after a clear', async () => {
    const { viewport, container } = setup();
    attachHostElement(viewport, container, { position: { x: 10, y: 20 } });
    const id = htmlElements(viewport)[0]?.id;
    // Mirrors the sync client: transients are snapshotted, cleared, then re-added in the event.
    const transients = viewport.store.snapshot().filter((el) => el.type === 'html');
    viewport.store.on('clear', () => {
      for (const el of transients) viewport.store.add(el, { origin: 'remote' });
    });
    const update = vi.spyOn(viewport, 'updateHtmlElement');
    viewport.store.clear({ origin: 'remote' });
    await Promise.resolve();
    const after = htmlElements(viewport);
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(id);
    expect(update).toHaveBeenCalledWith(id, container);
    expect(container.isConnected).toBe(true);
  });

  it('destroy removes the element and the container', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    handle.destroy();
    expect(htmlElements(viewport).length).toBe(0);
    expect(container.isConnected).toBe(false);
  });

  it('destroy removes a container still parented directly in domLayer', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    // Pinned directly in domLayer by hand to reach destroy's orphan-removal fallback.
    viewport.domLayer.appendChild(container);
    handle.destroy();
    expect(container.parentNode).toBeNull();
  });

  it('destroy after a re-registration removes the re-registered element', async () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    viewport.store.clear();
    await Promise.resolve();
    handle.destroy();
    expect(htmlElements(viewport).length).toBe(0);
  });

  it('destroy twice is a no-op', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    handle.destroy();
    const events = vi.fn();
    viewport.store.on('remove', events);
    const render = vi.spyOn(viewport, 'requestRender');
    handle.destroy();
    expect(events).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('destroy stops listening for clear and batch', async () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    handle.destroy();
    viewport.store.clear();
    viewport.loadState(viewport.exportState());
    await Promise.resolve();
    expect(htmlElements(viewport).length).toBe(0);
  });

  it('destroy before a pending recovery microtask runs prevents re-registration', async () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    viewport.store.clear();
    handle.destroy();
    await Promise.resolve();
    expect(htmlElements(viewport).length).toBe(0);
    expect(container.isConnected).toBe(false);
  });

  it('destroy after viewport.destroy does not throw', () => {
    const { viewport, container } = setup();
    const handle = attachHostElement(viewport, container, { position: { x: 0, y: 0 } });
    viewport.destroy();
    expect(() => handle.destroy()).not.toThrow();
    expect(htmlElements(viewport).length).toBe(0);
  });
});
