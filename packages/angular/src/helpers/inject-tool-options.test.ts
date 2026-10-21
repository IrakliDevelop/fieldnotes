import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { HandTool, PencilTool, ShapeTool } from '@fieldnotes/core';
import type { PencilToolOptions } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectToolOptions } from './inject-tool-options';

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

describe('injectToolOptions', () => {
  it('holds null and the setter throws before a viewport exists', async () => {
    const {
      result: [options, setOptions],
    } = await mountHelper(() => injectToolOptions('pencil'), null);
    expect(options()).toBeNull();
    expect(() => setOptions({})).toThrow(
      '[fieldnotes] setToolOptions called before <fn-canvas> mounted',
    );
  });

  it('returns the current tool options', async () => {
    const viewport = viewportWith(new PencilTool({ color: '#ff0000', width: 5 }));
    const {
      result: [options],
    } = await mountHelper(() => injectToolOptions<PencilOptions>('pencil'), viewport);
    expect(options()).toEqual({
      color: '#ff0000',
      width: 5,
      smoothing: 1.5,
      minPointDistance: 3,
      progressiveSimplifyThreshold: 200,
      opacity: 1,
    });
  });

  it.each(['hand', 'nonexistent'])('returns null for %s (no options)', async (name) => {
    const {
      result: [options, setOptions],
    } = await mountHelper(() => injectToolOptions(name), viewportWith(new HandTool()));
    expect(options()).toBeNull();
    expect(() => setOptions({})).not.toThrow();
  });

  it('updates through the setter and through the tool', async () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options, setOptions],
    } = await mountHelper(() => injectToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    setOptions({ color: '#00ff00' });
    expect(options()?.color).toBe('#00ff00');
    pencil.setOptions({ color: '#0000ff' });
    expect(options()?.color).toBe('#0000ff');
  });

  it('keeps the same options object when a change leaves the options equal', async () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options],
    } = await mountHelper(() => injectToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    const before = options();
    pencil.setOptions({ color: '#ff0000' });
    expect(options()).toBe(before);
  });

  it('follows a toolName signal and stops reacting to the old tool', async () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const shape = new ShapeTool({ strokeWidth: 4 });
    const subscribe = pencil.onOptionsChange.bind(pencil);
    const unsubscribePencil = vi.fn();
    vi.spyOn(pencil, 'onOptionsChange').mockImplementation((listener) => {
      const off = subscribe(listener);
      unsubscribePencil.mockImplementation(off);
      return unsubscribePencil;
    });
    const name = signal('pencil');
    const {
      result: [options, setOptions],
      fixture,
    } = await mountHelper(() => injectToolOptions(name), viewportWith(pencil, shape));
    expect(options()?.['color']).toBe('#ff0000');

    name.set('shape');
    await fixture.whenStable();
    expect(options()?.['strokeWidth']).toBe(4);
    shape.setOptions({ strokeWidth: 9 });
    expect(options()?.['strokeWidth']).toBe(9);

    expect(unsubscribePencil).toHaveBeenCalledOnce();

    setOptions({ strokeWidth: 2 });
    expect(shape.getOptions().strokeWidth).toBe(2);
  });

  it('accepts a computed signal for the tool name', async () => {
    const name = signal('pencil');
    const viewport = viewportWith(new PencilTool(), new ShapeTool({ strokeWidth: 4 }));
    const {
      result: [options],
      fixture,
    } = await mountHelper(() => injectToolOptions(computed(() => name())), viewport);
    name.set('shape');
    await fixture.whenStable();
    expect(options()?.['strokeWidth']).toBe(4);
  });
});
