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
    group?: () => void;
    ungroup?: () => void;
    toggleLock?: () => void;
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
    group: opts.group,
    ungroup: opts.ungroup,
    toggleLock: opts.toggleLock,
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

  it('remaps groupId on clones so a duplicated group is a fresh cohesive group', () => {
    const { actions, ctx, tool } = makeActions();
    const a = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const b = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 50 } });
    a.groupId = 'g1';
    b.groupId = 'g1';
    ctx.store.add(a);
    ctx.store.add(b);
    tool.setSelection([a.id, b.id]);

    actions.duplicate();

    const clones = ctx.store.getAll().filter((el) => el.id !== a.id && el.id !== b.id);
    expect(clones).toHaveLength(2);
    expect(clones[0]?.groupId).toBeDefined();
    expect(clones[1]?.groupId).toBeDefined();
    expect(clones[0]?.groupId).toBe(clones[1]?.groupId);
    expect(clones[0]?.groupId).not.toBe('g1');
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

describe('KeyboardActions.group / ungroup', () => {
  it('invokes the injected group and ungroup callbacks when no tool is active', () => {
    const group = vi.fn();
    const ungroup = vi.fn();
    const { actions } = makeActions({ group, ungroup });

    actions.group();
    actions.ungroup();

    expect(group).toHaveBeenCalledTimes(1);
    expect(ungroup).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callbacks when isToolActive returns true', () => {
    const group = vi.fn();
    const ungroup = vi.fn();
    const { actions } = makeActions({ group, ungroup, isToolActive: () => true });

    actions.group();
    actions.ungroup();

    expect(group).not.toHaveBeenCalled();
    expect(ungroup).not.toHaveBeenCalled();
  });
});

describe('KeyboardActions.cut', () => {
  it('copies the selection then removes it from the store', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.cut();

    expect(actions.hasClipboard()).toBe(true);
    expect(ctx.store.getById(note.id)).toBeUndefined();
  });

  it('is a no-op when isToolActive returns true', () => {
    const { actions, ctx, tool } = makeActions({ isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.cut();

    expect(actions.hasClipboard()).toBe(false);
    expect(ctx.store.getById(note.id)).toBeDefined();
  });
});

describe('KeyboardActions.toggleLock', () => {
  it('invokes the injected toggleLock callback when no tool is active', () => {
    const toggleLock = vi.fn();
    const { actions } = makeActions({ toggleLock });

    actions.toggleLock();

    expect(toggleLock).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback when isToolActive returns true', () => {
    const toggleLock = vi.fn();
    const { actions } = makeActions({ toggleLock, isToolActive: () => true });

    actions.toggleLock();

    expect(toggleLock).not.toHaveBeenCalled();
  });
});

describe('KeyboardActions.nudge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    expect(ctx.store.getById(note.id)?.position.x).toBe(3);
    expect(stack.undoCount).toBe(0); // burst still open, nothing committed yet

    vi.advanceTimersByTime(400);
    expect(stack.undoCount).toBe(1); // whole burst committed as one step
  });

  it('flushes a pending nudge transaction before another history action runs', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.deleteSelected();

    // nudge tx flushed (1) + delete tx (1) = two distinct undo steps
    expect(stack.undoCount).toBe(2);
  });

  it('flushes a pending nudge on dispose', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    actions.nudge(1, 0, false);
    actions.dispose();

    expect(stack.undoCount).toBe(1); // pending nudge tx committed on dispose
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

  it('continuation nudge after a foreign transaction forms its own undo step', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    stack.clear();
    tool.setSelection([note.id]);

    // first nudge opens its own tx, moves note to x=1
    actions.nudge(1, 0, false);
    expect(ctx.store.getById(note.id)?.position.x).toBe(1);

    // a foreign transaction lands mid-burst: begin() auto-commits the nudge tx,
    // the foreign work commits as its own step
    recorder.begin();
    ctx.store.add(createNote({ position: { x: 50, y: 50 }, size: { w: 10, h: 10 } }));
    recorder.commit();
    expect(stack.undoCount).toBe(2); // nudge's move (auto-committed) + foreign add

    // continuation nudge must re-begin its OWN tx, move note to x=2
    actions.nudge(1, 0, false);
    expect(ctx.store.getById(note.id)?.position.x).toBe(2);
    vi.advanceTimersByTime(400);
    expect(stack.undoCount).toBe(3); // continuation is its own single undo step

    // undoing once reverts ONLY the continuation delta (x: 2 -> 1)
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();
    expect(ctx.store.getById(note.id)?.position.x).toBe(1);
    vi.useRealTimers();
  });
});

describe('KeyboardActions.paste cursor-centering', () => {
  it('pastes centered on the cursor when a pointer position is available', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 40, h: 40 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);
    actions.copy();
    (
      actions as unknown as { deps: { getLastPointerWorld: () => { x: number; y: number } } }
    ).deps.getLastPointerWorld = () => ({ x: 500, y: 500 });
    actions.paste();
    const pasted = ctx.store.getAll().find((el) => el.id !== note.id && el.type === 'note');
    expect(pasted?.position).toEqual({ x: 480, y: 480 }); // 40x40 bbox center on (500,500)
  });

  it('falls back to the +20 cascade when no pointer position is available', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 40, h: 40 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);
    actions.copy();
    (actions as unknown as { deps: { getLastPointerWorld: () => null } }).deps.getLastPointerWorld =
      () => null;
    actions.paste();
    const pasted = ctx.store.getAll().find((el) => el.id !== note.id && el.type === 'note');
    expect(pasted?.position).toEqual({ x: 120, y: 120 });
  });
});

describe('KeyboardActions guards during active tool input', () => {
  function activeSetup() {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const made = makeActions({ ctx, recorder, stack, isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    recorder.begin();
    ctx.store.add(note);
    recorder.commit();
    made.tool.setSelection([note.id]);
    return { ...made, stack, recorder, note };
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
    const { actions, ctx, stack, recorder, note } = activeSetup();
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();
    expect(ctx.store.getById(note.id)).toBeUndefined();
    actions.redo();
    expect(ctx.store.getById(note.id)).toBeUndefined();
  });

  it('zOrder is a no-op mid-gesture', () => {
    const { actions, ctx, note } = activeSetup();
    const second = createNote({ position: { x: 10, y: 10 }, size: { w: 100, h: 50 }, zIndex: 1 });
    ctx.store.add(second);
    actions.zOrder('front');
    expect(ctx.store.getById(note.id)?.zIndex).toBe(0);
  });

  it('duplicate is a no-op mid-gesture', () => {
    const ctx = makeCtx();
    const tool = new SelectTool();
    tool.onActivate(ctx);
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);
    const { actions } = makeActions({ ctx, tool, isToolActive: () => true });
    const before = ctx.store.getAll().length;
    actions.duplicate();
    expect(ctx.store.getAll().length).toBe(before);
  });

  it('paste is a no-op mid-gesture', () => {
    const ctx = makeCtx();
    const tool = new SelectTool();
    tool.onActivate(ctx);
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);
    let active = false;
    const { actions } = makeActions({ ctx, tool, isToolActive: () => active });
    actions.copy();
    active = true;
    const before = ctx.store.getAll().length;
    actions.paste();
    expect(ctx.store.getAll().length).toBe(before);
  });
});

describe('KeyboardActions.zOrder single-undo', () => {
  it('bringForward swaps two elements as ONE undo step restoring both', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });

    // same layer (default ''), distinct zIndex so bringForward has a neighbour to swap with
    const a = createNote({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, zIndex: 0 });
    const b = createNote({ position: { x: 10, y: 10 }, size: { w: 50, h: 50 }, zIndex: 1 });
    ctx.store.add(a);
    ctx.store.add(b);
    stack.clear();
    tool.setSelection([a.id]); // select the bottom element

    const undoCountBefore = stack.undoCount;
    actions.zOrder('forward');

    // both zIndexes swapped: a moved up, b moved down
    expect(ctx.store.getById(a.id)?.zIndex).toBe(1);
    expect(ctx.store.getById(b.id)?.zIndex).toBe(0);

    // the two store.update calls collapsed into exactly ONE undo step
    expect(stack.undoCount).toBe(undoCountBefore + 1);

    expect(stack.canUndo).toBe(true);
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();

    // one undo restores BOTH elements...
    expect(ctx.store.getById(a.id)?.zIndex).toBe(0);
    expect(ctx.store.getById(b.id)?.zIndex).toBe(1);
    // ...and there is nothing left to undo (proving it was a single step)
    expect(stack.canUndo).toBe(false);
  });
});
