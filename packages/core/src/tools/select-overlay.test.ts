// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  getOverlayLayout,
  getHandlePositions,
  renderMarquee,
  renderSelectionBoxes,
} from './select-overlay';
import { createArrow, createNote, createShape } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { recordingCanvas } from '../test-helpers/recording-canvas';

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

  function selectionFixture(): { store: ElementStore; selectedIds: string[] } {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const locked = { ...createNote({ position: { x: 200, y: 0 } }), locked: true };
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 300, y: 300 },
      fromBinding: { elementId: note.id },
    });
    const line = createShape({ position: { x: 0, y: 400 }, size: { w: 50, h: 50 }, shape: 'line' });
    for (const el of [note, locked, arrow, line]) store.add(el);
    return { store, selectedIds: [note.id, locked.id, arrow.id, line.id] };
  }

  it('renderSelectionBoxes draws boxes, handles, lock badge and binding highlight in the given colour', () => {
    const { ctx, styles } = recordingCanvas();
    renderSelectionBoxes(ctx, { ...selectionFixture(), zoom: 1, color: '#B8322A' });

    expect(styles).toContain('#B8322A');
    expect(styles).not.toContain('#2196F3');
  });

  it('renderSelectionBoxes defaults to #2196F3', () => {
    const { ctx, styles } = recordingCanvas();
    renderSelectionBoxes(ctx, { ...selectionFixture(), zoom: 1 });

    expect(styles).toContain('#2196F3');
  });

  it('renderMarquee strokes the colour and fills it at alpha 0.08', () => {
    const { ctx, strokes, fills } = recordingCanvas();
    renderMarquee(ctx, { x: 0, y: 0, w: 10, h: 10 }, '#B8322A');

    expect(strokes).toEqual([{ style: '#B8322A', alpha: 1 }]);
    expect(fills).toEqual([{ style: '#B8322A', alpha: 0.08 }]);
  });

  it('renderMarquee defaults to #2196F3', () => {
    const { ctx, strokes, fills } = recordingCanvas();
    renderMarquee(ctx, { x: 0, y: 0, w: 10, h: 10 });

    expect(strokes).toEqual([{ style: '#2196F3', alpha: 1 }]);
    expect(fills).toEqual([{ style: '#2196F3', alpha: 0.08 }]);
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
