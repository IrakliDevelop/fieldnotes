import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Component, useContext, useState, StrictMode, type ReactNode } from 'react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { ViewportContext } from './context';
import { HandTool, SelectTool, PencilTool, Viewport, createShape } from '@fieldnotes/core';
import type { CanvasState } from '@fieldnotes/core';

type OnReady = Mock<(viewport: Viewport) => void>;

/** The viewport handed to the `index`-th `onReady` call (negative counts from the end). */
function viewportAt(onReady: OnReady, index: number): Viewport {
  const call = onReady.mock.calls.at(index);
  if (!call) throw new Error(`onReady was not called (call index ${index})`);
  return call[0];
}

describe('FieldNotesCanvas', () => {
  afterEach(cleanup);

  it('renders a container div', () => {
    const { container } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div).not.toBeNull();
    expect(div.tagName).toBe('DIV');
  });

  it('creates a Viewport with canvas inside the container', () => {
    const { container } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.querySelector('canvas')).not.toBeNull();
  });

  it('provides Viewport via context', () => {
    let contextValue: unknown = 'not-set';
    function Consumer() {
      contextValue = useContext(ViewportContext);
      return null;
    }
    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(contextValue).not.toBeNull();
    expect(contextValue).not.toBe('not-set');
  });

  it('registers tools passed as props', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onReady={onReady}
      />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toContain('hand');
    expect(viewport.toolManager.toolNames).toContain('select');
  });

  it('cleans up Viewport on unmount', () => {
    const { container, unmount } = render(<FieldNotesCanvas />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.querySelector('canvas')).not.toBeNull();
    unmount();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('applies className and style to container', () => {
    const { container } = render(
      <FieldNotesCanvas className="my-canvas" style={{ border: '1px solid red' }} />,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.classList.contains('my-canvas')).toBe(true);
    expect(div.style.border).toBe('1px solid red');
  });

  it('controlled tool prop wins over defaultTool at mount', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="hand"
        tool="select"
        onReady={onReady}
      />,
    );
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('tool prop change switches the active tool', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const tools = [new HandTool(), new SelectTool()];
    const { rerender } = render(<FieldNotesCanvas tools={tools} tool="select" onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.activeTool?.name).toBe('select');

    rerender(<FieldNotesCanvas tools={tools} tool="hand" onReady={onReady} />);
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('onToolChange fires when the tool switches imperatively', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onToolChange = vi.fn();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onToolChange={onToolChange}
        onReady={onReady}
      />,
    );
    const viewport = viewportAt(onReady, 0);
    act(() => {
      viewport.setTool('hand');
    });
    expect(onToolChange).toHaveBeenCalledWith('hand');
  });

  it('controlled tool does not loop (set -> onChange -> same value)', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    let changeCount = 0;
    function Harness() {
      const [tool, setTool] = useState('select');
      return (
        <FieldNotesCanvas
          tools={[new HandTool(), new SelectTool()]}
          tool={tool}
          onToolChange={(name) => {
            changeCount++;
            setTool(name);
          }}
          onReady={onReady}
        />
      );
    }
    render(<Harness />);
    const viewport = viewportAt(onReady, 0);
    act(() => {
      viewport.setTool('hand');
    });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(changeCount).toBe(1);
  });

  it('snapToGrid prop is reactive', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const { rerender } = render(<FieldNotesCanvas snapToGrid onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.snapToGrid).toBe(true);

    rerender(<FieldNotesCanvas snapToGrid={false} onReady={onReady} />);
    expect(viewport.snapToGrid).toBe(false);
  });

  it('tools added after mount are registered', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const { rerender } = render(<FieldNotesCanvas tools={[new HandTool()]} onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual(['hand']);

    rerender(<FieldNotesCanvas tools={[new HandTool(), new PencilTool()]} onReady={onReady} />);
    expect(viewport.toolManager.toolNames).toContain('pencil');
  });

  it('survives StrictMode double-mount with a usable viewport', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const { container } = render(
      <StrictMode>
        <FieldNotesCanvas tools={[new SelectTool()]} defaultTool="select" onReady={onReady} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('canvas').length).toBe(1);
    const viewport = viewportAt(onReady, -1);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('omitted tools register the default bundle with select active', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(<FieldNotesCanvas onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual([
      'hand',
      'select',
      'pencil',
      'eraser',
      'arrow',
      'note',
      'text',
      'shape',
    ]);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('tools={[]} registers nothing and activates no tool', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(<FieldNotesCanvas tools={[]} onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual([]);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it("tools='default' registers the default bundle even with options.tools set", () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(
      <FieldNotesCanvas tools="default" options={{ tools: [new HandTool()] }} onReady={onReady} />,
    );
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual([
      'hand',
      'select',
      'pencil',
      'eraser',
      'arrow',
      'note',
      'text',
      'shape',
    ]);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('omitted tools defer to options.tools instead of the default bundle', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(<FieldNotesCanvas options={{ tools: [new HandTool()] }} onReady={onReady} />);
    expect(viewportAt(onReady, 0).toolManager.toolNames).toEqual(['hand']);
  });

  it('defaultTool wins over select with the default bundle', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    render(<FieldNotesCanvas defaultTool="pencil" onReady={onReady} />);
    expect(viewportAt(onReady, 0).toolManager.activeTool?.name).toBe('pencil');
  });
});

describe('FieldNotesCanvas initialData and onChange', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const saved = {
    version: 4,
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    elements: [
      { ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 } }), id: 's1' },
    ],
  } satisfies CanvasState;

  function addShape(viewport: Viewport, id: string) {
    viewport.store.add({
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
      id,
      layerId: viewport.layerManager.activeLayerId,
    });
  }

  it.each([
    ['object', saved],
    ['JSON string', JSON.stringify(saved)],
  ])('loads initialData given as %s before onReady without calling onChange', (_, data) => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    let idsAtReady: string[] = [];
    render(
      <FieldNotesCanvas
        initialData={data}
        onChange={onChange}
        onReady={(vp) => {
          idsAtReady = vp.store.getAll().map((e) => e.id);
        }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(idsAtReady).toEqual(['s1']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('destroys the viewport and surfaces the error when initialData fails to load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <p>load failed</p> : this.props.children;
      }
    }
    const { getByText } = render(
      <Boundary>
        <FieldNotesCanvas initialData="{" />
      </Boundary>,
    );
    expect(getByText('load failed')).not.toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid changes into one onChange with the exported state', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    render(<FieldNotesCanvas onChange={onChange} onReady={onReady} />);
    const viewport = viewportAt(onReady, 0);
    addShape(viewport, 'a');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    addShape(viewport, 'b');
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const state = onChange.mock.calls[0]?.[0];
    expect(state?.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(state).toEqual(viewport.exportState());
  });

  it('changeDebounceMs={0} fires on the next timer, not synchronously', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    render(<FieldNotesCanvas onChange={onChange} changeDebounceMs={0} onReady={onReady} />);
    addShape(viewportAt(onReady, 0), 'a');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending change exactly once on unmount, before destroy', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    let destroysBeforeFlush = -1;
    const onChange = vi.fn<(state: CanvasState) => void>(() => {
      destroysBeforeFlush = destroy.mock.calls.length;
    });
    const { unmount } = render(<FieldNotesCanvas onChange={onChange} onReady={onReady} />);
    addShape(viewportAt(onReady, 0), 'a');
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].elements.map((e) => e.id)).toEqual(['a']);
    expect(destroysBeforeFlush).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the viewport and reports the error when the unmount flush throws', () => {
    vi.useFakeTimers();
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const quota = new Error('quota exceeded');
    const { unmount } = render(
      <FieldNotesCanvas
        onChange={() => {
          throw quota;
        }}
        onReady={onReady}
      />,
    );
    addShape(viewportAt(onReady, 0), 'a');
    expect(() => unmount()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(quota);
  });

  it('StrictMode fires onChange once per change and destroys each viewport once', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const { unmount } = render(
      <StrictMode>
        <FieldNotesCanvas onChange={onChange} onReady={onReady} />
      </StrictMode>,
    );
    addShape(viewportAt(onReady, -1), 'a');
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    const created = onReady.mock.calls.map(([vp]) => vp);
    expect(destroy.mock.contexts).toHaveLength(created.length);
    expect(new Set(destroy.mock.contexts)).toEqual(new Set(created));
  });

  it('uses a replaced onChange without duplicate calls', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const first = vi.fn<(state: CanvasState) => void>();
    const second = vi.fn<(state: CanvasState) => void>();
    const { rerender } = render(<FieldNotesCanvas onChange={first} onReady={onReady} />);
    rerender(<FieldNotesCanvas onChange={second} onReady={onReady} />);
    addShape(viewportAt(onReady, 0), 'a');
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
