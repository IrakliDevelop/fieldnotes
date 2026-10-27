import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { HandTool, SelectTool, PencilTool, Viewport, createShape } from '@fieldnotes/core';
import type { CanvasState, ImportableCanvasState } from '@fieldnotes/core';
import { FieldNotesCanvas } from './index.js';
import CanvasWithChild from './test-fixtures/CanvasWithChild.svelte';
import ContextHost from './test-fixtures/ContextHost.svelte';
import ViewportConsumer from './test-fixtures/ViewportConsumer.svelte';

type OnReady = Mock<(viewport: Viewport) => void>;

const DEFAULT_TOOL_NAMES = ['hand', 'select', 'pencil', 'eraser', 'arrow', 'note', 'text', 'shape'];

/** The viewport handed to the `index`-th `onready` call (negative counts from the end). */
function viewportAt(onready: OnReady, index: number): Viewport {
  const call = onready.mock.calls.at(index);
  if (!call) throw new Error(`onready was not called (call index ${index})`);
  return call[0];
}

function rootOf(container: HTMLElement): HTMLDivElement {
  const root = container.querySelector('div');
  if (!root) throw new Error('no root div rendered');
  return root;
}

function addShape(viewport: Viewport, id: string) {
  viewport.store.add({
    ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
    id,
    layerId: viewport.layerManager.activeLayerId,
  });
}

describe('FieldNotesCanvas', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a Viewport with a canvas inside the root div', () => {
    const { container } = render(FieldNotesCanvas);
    expect(rootOf(container).querySelector('canvas')).not.toBeNull();
  });

  it('destroys the Viewport on unmount', () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const { container, unmount } = render(FieldNotesCanvas);
    const root = rootOf(container);
    unmount();
    expect(root.querySelector('canvas')).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('passes class and style through to the root div', () => {
    const { container } = render(FieldNotesCanvas, {
      props: { class: 'my-canvas', style: 'border: 1px solid red' },
    });
    const root = rootOf(container);
    expect(root.classList.contains('my-canvas')).toBe(true);
    expect(root.style.border).toBe('1px solid red');
  });

  it('renders children once the viewport exists, with useViewport available', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onviewport = vi.fn<(viewport: Viewport) => void>();
    const { container } = render(CanvasWithChild, { props: { onready, onviewport } });
    expect(container.querySelector('.child')).not.toBeNull();
    expect(onviewport).toHaveBeenCalledTimes(1);
    expect(onviewport).toHaveBeenCalledWith(viewportAt(onready, 0));
  });

  it('registers tools passed as props', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], defaultTool: 'select', onready },
    });
    expect(onready).toHaveBeenCalledTimes(1);
    const viewport = viewportAt(onready, 0);
    expect(viewport.toolManager.toolNames).toEqual(['hand', 'select']);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('a bare canvas registers the default bundle with select active', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, { props: { onready } });
    const viewport = viewportAt(onready, 0);
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('tools=[] registers nothing and activates no tool', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, { props: { tools: [], onready } });
    const viewport = viewportAt(onready, 0);
    expect(viewport.toolManager.toolNames).toEqual([]);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it("tools='default' registers the default bundle even with options.tools set", () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, {
      props: { tools: 'default', options: { tools: [new HandTool()] }, onready },
    });
    const viewport = viewportAt(onready, 0);
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it("tools='default' registers the bundle before onready", () => {
    let namesAtReady: string[] = [];
    render(FieldNotesCanvas, {
      props: {
        tools: 'default',
        onready: (vp: Viewport) => {
          namesAtReady = [...vp.toolManager.toolNames];
        },
      },
    });
    expect(namesAtReady).toEqual(DEFAULT_TOOL_NAMES);
  });

  it('omitted tools register no defaults when onready registered a tool', () => {
    const onready = vi.fn((vp: Viewport) => {
      vp.toolManager.register(new HandTool());
    });
    render(FieldNotesCanvas, { props: { onready } });
    const viewport = viewportAt(onready, 0);
    expect(viewport.toolManager.toolNames).toEqual(['hand']);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it('omitted tools activate the tool prop after onready registered it', () => {
    const onready = vi.fn((vp: Viewport) => {
      vp.toolManager.register(new HandTool());
    });
    const warn = vi.spyOn(console, 'warn');
    render(FieldNotesCanvas, { props: { tool: 'hand', onready } });
    expect(viewportAt(onready, 0).toolManager.activeTool?.name).toBe('hand');
    expect(warn).not.toHaveBeenCalled();
  });

  it('omitted tools defer to options.tools instead of the default bundle', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, { props: { options: { tools: [new HandTool()] }, onready } });
    expect(viewportAt(onready, 0).toolManager.toolNames).toEqual(['hand']);
  });

  it('defaultTool wins over select with the default bundle', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, { props: { defaultTool: 'pencil', onready } });
    expect(viewportAt(onready, 0).toolManager.activeTool?.name).toBe('pencil');
  });

  it('tools replaced after mount are registered', async () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const { rerender } = render(FieldNotesCanvas, {
      props: { tools: [new HandTool()], onready },
    });
    const viewport = viewportAt(onready, 0);
    await rerender({ tools: [new HandTool(), new PencilTool()] });
    expect(viewport.toolManager.toolNames).toEqual(['hand', 'pencil']);
  });

  it('controlled tool wins over defaultTool at mount', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    render(FieldNotesCanvas, {
      props: {
        tools: [new HandTool(), new SelectTool()],
        defaultTool: 'hand',
        tool: 'select',
        onready,
      },
    });
    expect(viewportAt(onready, 0).toolManager.activeTool?.name).toBe('select');
  });

  it('tool prop change switches the active tool', async () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const { rerender } = render(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], tool: 'select', onready },
    });
    const viewport = viewportAt(onready, 0);
    await rerender({ tool: 'hand' });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('an API tool switch calls ontoolchange without reverting the tool prop', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const ontoolchange = vi.fn<(name: string) => void>();
    render(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], tool: 'select', ontoolchange, onready },
    });
    const viewport = viewportAt(onready, 0);
    viewport.setTool('hand');
    flushSync();
    expect(ontoolchange.mock.calls).toEqual([['hand']]);
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('a keyboard tool switch calls ontoolchange', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const ontoolchange = vi.fn<(name: string) => void>();
    render(FieldNotesCanvas, {
      props: { options: { shortcuts: { scope: 'window' } }, ontoolchange, onready },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(viewportAt(onready, 0).toolManager.activeTool?.name).toBe('hand');
    expect(ontoolchange.mock.calls).toEqual([['hand']]);
  });

  it('a controlled tool does not loop (switch -> ontoolchange -> same tool prop)', async () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const ontoolchange = vi.fn<(name: string) => void>();
    const { rerender } = render(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], tool: 'select', ontoolchange, onready },
    });
    const viewport = viewportAt(onready, 0);
    viewport.setTool('hand');
    await rerender({ tool: 'hand' });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(ontoolchange).toHaveBeenCalledTimes(1);
  });

  it('snapToGrid is reactive', async () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const { rerender } = render(FieldNotesCanvas, { props: { snapToGrid: true, onready } });
    const viewport = viewportAt(onready, 0);
    expect(viewport.snapToGrid).toBe(true);
    await rerender({ snapToGrid: false });
    expect(viewport.snapToGrid).toBe(false);
  });

  it('an absent snapToGrid leaves the core flag untouched', () => {
    const setSnapToGrid = vi.spyOn(Viewport.prototype, 'setSnapToGrid');
    render(FieldNotesCanvas);
    flushSync();
    expect(setSnapToGrid).not.toHaveBeenCalled();
  });
});

describe('FieldNotesCanvas initialData and onchange', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const saved = {
    version: 5,
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    elements: [
      {
        ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, index: 'a0' }),
        id: 's1',
      },
    ],
  } satisfies ImportableCanvasState;

  it.each([
    ['object', saved],
    ['JSON string', JSON.stringify(saved)],
  ])('loads initialData given as %s before onready without calling onchange', (_, data) => {
    vi.useFakeTimers();
    const onchange = vi.fn<(state: CanvasState) => void>();
    let idsAtReady: string[] = [];
    render(FieldNotesCanvas, {
      props: {
        initialData: data,
        onchange,
        onready: (vp: Viewport) => {
          idsAtReady = vp.store.getAll().map((e) => e.id);
        },
      },
    });
    vi.advanceTimersByTime(1000);
    expect(idsAtReady).toEqual(['s1']);
    expect(onchange).not.toHaveBeenCalled();
  });

  it('destroys the viewport and rethrows when initialData fails to load', () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    expect(() => render(FieldNotesCanvas, { props: { initialData: '{' } })).toThrow(SyntaxError);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the viewport and rethrows when onready throws', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('host setup failed');
    const onchange = vi.fn<(state: CanvasState) => void>();
    expect(() =>
      render(FieldNotesCanvas, {
        props: {
          onchange,
          onready: (vp: Viewport) => {
            addShape(vp, 'a');
            throw failure;
          },
        },
      }),
    ).toThrow(failure);
    vi.advanceTimersByTime(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onchange).not.toHaveBeenCalled();
  });

  it('registering deferred defaults after onready does not fire onchange', () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onchange = vi.fn<(state: CanvasState) => void>();
    render(FieldNotesCanvas, { props: { onchange, onready } });
    vi.advanceTimersByTime(1000);
    expect(viewportAt(onready, 0).toolManager.activeTool?.name).toBe('select');
    expect(onchange).not.toHaveBeenCalled();
  });

  it('debounces rapid changes into one onchange with the exported state', () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onchange = vi.fn<(state: CanvasState) => void>();
    render(FieldNotesCanvas, { props: { onchange, onready } });
    const viewport = viewportAt(onready, 0);
    addShape(viewport, 'a');
    vi.advanceTimersByTime(100);
    addShape(viewport, 'b');
    vi.advanceTimersByTime(249);
    expect(onchange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onchange).toHaveBeenCalledTimes(1);
    const state = onchange.mock.calls[0]?.[0];
    expect(state?.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(state).toEqual(viewport.exportState());
  });

  it('changeDebounceMs=0 fires on the next timer, not synchronously', () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onchange = vi.fn<(state: CanvasState) => void>();
    render(FieldNotesCanvas, { props: { onchange, changeDebounceMs: 0, onready } });
    addShape(viewportAt(onready, 0), 'a');
    expect(onchange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('uses the latest changeDebounceMs', async () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onchange = vi.fn<(state: CanvasState) => void>();
    const { rerender } = render(FieldNotesCanvas, { props: { onchange, onready } });
    await rerender({ changeDebounceMs: 10 });
    addShape(viewportAt(onready, 0), 'a');
    vi.advanceTimersByTime(10);
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending change exactly once on unmount, before destroy', () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    let destroysBeforeFlush = -1;
    const onchange = vi.fn<(state: CanvasState) => void>(() => {
      destroysBeforeFlush = destroy.mock.calls.length;
    });
    const { unmount } = render(FieldNotesCanvas, { props: { onchange, onready } });
    addShape(viewportAt(onready, 0), 'a');
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange.mock.calls[0]?.[0].elements.map((e) => e.id)).toEqual(['a']);
    expect(destroysBeforeFlush).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the viewport and reports the error when the unmount flush throws', () => {
    vi.useFakeTimers();
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const onready = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const quota = new Error('quota exceeded');
    const { unmount } = render(FieldNotesCanvas, {
      props: {
        onchange: () => {
          throw quota;
        },
        onready,
      },
    });
    addShape(viewportAt(onready, 0), 'a');
    expect(() => unmount()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(quota);
  });

  it('falls back to console.error when reportError is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('reportError', undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onready = vi.fn<(viewport: Viewport) => void>();
    const quota = new Error('quota exceeded');
    const { unmount } = render(FieldNotesCanvas, {
      props: {
        onchange: () => {
          throw quota;
        },
        onready,
      },
    });
    addShape(viewportAt(onready, 0), 'a');
    unmount();
    expect(error).toHaveBeenCalledWith('[fieldnotes] onChange failed during unmount', quota);
  });

  it('uses a replaced onchange without duplicate calls', async () => {
    vi.useFakeTimers();
    const onready = vi.fn<(viewport: Viewport) => void>();
    const first = vi.fn<(state: CanvasState) => void>();
    const second = vi.fn<(state: CanvasState) => void>();
    const { rerender } = render(FieldNotesCanvas, { props: { onchange: first, onready } });
    await rerender({ onchange: second });
    addShape(viewportAt(onready, 0), 'a');
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('useViewport', () => {
  it('throws outside <FieldNotesCanvas>', () => {
    // Svelte's dev build appends a component stack to the message.
    expect(() => render(ViewportConsumer)).toThrow(
      /^useViewport must be used inside <FieldNotesCanvas>/,
    );
  });

  it('returns a viewport a host set with setViewportContext', () => {
    const container = document.createElement('div');
    const viewport = new Viewport(container);
    const onviewport = vi.fn<(viewport: Viewport) => void>();
    render(ContextHost, { props: { viewport, onviewport } });
    expect(onviewport).toHaveBeenCalledWith(viewport);
    viewport.destroy();
  });
});
