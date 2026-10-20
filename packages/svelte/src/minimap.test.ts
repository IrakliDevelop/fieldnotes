import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { MinimapController } from '@fieldnotes/core';
import { Minimap, type MinimapProps } from './index.js';
import CanvasChildren from './test-fixtures/CanvasChildren.svelte';

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

function renderMinimap(minimap: MinimapProps = {}) {
  return render(CanvasChildren, { props: { minimap } });
}

const collapseButton = () => screen.queryByRole('button', { name: 'Collapse minimap' });
const expandButton = () => screen.queryByRole('button', { name: 'Expand minimap' });

describe('Minimap', () => {
  it('renders an expanded minimap by default', () => {
    const { container } = renderMinimap();
    // The FieldNotesCanvas host canvas plus the minimap's own canvas.
    expect(container.querySelectorAll('canvas').length).toBe(2);
    expect(collapseButton()?.textContent).toBe('–');
  });

  it('renders only a button when defaultCollapsed', () => {
    const { container } = renderMinimap({ defaultCollapsed: true });
    expect(container.querySelectorAll('canvas').length).toBe(1);
    expect(expandButton()?.textContent).toBe('▣');
    expect(collapseButton()).toBeNull();
  });

  it('constructs no controller while collapsed', () => {
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    renderMinimap({ defaultCollapsed: true });
    expect(requestDraw).not.toHaveBeenCalled();
  });

  it('clicking collapse removes the canvas and disposes the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const { container } = renderMinimap();
    const collapse = collapseButton();
    if (!collapse) throw new Error('no collapse button');
    await fireEvent.click(collapse);
    expect(container.querySelectorAll('canvas').length).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(expandButton()).not.toBeNull();
  });

  it('clicking expand after collapse recreates a controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const { container } = renderMinimap();
    expect(requestDraw).toHaveBeenCalledTimes(1);

    const collapse = collapseButton();
    if (!collapse) throw new Error('no collapse button');
    await fireEvent.click(collapse);
    const expand = expandButton();
    if (!expand) throw new Error('no expand button');
    await fireEvent.click(expand);

    expect(container.querySelectorAll('canvas').length).toBe(2);
    expect(requestDraw).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a prop change replaces the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const { rerender } = renderMinimap({ width: 100 });
    await rerender({ minimap: { width: 150 } });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(requestDraw).toHaveBeenCalledTimes(2);
  });

  it('unmounting while expanded disposes the controller exactly once', () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const { unmount } = renderMinimap();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('throws outside the provider', () => {
    expect(() => render(Minimap)).toThrow('useViewport must be used inside <FieldNotesCanvas>');
  });

  it('applies width/height props to the canvas inline style', () => {
    renderMinimap({ width: 120, height: 80 });
    const canvas = collapseButton()?.parentElement?.querySelector('canvas');
    expect(canvas?.style.width).toBe('120px');
    expect(canvas?.style.height).toBe('80px');
  });

  it.each([
    ['expanded', false, 'DIV'],
    ['collapsed', true, 'BUTTON'],
  ])('passes class and style through to the %s root', (_, defaultCollapsed, tag) => {
    const { container } = renderMinimap({
      defaultCollapsed,
      class: 'corner',
      style: 'position: absolute; cursor: move',
    });
    const root = container.querySelector<HTMLElement>('.corner');
    expect(root?.tagName).toBe(tag);
    expect(root?.style.position).toBe('absolute');
    expect(root?.style.cursor).toBe('move');
  });
});
