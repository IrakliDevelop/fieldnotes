import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createApp, h, nextTick, ref, type ExtractPublicPropTypes } from 'vue';
import type { Viewport } from '@fieldnotes/core';
import { FieldNotesCanvas } from './field-notes-canvas';
import type { canvasElementProps } from './canvas-element';
import { CanvasElement, type CanvasElementProps } from './canvas-element';
import { Minimap } from './minimap';

enableAutoUnmount(afterEach);

/** Mounts a canvas whose default slot is `slot`; resolves once the slot has rendered. */
async function mountCanvas(slot: () => ReturnType<typeof h> | null) {
  const captured: { vp: Viewport | null } = { vp: null };
  const wrapper = mount(
    () => h(FieldNotesCanvas, { onReady: (v: Viewport) => (captured.vp = v) }, { default: slot }),
    { attachTo: document.body },
  );
  // One tick renders the slot; the next renders the Teleport into the mounted container.
  await nextTick();
  await nextTick();
  const vp = captured.vp;
  if (!vp) throw new Error('onReady was not called');
  return { wrapper, vp };
}

describe('CanvasElement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('declares runtime props matching CanvasElementProps', () => {
    expectTypeOf<ExtractPublicPropTypes<typeof canvasElementProps>>().branded.toEqualTypeOf<
      Readonly<CanvasElementProps>
    >();
  });

  it('adds a transient html element at the given position on mount', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 10, y: 20 } }, () => h('div', 'Hello')),
    );
    const elements = vp.store.getElementsByType('html');
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
    expect(elements[0]?.transient).toBe(true);
  });

  it('teleports the default slot into the registered container', async () => {
    await mountCanvas(() =>
      h(CanvasElement, { position: { x: 0, y: 0 } }, () =>
        h('span', { 'data-testid': 'portal-child' }, 'Portal Content'),
      ),
    );
    const child = document.querySelector('[data-testid="portal-child"]');
    expect(child?.textContent).toBe('Portal Content');
  });

  it('leaves no orphan container in the DOM layer', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 5, y: 6 } }, () => h('span', 'x')),
    );
    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(vp.domLayer.children.length).toBe(0);
  });

  it('removes the element from the store on unmount', async () => {
    const shown = ref(true);
    const { vp } = await mountCanvas(() =>
      shown.value ? h(CanvasElement, { position: { x: 0, y: 0 } }, () => h('div')) : null,
    );
    expect(vp.store.getElementsByType('html').length).toBe(1);
    shown.value = false;
    await nextTick();
    expect(vp.store.getElementsByType('html').length).toBe(0);
  });

  it('uses the size prop when provided', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 0, y: 0 }, size: { w: 400, h: 300 } }, () => h('div')),
    );
    expect(vp.store.getElementsByType('html')[0]?.size).toEqual({ w: 400, h: 300 });
  });

  it('updates geometry on prop change and never records undo steps', async () => {
    const x = ref(10);
    const w = ref(200);
    const shown = ref(true);
    const { vp } = await mountCanvas(() =>
      shown.value
        ? h(CanvasElement, { position: { x: x.value, y: 0 }, size: { w: w.value, h: 100 } }, () =>
            h('div'),
          )
        : null,
    );
    expect(vp.history.undoCount).toBe(0);

    x.value = 55;
    w.value = 320;
    await nextTick();
    const elements = vp.store.getElementsByType('html');
    expect(elements[0]?.position).toEqual({ x: 55, y: 0 });
    expect(elements[0]?.size).toEqual({ w: 320, h: 100 });
    expect(vp.history.undoCount).toBe(0);

    shown.value = false;
    await nextTick();
    expect(vp.history.undoCount).toBe(0);
  });

  it('accepts a class attribute without a Vue warning', async () => {
    const warnHandler = vi.fn();
    const app = createApp({
      render: () =>
        h(FieldNotesCanvas, null, () =>
          h(CanvasElement, { position: { x: 0, y: 0 }, class: 'card' }, () => h('div')),
        ),
    });
    app.config.warnHandler = warnHandler;
    app.mount(document.createElement('div'));
    await nextTick();
    await nextTick();
    app.unmount();
    expect(warnHandler).not.toHaveBeenCalled();
  });

  it('does not update the store when a parent re-renders with equal geometry', async () => {
    const tick = ref(0);
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 1, y: 2 }, 'data-tick': tick.value }, () => h('div')),
    );
    const updates = vi.fn();
    vp.store.on('update', updates);
    tick.value++;
    await nextTick();
    expect(updates).not.toHaveBeenCalled();
  });

  it('is excluded from exported state', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 10, y: 20 }, size: { w: 200, h: 100 } }, () => h('div')),
    );
    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(vp.exportState().elements.filter((el) => el.type === 'html')).toEqual([]);
  });

  it('tags its store mutations with origin host', async () => {
    const origins: (string | undefined)[] = [];
    const x = ref(0);
    const shown = ref(true);
    const wrapper = mount(() =>
      h(
        FieldNotesCanvas,
        {
          onReady: (v: Viewport) => {
            v.store.on('add', (_el, meta) => origins.push(meta.origin));
            v.store.on('update', (_ev, meta) => origins.push(meta.origin));
            v.store.on('remove', (_el, meta) => origins.push(meta.origin));
          },
        },
        {
          default: () =>
            shown.value
              ? h(CanvasElement, { position: { x: x.value, y: 0 } }, () => h('div'))
              : null,
        },
      ),
    );
    await nextTick();
    x.value = 40;
    await nextTick();
    shown.value = false;
    await nextTick();
    wrapper.unmount();
    expect(origins).toEqual(['host', 'host', 'host']);
  });

  it('stays mounted and rendered after a remote clear', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 10, y: 20 } }, () =>
        h('span', { 'data-testid': 'clear-survivor' }),
      ),
    );
    const id = vp.store.getElementsByType('html')[0]?.id;

    // Replays the sync client's remote clear: transients snapshotted, store cleared, re-added.
    const transients = vp.store.snapshot().filter((el) => el.type === 'html' && el.transient);
    vp.store.clear({ origin: 'remote' });
    for (const el of transients) vp.store.add(el, { origin: 'remote' });
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(id);
    expect(document.querySelector('[data-testid="clear-survivor"]')).not.toBeNull();
  });

  it('is re-added at its latest position after a local clear, without an undo step', async () => {
    const x = ref(10);
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: x.value, y: 20 } }, () =>
        h('span', { 'data-testid': 'local-clear-survivor' }),
      ),
    );
    x.value = 70;
    await nextTick();

    vp.store.clear();
    const undoCountAfterClear = vp.history.undoCount;
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.position).toEqual({ x: 70, y: 20 });
    expect(document.querySelector('[data-testid="local-clear-survivor"]')).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterClear);
  });

  it('stays mounted and rendered after viewport.loadState', async () => {
    const { vp } = await mountCanvas(() =>
      h(CanvasElement, { position: { x: 10, y: 20 } }, () =>
        h('span', { 'data-testid': 'load-state-survivor' }),
      ),
    );
    // The exported state omits the transient element; loadState emits one coalesced `batch`.
    vp.loadState(vp.exportState());
    const undoCountAfterLoad = vp.history.undoCount;
    await Promise.resolve();

    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(document.querySelector('[data-testid="load-state-survivor"]')).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterLoad);
  });

  it('does not re-register when unmounted before the clear recovery microtask runs', async () => {
    const shown = ref(true);
    const { vp } = await mountCanvas(() =>
      shown.value ? h(CanvasElement, { position: { x: 0, y: 0 } }, () => h('div')) : null,
    );
    vp.store.clear();
    shown.value = false;
    await nextTick();
    await Promise.resolve();
    expect(vp.store.getElementsByType('html').length).toBe(0);
  });
});

describe('unmounting a whole canvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('tears down a CanvasElement and a Minimap after the viewport is destroyed, without errors', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const errorHandler = vi.fn();
    const warnHandler = vi.fn();
    const app = createApp({
      render: () =>
        h(FieldNotesCanvas, null, () => [
          h(CanvasElement, { position: { x: 0, y: 0 } }, () => h('div')),
          h(Minimap),
        ]),
    });
    app.config.errorHandler = errorHandler;
    app.config.warnHandler = warnHandler;
    const host = document.createElement('div');
    app.mount(host);
    await nextTick();
    expect(host.querySelector('[aria-label="Collapse minimap"]')).not.toBeNull();

    expect(() => app.unmount()).not.toThrow();
    await Promise.resolve();
    expect(errorHandler).not.toHaveBeenCalled();
    expect(warnHandler).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
