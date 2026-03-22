import { describe, it, expect, vi } from 'vitest';
import { NoteTool } from './note-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { NoteElement } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('NoteTool', () => {
  it('has name "note"', () => {
    expect(new NoteTool().name).toBe('note');
  });

  it('creates a note at click position', () => {
    const tool = new NoteTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(100, 200), ctx);
    tool.onPointerUp(pt(100, 200), ctx);

    expect(ctx.store.count).toBe(1);
    const note = ctx.store.getAll()[0] as NoteElement;
    expect(note.type).toBe('note');
    expect(note.position).toEqual({ x: 100, y: 200 });
  });

  it('uses configured defaults', () => {
    const tool = new NoteTool({
      backgroundColor: '#ff9800',
      size: { w: 300, h: 200 },
    });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    const note = ctx.store.getAll()[0] as NoteElement;
    expect(note.backgroundColor).toBe('#ff9800');
    expect(note.size).toEqual({ w: 300, h: 200 });
  });

  it('uses configured textColor', () => {
    const tool = new NoteTool({ textColor: '#ffffff' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    const note = ctx.store.getAll()[0] as NoteElement;
    expect(note.textColor).toBe('#ffffff');
  });

  it('updates options via setOptions', () => {
    const tool = new NoteTool();
    const ctx = makeCtx();

    tool.setOptions({ backgroundColor: '#ff5722', textColor: '#ffffff' });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    const note = ctx.store.getAll()[0] as NoteElement;
    expect(note.backgroundColor).toBe('#ff5722');
    expect(note.textColor).toBe('#ffffff');
  });

  it('converts screen to world coords', () => {
    const camera = new Camera();
    camera.pan(-100, -100);
    const ctx = makeCtx({ camera });
    const tool = new NoteTool();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    const note = ctx.store.getAll()[0] as NoteElement;
    expect(note.position.x).toBe(150);
    expect(note.position.y).toBe(150);
  });

  it('requests render after placing note', () => {
    const tool = new NoteTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('calls switchTool to select after placing', () => {
    const tool = new NoteTool();
    const switchTool = vi.fn();
    const ctx = makeCtx({ switchTool });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    expect(switchTool).toHaveBeenCalledWith('select');
  });

  it('calls editElement with the new note id', () => {
    const tool = new NoteTool();
    const editElement = vi.fn();
    const ctx = makeCtx({ editElement });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    expect(editElement).toHaveBeenCalledTimes(1);
    const noteId = ctx.store.getAll()[0]?.id;
    expect(editElement).toHaveBeenCalledWith(noteId);
  });
});
