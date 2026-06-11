/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyboardActions } from './keyboard-actions';
import type { KeyboardActionsDeps } from './keyboard-actions';
import { Camera } from './camera';
import { ElementStore } from '../elements/element-store';
import { SelectTool } from '../tools/select-tool';
import { createNote, createArrow } from '../elements/element-factory';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';

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
    stack?: HistoryStack;
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
    getHistoryStack: () => opts.stack ?? null,
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

  it('duplicating an arrow without its bound target drops the binding on the clone', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const arrow = createArrow({ from: { x: 200, y: 200 }, to: { x: 50, y: 25 } });
    arrow.toBinding = { elementId: note.id };
    ctx.store.add(note);
    ctx.store.add(arrow);
    tool.setSelection([arrow.id]);

    actions.duplicate();

    const clonedArrow = ctx.store.getAll().find((el) => el.type === 'arrow' && el.id !== arrow.id);
    expect(clonedArrow).toBeDefined();
    if (clonedArrow?.type === 'arrow') {
      expect(clonedArrow.toBinding).toBeUndefined();
      expect(clonedArrow.to.x).toBe(50 + 20);
      expect(clonedArrow.to.y).toBe(25 + 20);
    }
  });

  it('duplicate with recorder is exactly one begin + one commit', () => {
    const recorder: HistoryRecorder = {
      begin: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    } as unknown as HistoryRecorder;
    const { actions, ctx, tool } = makeActions({ recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.duplicate();

    expect(recorder.begin).toHaveBeenCalledTimes(1);
    expect(recorder.commit).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardActions.zoomToFit', () => {
  it('invokes the injected fitToContent callback', () => {
    const fit = vi.fn();
    const { actions } = makeActions({ fitToContent: fit });
    actions.zoomToFit();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no fitToContent callback is provided', () => {
    const { actions } = makeActions();
    expect(() => actions.zoomToFit()).not.toThrow();
  });

  it('does not invoke fitToContent when isToolActive returns true', () => {
    const fit = vi.fn();
    const { actions } = makeActions({ fitToContent: fit, isToolActive: () => true });
    actions.zoomToFit();
    expect(fit).not.toHaveBeenCalled();
  });
});

describe('KeyboardActions.nudge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRecorder(): HistoryRecorder {
    return {
      begin: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    } as unknown as HistoryRecorder;
  }

  it('moves selection 1 unit, or one grid cell with the cell multiplier', () => {
    const ctx = makeCtx({ gridSize: 40 });
    const { actions, tool } = makeActions({ ctx });
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    expect(actions.nudge(1, 0, false)).toBe(true);
    expect(ctx.store.getById(note.id)?.position.x).toBe(101);

    expect(actions.nudge(0, 1, true)).toBe(true);
    expect(ctx.store.getById(note.id)?.position.y).toBe(140);
  });

  it('falls back to 10 units for cell nudge without a grid', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.nudge(1, 0, true);

    expect(ctx.store.getById(note.id)?.position.x).toBe(10);
  });

  it('returns false when nothing is selected', () => {
    const { actions } = makeActions();
    expect(actions.nudge(1, 0, false)).toBe(false);
  });

  it('is a no-op during active pointer input', () => {
    const { actions, ctx, tool } = makeActions({ isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    expect(actions.nudge(1, 0, false)).toBe(false);
    expect(ctx.store.getById(note.id)?.position.x).toBe(0);
  });

  it('coalesces a burst of nudges into one history transaction', () => {
    const recorder = makeRecorder();
    const { actions, ctx, tool } = makeActions({ recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    expect(recorder.begin).toHaveBeenCalledTimes(1);
    expect(recorder.commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(recorder.commit).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending nudge transaction before another history action runs', () => {
    const recorder = makeRecorder();
    const { actions, ctx, tool } = makeActions({ recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.deleteSelected();

    expect(recorder.begin).toHaveBeenCalledTimes(2);
    expect(recorder.commit).toHaveBeenCalledTimes(2);
  });

  it('flushes a pending nudge on dispose', () => {
    const recorder = makeRecorder();
    const { actions, ctx, tool } = makeActions({ recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.dispose();

    expect(recorder.commit).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardActions nudge transaction ownership', () => {
  it('stale nudge timer does not commit a foreign transaction', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);

    // external transaction takes over mid-window (auto-commits the nudge tx)
    recorder.begin();
    const foreignId = recorder.currentTransactionId;
    ctx.store.add(createNote({ position: { x: 50, y: 50 }, size: { w: 10, h: 10 } }));

    vi.advanceTimersByTime(500); // stale nudge timer fires

    expect(recorder.currentTransactionId).toBe(foreignId); // still open, not committed
    recorder.commit();
    vi.useRealTimers();
  });

  it('nudge still commits its own transaction after the quiet window', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    vi.advanceTimersByTime(500);

    expect(stack.canUndo).toBe(true);
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();
    const after = ctx.store.getById(note.id);
    expect(after?.position.x).toBe(0); // burst = one undo step
    vi.useRealTimers();
  });
});

describe('KeyboardActions guards during active tool input', () => {
  function activeSetup() {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const made = makeActions({ ctx, recorder, stack, isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    made.tool.setSelection([note.id]);
    return { ...made, stack, note };
  }

  it('deleteSelected is a no-op mid-gesture', () => {
    const { actions, ctx, note } = activeSetup();
    actions.deleteSelected();
    expect(ctx.store.getById(note.id)).toBeDefined();
  });

  it('undo is a no-op mid-gesture', () => {
    const { actions, ctx, stack, note } = activeSetup();
    expect(stack.canUndo).toBe(true);
    actions.undo();
    expect(ctx.store.getById(note.id)).toBeDefined();
  });

  it('redo is a no-op mid-gesture', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const made = makeActions({ ctx, recorder, stack, isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    made.tool.setSelection([note.id]);
    // Undo the add while paused so it lands as a redoable step without opening a new transaction
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();
    expect(ctx.store.getById(note.id)).toBeUndefined();
    made.actions.redo();
    expect(ctx.store.getById(note.id)).toBeUndefined();
  });

  it('zOrder is a no-op mid-gesture', () => {
    const { actions, ctx } = activeSetup();
    const second = createNote({ position: { x: 10, y: 10 }, size: { w: 100, h: 50 } });
    ctx.store.add(second);
    const before = ctx.store.getAll().map((el) => el.zIndex);
    actions.zOrder('front');
    expect(ctx.store.getAll().map((el) => el.zIndex)).toEqual(before);
  });
});
