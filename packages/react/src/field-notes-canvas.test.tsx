import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useContext } from 'react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { ViewportContext } from './context';
import { HandTool, SelectTool } from '@fieldnotes/core';

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
});
