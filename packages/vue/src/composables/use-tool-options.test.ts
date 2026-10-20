import { describe, it, expect, afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { HandTool, PencilTool, ShapeTool } from '@fieldnotes/core';
import type { PencilToolOptions } from '@fieldnotes/core';
import { useToolOptions } from './use-tool-options';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(() => {
  destroyTestViewports();
  vi.restoreAllMocks();
});

// `PencilToolOptions` is an interface without an index signature; this mapped copy has one.
type PencilOptions = { [K in keyof PencilToolOptions]: PencilToolOptions[K] };

function viewportWith(...tools: (PencilTool | ShapeTool | HandTool)[]) {
  const viewport = createTestViewport();
  for (const tool of tools) viewport.toolManager.register(tool);
  return viewport;
}

describe('useToolOptions', () => {
  it('returns the current tool options', () => {
    const viewport = viewportWith(new PencilTool({ color: '#ff0000', width: 5 }));
    const {
      result: [options],
    } = mountComposable(() => useToolOptions<PencilOptions>('pencil'), viewport);
    expect(options.value).toEqual({
      color: '#ff0000',
      width: 5,
      smoothing: 1.5,
      minPointDistance: 3,
      progressiveSimplifyThreshold: 200,
      opacity: 1,
    });
  });

  it.each(['hand', 'nonexistent'])('returns null for %s (no options)', (name) => {
    const {
      result: [options, setOptions],
    } = mountComposable(() => useToolOptions(name), viewportWith(new HandTool()));
    expect(options.value).toBeNull();
    expect(() => setOptions({})).not.toThrow();
  });

  it('updates through the setter and through the tool', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options, setOptions],
    } = mountComposable(() => useToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    setOptions({ color: '#00ff00' });
    expect(options.value?.color).toBe('#00ff00');
    pencil.setOptions({ color: '#0000ff' });
    expect(options.value?.color).toBe('#0000ff');
  });

  it('keeps the same options object when a change leaves the options equal', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options],
    } = mountComposable(() => useToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    const before = options.value;
    pencil.setOptions({ color: '#ff0000' });
    expect(options.value).toBe(before);
  });

  it('follows a toolName ref and stops reacting to the old tool', async () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const shape = new ShapeTool({ strokeWidth: 4 });
    const subscribe = pencil.onOptionsChange.bind(pencil);
    const unsubscribePencil = vi.fn();
    vi.spyOn(pencil, 'onOptionsChange').mockImplementation((listener) => {
      const off = subscribe(listener);
      unsubscribePencil.mockImplementation(off);
      return unsubscribePencil;
    });
    const name = ref('pencil');
    const {
      result: [options, setOptions],
    } = mountComposable(() => useToolOptions(name), viewportWith(pencil, shape));
    expect(options.value?.color).toBe('#ff0000');

    name.value = 'shape';
    await nextTick();
    expect(options.value?.strokeWidth).toBe(4);
    shape.setOptions({ strokeWidth: 9 });
    expect(options.value?.strokeWidth).toBe(9);

    expect(unsubscribePencil).toHaveBeenCalledOnce();

    setOptions({ strokeWidth: 2 });
    expect(shape.getOptions().strokeWidth).toBe(2);
  });

  it('accepts a getter for the tool name', async () => {
    const name = ref('pencil');
    const viewport = viewportWith(new PencilTool(), new ShapeTool({ strokeWidth: 4 }));
    const {
      result: [options],
    } = mountComposable(() => useToolOptions(() => name.value), viewport);
    name.value = 'shape';
    await nextTick();
    expect(options.value?.strokeWidth).toBe(4);
  });
});
