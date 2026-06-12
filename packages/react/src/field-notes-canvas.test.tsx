import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useContext, useState, StrictMode } from 'react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { ViewportContext } from './context';
import { HandTool, SelectTool, PencilTool } from '@fieldnotes/core';

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
    const onReady = vi.fn();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onReady={onReady}
      />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    const viewport = onReady.mock.calls[0][0];
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
    const onReady = vi.fn();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="hand"
        tool="select"
        onReady={onReady}
      />,
    );
    const viewport = onReady.mock.calls[0][0];
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('tool prop change switches the active tool', () => {
    const onReady = vi.fn();
    const tools = [new HandTool(), new SelectTool()];
    const { rerender } = render(<FieldNotesCanvas tools={tools} tool="select" onReady={onReady} />);
    const viewport = onReady.mock.calls[0][0];
    expect(viewport.toolManager.activeTool?.name).toBe('select');

    rerender(<FieldNotesCanvas tools={tools} tool="hand" onReady={onReady} />);
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('onToolChange fires when the tool switches imperatively', () => {
    const onReady = vi.fn();
    const onToolChange = vi.fn();
    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onToolChange={onToolChange}
        onReady={onReady}
      />,
    );
    const viewport = onReady.mock.calls[0][0];
    act(() => {
      viewport.setTool('hand');
    });
    expect(onToolChange).toHaveBeenCalledWith('hand');
  });

  it('controlled tool does not loop (set -> onChange -> same value)', () => {
    const onReady = vi.fn();
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
    const viewport = onReady.mock.calls[0][0];
    act(() => {
      viewport.setTool('hand');
    });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(changeCount).toBe(1);
  });

  it('snapToGrid prop is reactive', () => {
    const onReady = vi.fn();
    const { rerender } = render(<FieldNotesCanvas snapToGrid onReady={onReady} />);
    const viewport = onReady.mock.calls[0][0];
    expect(viewport.snapToGrid).toBe(true);

    rerender(<FieldNotesCanvas snapToGrid={false} onReady={onReady} />);
    expect(viewport.snapToGrid).toBe(false);
  });

  it('tools added after mount are registered', () => {
    const onReady = vi.fn();
    const { rerender } = render(<FieldNotesCanvas tools={[new HandTool()]} onReady={onReady} />);
    const viewport = onReady.mock.calls[0][0];
    expect(viewport.toolManager.toolNames).toEqual(['hand']);

    rerender(<FieldNotesCanvas tools={[new HandTool(), new PencilTool()]} onReady={onReady} />);
    expect(viewport.toolManager.toolNames).toContain('pencil');
  });

  it('survives StrictMode double-mount with a usable viewport', () => {
    const onReady = vi.fn();
    const { container } = render(
      <StrictMode>
        <FieldNotesCanvas tools={[new SelectTool()]} defaultTool="select" onReady={onReady} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('canvas').length).toBe(1);
    const viewport = onReady.mock.calls[onReady.mock.calls.length - 1][0];
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });
});
