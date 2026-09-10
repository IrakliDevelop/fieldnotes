// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { getOverlayLayout, getHandlePositions, renderSelectionBoxes } from './select-overlay';
import { createArrow, createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';

describe('select-overlay', () => {
  it('getOverlayLayout centers and rotates corners', () => {
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    note.rotation = Math.PI / 2;
    const layout = getOverlayLayout(note, 1);
    expect(layout?.center).toEqual({ x: 50, y: 50 });
    const nw = layout?.corners.find(([h]) => h === 'nw')?.[1];
    expect(nw && Math.abs(nw.x - 50) > 1).toBe(true);
  });
  it('getHandlePositions returns the four axis-aligned corners', () => {
    expect(getHandlePositions({ x: 0, y: 0, w: 10, h: 20 })).toEqual([
      ['nw', { x: 0, y: 0 }],
      ['ne', { x: 10, y: 0 }],
      ['sw', { x: 0, y: 20 }],
      ['se', { x: 10, y: 20 }],
    ]);
  });

  it.each([
    ['arrow', createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } })],
    ['line', createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, shape: 'line' })],
  ])('does not draw %s handles for a locked layer', (_name, element) => {
    const store = new ElementStore();
    store.add({ ...element, layerId: 'locked-layer' });
    const ctx = mockCanvas();

    renderSelectionBoxes(ctx, {
      selectedIds: [element.id],
      store,
      zoom: 1,
      isLayerLocked: (id) => id === 'locked-layer',
    });

    expect(ctx.arc).not.toHaveBeenCalled();
  });
});

function mockCanvas(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}
