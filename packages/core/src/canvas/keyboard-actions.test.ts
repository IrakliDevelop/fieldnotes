/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyboardActions } from './keyboard-actions';
import type { KeyboardActionsDeps } from './keyboard-actions';
import { Camera } from './camera';
import { ElementStore } from '../elements/element-store';
import { SelectTool } from '../tools/select-tool';
import { createNote, createArrow } from '../elements/element-factory';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { HistoryRecorder } from '../history/history-recorder';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function makeActions(
  opts: {
    ctx?: ToolContext;
    tool?: SelectTool;
    recorder?: HistoryRecorder;
    fitToContent?: () => void;
    isToolActive?: () => boolean;
  } = {},
): { actions: KeyboardActions; ctx: ToolContext; tool: SelectTool } {
  const ctx = opts.ctx ?? makeCtx();
  const tool = opts.tool ?? new SelectTool();
  tool.onActivate(ctx);
  const tm = { activeTool: tool } as unknown as ToolManager;
  const deps: KeyboardActionsDeps = {
    getToolManager: () => tm,
    getToolContext: () => ctx,
    getHistoryRecorder: () => opts.recorder ?? null,
    getHistoryStack: () => null,
    isToolActive: opts.isToolActive ?? (() => false),
    fitToContent: opts.fitToContent,
  };
  return { actions: new KeyboardActions(deps), ctx, tool };
}

describe('KeyboardActions.deselect', () => {
  it('clears the selection when select tool has one', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.deselect();

    expect(tool.selectedIds).toEqual([]);
  });

  it('is a no-op when nothing is selected', () => {
    const { actions, ctx } = makeActions();
    vi.mocked(ctx.requestRender).mockClear();
    actions.deselect();
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  it('is a no-op (selection unchanged) when isToolActive returns true', () => {
    const { actions, ctx, tool } = makeActions({ isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);
    vi.mocked(ctx.requestRender).mockClear();

    actions.deselect();

    expect(tool.selectedIds).toEqual([note.id]);
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });
});

describe('KeyboardActions.selectAll', () => {
  it('selects all selectable elements', () => {
    const { actions, ctx, tool } = makeActions();
    const a = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const b = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(a);
    ctx.store.add(b);

    actions.selectAll();

    expect([...tool.selectedIds].sort()).toEqual([a.id, b.id].sort());
  });

  it('excludes locked elements, hidden layers, and locked layers', () => {
    const ctx = makeCtx({
      isLayerVisible: (layerId: string) => layerId !== 'hidden-layer',
      isLayerLocked: (layerId: string) => layerId === 'locked-layer',
    });
    const { actions, tool } = makeActions({ ctx });
    const ok = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const locked = createNote({
      position: { x: 0, y: 100 },
      size: { w: 100, h: 50 },
      locked: true,
    });
    const onHidden = createNote({
      position: { x: 0, y: 200 },
      size: { w: 100, h: 50 },
      layerId: 'hidden-layer',
    });
    const onLocked = createNote({
      position: { x: 0, y: 300 },
      size: { w: 100, h: 50 },
      layerId: 'locked-layer',
    });
    for (const el of [ok, locked, onHidden, onLocked]) ctx.store.add(el);

    actions.selectAll();

    expect(tool.selectedIds).toEqual([ok.id]);
  });

  it('is a no-op (selection unchanged) when isToolActive returns true', () => {
    const ctx = makeCtx();
    const switchTool = vi.fn();
    ctx.switchTool = switchTool;
    const { actions, tool } = makeActions({ ctx, isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);

    actions.selectAll();

    expect(tool.selectedIds).toEqual([]);
    expect(switchTool).not.toHaveBeenCalled();
  });

  it('switches to the select tool first when another tool is active', () => {
    const ctx = makeCtx();
    const selectTool = new SelectTool();
    selectTool.onActivate(ctx);
    const tm = { activeTool: { name: 'pencil' } } as unknown as ToolManager;
    ctx.switchTool = vi.fn(() => {
      (tm as { activeTool: unknown }).activeTool = selectTool;
    });
    const deps: KeyboardActionsDeps = {
      getToolManager: () => tm,
      getToolContext: () => ctx,
      getHistoryRecorder: () => null,
      getHistoryStack: () => null,
      isToolActive: () => false,
    };
    const actions = new KeyboardActions(deps);
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);

    actions.selectAll();

    expect(ctx.switchTool).toHaveBeenCalledWith('select');
    expect(selectTool.selectedIds).toEqual([note.id]);
  });
});

describe('KeyboardActions.duplicate', () => {
  it('clones the selection at +20px and selects the clones', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.duplicate();

    expect(ctx.store.getAll()).toHaveLength(2);
    const cloneId = tool.selectedIds[0];
    expect(cloneId).toBeDefined();
    expect(cloneId).not.toBe(note.id);
    const clone = cloneId ? ctx.store.getById(cloneId) : undefined;
    expect(clone?.position).toEqual({ x: 120, y: 120 });
  });

  it('remaps arrow bindings when both ends are duplicated together', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const arrow = createArrow({ from: { x: 200, y: 200 }, to: { x: 50, y: 25 } });
    arrow.toBinding = { elementId: note.id };
    ctx.store.add(note);
    ctx.store.add(arrow);
    tool.setSelection([note.id, arrow.id]);

    actions.duplicate();

    const clonedArrow = ctx.store.getAll().find((el) => el.type === 'arrow' && el.id !== arrow.id);
    expect(clonedArrow).toBeDefined();
    if (clonedArrow?.type === 'arrow') {
      expect(clonedArrow.toBinding).toBeDefined();
      expect(clonedArrow.toBinding?.elementId).not.toBe(note.id);
      expect(ctx.store.getById(clonedArrow.toBinding?.elementId ?? '')).toBeDefined();
    }
  });

  it('does not touch the copy/paste clipboard', () => {
    const { actions, ctx, tool } = makeActions();
    const a = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const b = createNote({ position: { x: 300, y: 300 }, size: { w: 100, h: 50 } });
    ctx.store.add(a);
    ctx.store.add(b);
    tool.setSelection([a.id]);
    actions.copy();
    tool.setSelection([b.id]);

    actions.duplicate();
    actions.paste();

    const notes = ctx.store.getAll().filter((el) => el.type === 'note');
    expect(notes).toHaveLength(4); // a, b, duplicate-of-b, paste-of-a
    const pasted = notes.find((el) => el.position.x === 20 && el.position.y === 20);
    expect(pasted).toBeDefined();
  });

  it('is a no-op during active pointer input', () => {
    const { actions, ctx, tool } = makeActions({ isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.duplicate();

    expect(ctx.store.getAll()).toHaveLength(1);
  });
});
