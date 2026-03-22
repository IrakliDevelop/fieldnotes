import { describe, it, expect, vi } from 'vitest';
import { applyArrowHandleDrag } from './arrow-handles';
import { ElementStore } from '../elements/element-store';
import { createNote, createArrow } from '../elements/element-factory';
import type { ToolContext } from './types';
import { Camera } from '../canvas/camera';

function makeCtx(store: ElementStore): ToolContext {
  return {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    switchTool: vi.fn(),
    editElement: vi.fn(),
    setCursor: vi.fn(),
  };
}

describe('applyArrowHandleDrag binding', () => {
  it('binds start handle when dragged near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({ from: { x: 200, y: 200 }, to: { x: 400, y: 400 } });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', arrow.id, { x: 55, y: 55 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.fromBinding?.elementId).toBe(note.id);
  });

  it('binds end handle when dragged near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 300, y: 300 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 200 } });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('end', arrow.id, { x: 305, y: 305 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.toBinding?.elementId).toBe(note.id);
  });

  it('clears binding when handle dragged away', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 400, y: 400 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', arrow.id, { x: 500, y: 500 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.fromBinding).toBeUndefined();
  });

  it('prevents self-binding during handle drag', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 200 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 400, y: 400 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    // Drag end handle to the same note — should not bind
    applyArrowHandleDrag('end', arrow.id, { x: 150, y: 150 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.toBinding).toBeUndefined();
  });
});
