// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { getOverlayLayout, getHandlePositions, renderSelectionBoxes } from './select-overlay';
import { createNote } from '../elements/element-factory';
import { ElementStore } from '../elements/element-store';
import { createTemplate } from '../elements/element-factory';

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

describe('aim handle overlay', () => {
  const storeWith = (...els: ReturnType<typeof createTemplate>[]) => {
    const s = new ElementStore();
    for (const e of els) s.add(e);
    return s;
  };

  it('draws an aim knob (arc) for a single selected cone', () => {
    const cone = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'cone',
      radius: 80,
      angle: 0,
    });
    const store = storeWith(cone);
    const ctx = mockCanvas();
    renderSelectionBoxes(ctx, { selectedIds: [cone.id], store, zoom: 1 });
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('draws an aim knob for a single selected line', () => {
    const line = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'line',
      radius: 80,
      angle: 0,
    });
    const store = storeWith(line);
    const ctx = mockCanvas();
    renderSelectionBoxes(ctx, { selectedIds: [line.id], store, zoom: 1 });
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('does not draw an aim knob for circle, locked, or multi-selection', () => {
    const circle = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'circle',
      radius: 80,
      angle: 0,
    });
    const cCtx = mockCanvas();
    renderSelectionBoxes(cCtx, { selectedIds: [circle.id], store: storeWith(circle), zoom: 1 });
    expect(cCtx.arc).not.toHaveBeenCalled();

    const locked = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'cone',
      radius: 80,
      angle: 0,
      locked: true,
    });
    const lCtx = mockCanvas();
    renderSelectionBoxes(lCtx, { selectedIds: [locked.id], store: storeWith(locked), zoom: 1 });
    expect(lCtx.arc).not.toHaveBeenCalled();

    const a = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'cone',
      radius: 80,
      angle: 0,
    });
    const b = createTemplate({
      position: { x: 300, y: 0 },
      templateShape: 'cone',
      radius: 80,
      angle: 0,
    });
    const mCtx = mockCanvas();
    renderSelectionBoxes(mCtx, { selectedIds: [a.id, b.id], store: storeWith(a, b), zoom: 1 });
    expect(mCtx.arc).not.toHaveBeenCalled();
  });
});
