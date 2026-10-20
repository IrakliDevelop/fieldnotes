import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createApp, h, nextTick, ref, type ExtractPublicPropTypes } from 'vue';
import { MinimapController } from '@fieldnotes/core';
import { FieldNotesCanvas } from './field-notes-canvas';
import type { minimapProps } from './minimap';
import { Minimap, type MinimapProps } from './minimap';

enableAutoUnmount(afterEach);

// Permissive fake 2D context: any drawing call succeeds; property writes are kept. These tests
// assert component behavior (canvas presence, controller lifecycle), not drawing output.
function makeContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      return vi.fn();
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => makeContext());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mounts a canvas with `props` on its Minimap; resolves once the minimap has rendered. */
async function mountMinimap(
  props: Record<string, unknown> = {},
  attrs: Record<string, unknown> = {},
) {
  const wrapper = mount(() => h(FieldNotesCanvas, null, () => h(Minimap, { ...props, ...attrs })));
  await nextTick();
  return wrapper;
}

const collapseButton = 'button[aria-label="Collapse minimap"]';
const expandButton = 'button[aria-label="Expand minimap"]';

describe('Minimap', () => {
  it('declares runtime props matching MinimapProps', () => {
    expectTypeOf<ExtractPublicPropTypes<typeof minimapProps>>().branded.toEqualTypeOf<
      Readonly<MinimapProps>
    >();
  });

  it('renders an expanded minimap by default', async () => {
    const wrapper = await mountMinimap();
    // The FieldNotesCanvas host canvas plus the minimap's own canvas.
    expect(wrapper.findAll('canvas').length).toBe(2);
    expect(wrapper.find(collapseButton).text()).toBe('–');
  });

  it('renders only a button when defaultCollapsed', async () => {
    const wrapper = await mountMinimap({ defaultCollapsed: true });
    expect(wrapper.findAll('canvas').length).toBe(1);
    expect(wrapper.find(expandButton).text()).toBe('▣');
    expect(wrapper.find(collapseButton).exists()).toBe(false);
  });

  it('constructs no controller while collapsed', async () => {
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    await mountMinimap({ defaultCollapsed: true });
    expect(requestDraw).not.toHaveBeenCalled();
  });

  it('clicking collapse removes the canvas and disposes the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const wrapper = await mountMinimap();
    await wrapper.find(collapseButton).trigger('click');
    expect(wrapper.findAll('canvas').length).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(wrapper.find(expandButton).exists()).toBe(true);
  });

  it('clicking expand after collapse recreates a controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const wrapper = await mountMinimap();
    expect(requestDraw).toHaveBeenCalledTimes(1);

    await wrapper.find(collapseButton).trigger('click');
    await wrapper.find(expandButton).trigger('click');

    expect(wrapper.findAll('canvas').length).toBe(2);
    expect(requestDraw).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a prop change replaces the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const width = ref(100);
    mount(() => h(FieldNotesCanvas, null, () => h(Minimap, { width: width.value })));
    await nextTick();
    width.value = 150;
    await nextTick();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(requestDraw).toHaveBeenCalledTimes(2);
  });

  it('unmounting while expanded disposes the controller exactly once', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const wrapper = await mountMinimap();
    wrapper.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('throws outside the provider', () => {
    const errorHandler = vi.fn();
    const app = createApp({ render: () => h(Minimap) });
    app.config.errorHandler = errorHandler;
    app.mount(document.createElement('div'));
    expect(errorHandler.mock.calls[0]?.[0]).toEqual(
      new Error('useViewport must be used inside <FieldNotesCanvas>'),
    );
  });

  it('applies width/height props to the canvas inline style', async () => {
    const wrapper = await mountMinimap({ width: 120, height: 80 });
    const canvas = wrapper.find(collapseButton).element.parentElement?.querySelector('canvas');
    expect(canvas?.style.width).toBe('120px');
    expect(canvas?.style.height).toBe('80px');
  });

  it.each([
    ['expanded', false, 'DIV'],
    ['collapsed', true, 'BUTTON'],
  ])('passes class and style through to the %s root', async (_, defaultCollapsed, tag) => {
    const wrapper = await mountMinimap(
      { defaultCollapsed },
      { class: 'corner', style: { position: 'absolute', cursor: 'move' } },
    );
    const root = wrapper.find('.corner').element as HTMLElement;
    expect(root.tagName).toBe(tag);
    expect(root.style.position).toBe('absolute');
    expect(root.style.cursor).toBe('move');
  });
});
