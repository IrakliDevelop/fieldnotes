/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Viewport } from './viewport';
import { mountViewport, type MountViewportOptions, type MountedViewport } from './mount-viewport';
import { HandTool } from '../tools/hand-tool';
import { SelectTool } from '../tools/select-tool';
import { PencilTool } from '../tools/pencil-tool';
import { createShape } from '../elements/element-factory';
import type { CanvasState } from '../core/state-serializer';
import type { Tool } from '../tools/types';

const DEFAULT_TOOL_NAMES = ['hand', 'select', 'pencil', 'eraser', 'arrow', 'note', 'text', 'shape'];

const saved = {
  version: 5,
  camera: { position: { x: 0, y: 0 }, zoom: 1 },
  elements: [
    {
      ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, index: 'a0' }),
      id: 's1',
    },
  ],
} satisfies CanvasState;

const mounted: MountedViewport[] = [];

function mount(opts?: MountViewportOptions): MountedViewport {
  const m = mountViewport(document.createElement('div'), opts);
  mounted.push(m);
  return m;
}

function addShape(viewport: Viewport, id: string) {
  viewport.store.add({
    ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
    id,
    layerId: viewport.layerManager.activeLayerId,
  });
}

afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mountViewport tools', () => {
  it('constructs a viewport inside the container', () => {
    const container = document.createElement('div');
    const m = mountViewport(container);
    mounted.push(m);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(m.viewport).toBeInstanceOf(Viewport);
  });

  it("tools='default' registers the bundle with select active before onReady", () => {
    let atReady: { names: string[]; active: string | undefined } | undefined;
    mount({
      tools: 'default',
      onReady: (vp) => {
        atReady = { names: [...vp.toolManager.toolNames], active: vp.toolManager.activeTool?.name };
      },
    });
    expect(atReady).toEqual({ names: DEFAULT_TOOL_NAMES, active: 'select' });
  });

  it("tools='default' registers the bundle even with options.tools set", () => {
    const { viewport } = mount({ tools: 'default', options: { tools: [new HandTool()] } });
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
  });

  it('registers an array of tools and activates defaultTool', () => {
    const { viewport } = mount({ tools: [new HandTool(), new SelectTool()], defaultTool: 'hand' });
    expect(viewport.toolManager.toolNames).toEqual(['hand', 'select']);
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('an array of tools activates nothing without tool or defaultTool', () => {
    const { viewport } = mount({ tools: [new HandTool(), new SelectTool()] });
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it('tools=[] registers nothing and activates no tool', () => {
    const { viewport } = mount({ tools: [] });
    expect(viewport.toolManager.toolNames).toEqual([]);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it('omitted tools register the bundle after onReady with select active', () => {
    let namesAtReady: string[] = [];
    const { viewport } = mount({
      onReady: (vp) => {
        namesAtReady = [...vp.toolManager.toolNames];
      },
    });
    expect(namesAtReady).toEqual([]);
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('omitted tools register no defaults when onReady registered a tool', () => {
    const { viewport } = mount({ onReady: (vp) => vp.toolManager.register(new HandTool()) });
    expect(viewport.toolManager.toolNames).toEqual(['hand']);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it.each([
    ['tool', { tool: 'hand' }],
    ['defaultTool', { defaultTool: 'hand' }],
  ])('omitted tools activate %s after onReady registered it', (_, pick) => {
    const warn = vi.spyOn(console, 'warn');
    const { viewport } = mount({
      ...pick,
      onReady: (vp) => vp.toolManager.register(new HandTool()),
    });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(warn).not.toHaveBeenCalled();
  });

  it('an explicit options.tools is not deferred', () => {
    let atReady: { names: string[]; active: string | undefined } | undefined;
    const { viewport } = mount({
      options: { tools: [new HandTool()] },
      onReady: (vp) => {
        atReady = { names: [...vp.toolManager.toolNames], active: vp.toolManager.activeTool?.name };
      },
    });
    expect(atReady).toEqual({ names: ['hand'], active: undefined });
    expect(viewport.toolManager.toolNames).toEqual(['hand']);
  });

  it.each([
    ['tool wins over defaultTool', { tool: 'select', defaultTool: 'hand' }, 'select'],
    ['defaultTool wins over the select fallback', { defaultTool: 'pencil' }, 'pencil'],
    ['select is the fallback', {}, 'select'],
  ])("with tools='default', %s", (_, pick, expected) => {
    const { viewport } = mount({ tools: 'default', ...pick });
    expect(viewport.toolManager.activeTool?.name).toBe(expected);
  });

  it('reads tool and defaultTool at activation time', () => {
    const opts: MountViewportOptions = {
      onReady: (vp) => {
        vp.toolManager.register(new HandTool());
        vp.toolManager.register(new PencilTool());
        opts.tool = 'pencil';
      },
    };
    const { viewport } = mount(opts);
    expect(viewport.toolManager.activeTool?.name).toBe('pencil');
  });
});

describe('mountViewport initialData and errors', () => {
  it.each([
    ['object', saved],
    ['JSON string', JSON.stringify(saved)],
  ])('loads initialData given as %s before onReady without calling onChange', (_, data) => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    let idsAtReady: string[] = [];
    mount({
      initialData: data,
      onChange,
      onReady: (vp) => {
        idsAtReady = vp.store.getAll().map((e) => e.id);
      },
    });
    vi.advanceTimersByTime(1000);
    expect(idsAtReady).toEqual(['s1']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('destroys the viewport and rethrows when initialData fails to load', () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const onReady = vi.fn();
    expect(() => mount({ initialData: '{', onReady })).toThrow(SyntaxError);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('destroys the viewport, drops the pending change and rethrows when onReady throws', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('host setup failed');
    const onChange = vi.fn<(state: CanvasState) => void>();
    expect(() =>
      mount({
        onChange,
        onReady: (vp) => {
          addShape(vp, 'a');
          throw failure;
        },
      }),
    ).toThrow(failure);
    vi.advanceTimersByTime(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('destroys the viewport and rethrows when deferred activation throws', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('activation failed');
    const broken: Tool = Object.assign(new HandTool(), {
      name: 'broken',
      onActivate: () => {
        throw failure;
      },
    });
    const onChange = vi.fn<(state: CanvasState) => void>();
    expect(() =>
      mount({
        tool: 'broken',
        onChange,
        onReady: (vp) => {
          vp.toolManager.register(broken);
          addShape(vp, 'a');
        },
      }),
    ).toThrow(failure);
    vi.advanceTimersByTime(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('mountViewport onChange', () => {
  it('registering deferred defaults after onReady does not fire onChange', () => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    mount({ onChange });
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('debounces rapid changes into one onChange with the exported state', () => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const { viewport } = mount({ onChange });
    addShape(viewport, 'a');
    vi.advanceTimersByTime(100);
    addShape(viewport, 'b');
    vi.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('changeDebounceMs=0 fires on the next timer, not synchronously', () => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const { viewport } = mount({ onChange, changeDebounceMs: 0 });
    addShape(viewport, 'a');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reads onChange and changeDebounceMs live through getters', () => {
    vi.useFakeTimers();
    const first = vi.fn<(state: CanvasState) => void>();
    const second = vi.fn<(state: CanvasState) => void>();
    let props = { onChange: first, changeDebounceMs: 250 };
    const { viewport } = mount({
      get onChange() {
        return props.onChange;
      },
      get changeDebounceMs() {
        return props.changeDebounceMs;
      },
    });
    props = { onChange: second, changeDebounceMs: 10 };
    addShape(viewport, 'a');
    vi.advanceTimersByTime(10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('destroy flushes a pending change exactly once, before destroying', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    let destroysBeforeFlush = -1;
    const onChange = vi.fn<(state: CanvasState) => void>(() => {
      destroysBeforeFlush = destroy.mock.calls.length;
    });
    const m = mount({ onChange });
    addShape(m.viewport, 'a');
    m.destroy();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].elements.map((e) => e.id)).toEqual(['a']);
    expect(destroysBeforeFlush).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroy without a pending change does not call onChange', () => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const m = mount({ onChange });
    m.destroy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a throwing flush is reported and the viewport is still destroyed', () => {
    vi.useFakeTimers();
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const quota = new Error('quota exceeded');
    const m = mount({
      onChange: () => {
        throw quota;
      },
    });
    addShape(m.viewport, 'a');
    expect(() => m.destroy()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(quota);
  });

  it('a throwing flush falls back to console.error without reportError', () => {
    vi.useFakeTimers();
    vi.stubGlobal('reportError', undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quota = new Error('quota exceeded');
    const m = mount({
      onChange: () => {
        throw quota;
      },
    });
    addShape(m.viewport, 'a');
    m.destroy();
    expect(error).toHaveBeenCalledWith('[fieldnotes] onChange failed during unmount', quota);
  });

  it('a second destroy is a no-op', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const onChange = vi.fn<(state: CanvasState) => void>();
    const m = mount({ onChange });
    addShape(m.viewport, 'a');
    m.destroy();
    m.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops emitting changes after destroy', () => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const m = mount({ onChange });
    m.destroy();
    addShape(m.viewport, 'late');
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('mountViewport tool changes', () => {
  it('onToolChange fires for changes after mount, not for activation during mount', () => {
    const onToolChange = vi.fn<(name: string) => void>();
    const { viewport } = mount({
      tool: 'pencil',
      onToolChange,
      onReady: (vp) => {
        vp.toolManager.register(new HandTool());
        vp.toolManager.register(new PencilTool());
        vp.setTool('hand');
      },
    });
    expect(viewport.toolManager.activeTool?.name).toBe('pencil');
    expect(onToolChange).not.toHaveBeenCalled();
    viewport.setTool('hand');
    expect(onToolChange.mock.calls).toEqual([['hand']]);
  });

  it('reads onToolChange live', () => {
    const first = vi.fn<(name: string) => void>();
    const second = vi.fn<(name: string) => void>();
    const opts: MountViewportOptions = { tools: 'default', onToolChange: first };
    const { viewport } = mount(opts);
    opts.onToolChange = second;
    viewport.setTool('hand');
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([['hand']]);
  });

  it('stops calling onToolChange after destroy', () => {
    const onToolChange = vi.fn<(name: string) => void>();
    const m = mount({ tools: 'default', onToolChange });
    m.destroy();
    m.viewport.setTool('hand');
    expect(onToolChange).not.toHaveBeenCalled();
  });

  it('setTool switches the active tool and is a no-op when already active', () => {
    const onToolChange = vi.fn<(name: string) => void>();
    const m = mount({ tools: 'default', onToolChange });
    m.setTool('select');
    expect(onToolChange).not.toHaveBeenCalled();
    m.setTool('hand');
    expect(m.viewport.toolManager.activeTool?.name).toBe('hand');
    expect(onToolChange.mock.calls).toEqual([['hand']]);
  });

  it('addTools registers only names not registered yet', () => {
    const hand = new HandTool();
    const m = mount({ tools: [hand] });
    const pencil = new PencilTool();
    m.addTools([new HandTool(), pencil]);
    expect(m.viewport.toolManager.toolNames).toEqual(['hand', 'pencil']);
    expect(m.viewport.toolManager.getTool('hand')).toBe(hand);
    expect(m.viewport.toolManager.getTool('pencil')).toBe(pencil);
  });
});
