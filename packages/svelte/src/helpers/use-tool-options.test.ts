import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Readable } from 'svelte/store';
import { HandTool, PencilTool, ShapeTool } from '@fieldnotes/core';
import type { PencilToolOptions } from '@fieldnotes/core';
import { useToolOptions } from './use-tool-options.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';
import ToolOptionsHost from '../test-fixtures/ToolOptionsHost.svelte';

afterEach(() => {
  destroyTestViewports();
  vi.restoreAllMocks();
});

// `PencilToolOptions` is an interface without an index signature; this mapped copy has one.
type PencilOptions = { [K in keyof PencilToolOptions]: PencilToolOptions[K] };
type Result = [
  Readable<Record<string, unknown> | null>,
  (partial: Record<string, unknown>) => void,
];

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
    } = mountHelper(() => useToolOptions<PencilOptions>('pencil'), viewport);
    expect(record(options)).toEqual([
      {
        color: '#ff0000',
        width: 5,
        smoothing: 1.5,
        minPointDistance: 3,
        progressiveSimplifyThreshold: 200,
        opacity: 1,
      },
    ]);
  });

  it.each(['hand', 'nonexistent'])('returns null for %s (no options)', (name) => {
    const {
      result: [options, setOptions],
    } = mountHelper(() => useToolOptions(name), viewportWith(new HandTool()));
    expect(record(options)).toEqual([null]);
    expect(() => setOptions({})).not.toThrow();
  });

  it('updates through the setter and through the tool', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options, setOptions],
    } = mountHelper(() => useToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    const values = record(options);
    setOptions({ color: '#00ff00' });
    expect(values.at(-1)?.color).toBe('#00ff00');
    pencil.setOptions({ color: '#0000ff' });
    expect(values.at(-1)?.color).toBe('#0000ff');
  });

  it('does not notify when a change leaves the options equal', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const {
      result: [options],
    } = mountHelper(() => useToolOptions<PencilOptions>('pencil'), viewportWith(pencil));
    const values = record(options);
    pencil.setOptions({ color: '#ff0000' });
    expect(values).toHaveLength(1);
  });

  it('follows a getter tool name, resubscribing to the new tool', async () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    const shape = new ShapeTool({ strokeWidth: 4 });
    const subscribe = pencil.onOptionsChange.bind(pencil);
    const unsubscribePencil = vi.fn();
    vi.spyOn(pencil, 'onOptionsChange').mockImplementation((listener) => {
      const off = subscribe(listener);
      unsubscribePencil.mockImplementation(off);
      return unsubscribePencil;
    });
    const out: { result?: Result } = {};
    const { rerender } = render(ToolOptionsHost, {
      props: {
        viewport: viewportWith(pencil, shape),
        name: 'pencil',
        onresult: (result: Result) => {
          out.result = result;
        },
      },
    });
    if (!out.result) throw new Error('helper did not run');
    const [options, setOptions] = out.result;
    const values = record(options);
    expect(values.at(-1)?.color).toBe('#ff0000');

    await rerender({ name: 'shape' });
    expect(values.at(-1)?.strokeWidth).toBe(4);
    shape.setOptions({ strokeWidth: 9 });
    expect(values.at(-1)?.strokeWidth).toBe(9);
    expect(unsubscribePencil).toHaveBeenCalledOnce();

    pencil.setOptions({ color: '#00ff00' });
    expect(values.at(-1)?.strokeWidth).toBe(9);
    setOptions({ strokeWidth: 2 });
    expect(shape.getOptions().strokeWidth).toBe(2);
  });
});
