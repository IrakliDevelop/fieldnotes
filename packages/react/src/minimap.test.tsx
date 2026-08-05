import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { Minimap } from './minimap';
import { MinimapController } from '@fieldnotes/core';

// ---------------------------------------------------------------------------
// Permissive fake 2D context: every read of an unset property returns a
// fresh vi.fn(), so any drawing call (fillRect, drawImage, save/restore,
// setTransform, strokeRect, ...) succeeds without asserting on call
// fidelity. Property writes (fillStyle, lineWidth, ...) are recorded on the
// backing object so later reads see the last-written value. This mirrors
// the recorder approach in packages/core/src/canvas/minimap-controller.test.ts,
// simplified since these tests only assert on component behavior (canvas
// presence, controller lifecycle), not drawing output.
// ---------------------------------------------------------------------------
function makeContext(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return vi.fn();
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  };
  return new Proxy(state, handler) as unknown as CanvasRenderingContext2D;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => makeContext());
});

afterEach(() => {
  cleanup();
  getContextSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('Minimap', () => {
  it('renders an expanded minimap by default', () => {
    const { container } = render(
      <FieldNotesCanvas>
        <Minimap />
      </FieldNotesCanvas>,
    );
    // The FieldNotesCanvas host canvas plus the minimap's own canvas.
    expect(container.querySelectorAll('canvas').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Collapse minimap' })).not.toBeNull();
  });

  it('renders only a button when defaultCollapsed', () => {
    const { container } = render(
      <FieldNotesCanvas>
        <Minimap defaultCollapsed />
      </FieldNotesCanvas>,
    );
    // Only the FieldNotesCanvas host canvas — no minimap canvas while collapsed.
    expect(container.querySelectorAll('canvas').length).toBe(1);
    expect(screen.getByRole('button', { name: 'Expand minimap' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse minimap' })).toBeNull();
  });

  it('clicking collapse removes the canvas and disposes the controller', () => {
    const disposeSpy = vi.spyOn(MinimapController.prototype, 'dispose');
    const { container } = render(
      <FieldNotesCanvas>
        <Minimap />
      </FieldNotesCanvas>,
    );
    expect(container.querySelectorAll('canvas').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse minimap' }));

    expect(container.querySelectorAll('canvas').length).toBe(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Expand minimap' })).not.toBeNull();
  });

  it('clicking expand after collapse recreates a canvas', () => {
    const disposeSpy = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDrawSpy = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const { container } = render(
      <FieldNotesCanvas>
        <Minimap />
      </FieldNotesCanvas>,
    );
    expect(requestDrawSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse minimap' }));
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('canvas').length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Expand minimap' }));

    expect(container.querySelectorAll('canvas').length).toBe(2);
    expect(requestDrawSpy).toHaveBeenCalledTimes(2);
    // Re-expanding constructs a new controller; it must not dispose again on its own.
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Collapse minimap' })).not.toBeNull();
  });

  it('unmounting while expanded disposes the controller exactly once', () => {
    const disposeSpy = vi.spyOn(MinimapController.prototype, 'dispose');
    const { unmount } = render(
      <FieldNotesCanvas>
        <Minimap />
      </FieldNotesCanvas>,
    );
    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('throws outside the provider', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Minimap />)).toThrow(
        'useViewport must be used inside <FieldNotesCanvas>',
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('applies width/height props to the canvas inline style', () => {
    render(
      <FieldNotesCanvas>
        <Minimap width={120} height={80} />
      </FieldNotesCanvas>,
    );
    const canvas = document
      .querySelector('button[aria-label="Collapse minimap"]')
      ?.parentElement?.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect((canvas as HTMLCanvasElement).style.width).toBe('120px');
    expect((canvas as HTMLCanvasElement).style.height).toBe('80px');
  });
});
