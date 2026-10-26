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
import { createId, formatId } from '../elements/create-id';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import { ConstraintServiceProxy } from '../core/constraint-service';
import { snapPoint } from '../core/snap';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import { ElementRegistry } from '../elements/element-registry';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
} from '../elements/types';
import { createTestBoxRegistry } from '../test-helpers/test-box-type';

function makeSnapProxy(gridSize: number): ConstraintServiceProxy {
  const proxy = new ConstraintServiceProxy();
  proxy.setImplementation({
    constrainPoint: (p) => snapPoint(p, gridSize),
    getConstraintInfo: () => ({
      type: 'square',
      cellSize: gridSize,
      snapStep: gridSize,
      nudgeStep: gridSize,
    }),
    hasCapability: () => true,
  });
  proxy.setActive(true);
  return proxy;
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
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
    rotate?: (direction: 'cw' | 'ccw') => void;
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
    rotate: opts.rotate,
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

  it('excludes registered full-canvas extensions without excluding ordinary extensions', () => {
    const registry = new ElementRegistry();
    for (const [type, fullCanvas] of [
      ['test:full-canvas', true],
      ['test:inline', false],
    ] as const) {
      registry.register<BaseElement>({
        type,
        legacyTypes: [],
        decodeLegacy: () => {
          throw new Error('no legacy');
        },
        validateData: () => true,
        unwrap: ({ data: _data, extensionType: _extensionType, ...base }) => base,
        wrap: ({ type: _type, ...base }) => ({
          ...base,
          type: 'extension',
          extensionType: type,
          data: {},
        }),
        bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 10, h: 10 }),
        fullCanvas,
      });
    }
    const ctx = makeCtx({ store: new ElementStore(registry), elementRegistry: registry });
    const { actions, tool } = makeActions({ ctx });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const fullCanvas: ExtensionElementEnvelope = {
      id: 'full-canvas',
      type: 'extension',
      extensionType: 'test:full-canvas',
      position: { x: 0, y: 0 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    };
    const inline: ExtensionElementEnvelope = {
      ...fullCanvas,
      id: 'inline',
      extensionType: 'test:inline',
      index: 'a2',
    };
    const unknown: ExtensionElementEnvelope = {
      ...fullCanvas,
      id: 'unknown',
      extensionType: 'test:unknown',
      index: 'a3',
    };
    ctx.store.add(note);
    ctx.store.add(fullCanvas);
    ctx.store.add(inline);
    ctx.store.add(unknown);

    actions.selectAll();

    expect([...tool.selectedIds].sort()).toEqual([note.id, inline.id, unknown.id].sort());
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
  it('duplicate places clones on top with version 1', () => {
    const { actions, ctx, tool } = makeActions();
    const low = { ...createNote({ position: { x: 0, y: 0 } }), id: 'low', index: 'a0' };
    const top = { ...createNote({ position: { x: 0, y: 0 } }), id: 'top', index: 'a5' };
    ctx.store.add({ ...low, version: 4, editor: 'peer' });
    ctx.store.add({ ...top, version: 9 });
    tool.setSelection(['top', 'low']);

    actions.duplicate();

    const order = ctx.store.getAll().map((el) => el.id);
    expect(order.slice(0, 2)).toEqual(['low', 'top']);
    const clones = order.slice(2).map((id) => ctx.store.getById(id));
    expect(clones.map((el) => el?.version)).toEqual([1, 1]);
    expect(clones.every((el) => el !== undefined && !('editor' in el))).toBe(true);
    expect(clones.map((el) => el?.index ?? '').every((index) => index > 'a5')).toBe(true);
  });

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
    const fake = {
      begin: vi.fn(),
      commit: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      run: (fn: () => void): void => {
        fake.begin();
        fn();
        fake.commit();
      },
    };
    const recorder = fake as unknown as HistoryRecorder;
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
  it('copies and removes a parent subtree child-first as one undo step', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const parent = {
      ...createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 } }),
      id: 'parent',
    };
    const child = {
      ...createNote({ position: { x: 5, y: 5 }, size: { w: 10, h: 10 }, parentId: parent.id }),
      id: 'child',
    };
    const grandchild = {
      ...createNote({ position: { x: 7, y: 7 }, size: { w: 5, h: 5 }, parentId: child.id }),
      id: 'grandchild',
    };
    for (const element of [parent, child, grandchild]) ctx.store.add(element);
    stack.clear();
    tool.setSelection([parent.id, child.id]);
    const removed: string[] = [];
    ctx.store.on('remove', (element) => removed.push(element.id));

    actions.cut();

    expect(removed).toEqual(['grandchild', 'child', 'parent']);
    expect(stack.undoCount).toBe(1);
    expect(ctx.store.count).toBe(0);
    expect(stack.undo(ctx.store)).toBe(true);
    expect(ctx.store.getAll().map((element) => element.id)).toEqual([
      'parent',
      'child',
      'grandchild',
    ]);
    expect(stack.redo(ctx.store)).toBe(true);
    expect(ctx.store.count).toBe(0);
  });

  it('duplicates a selected parent tree with remapped ownership and only selects the clone root', () => {
    const { actions, ctx, tool } = makeActions();
    const parent = {
      ...createNote({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 } }),
      id: 'parent',
    };
    const child = {
      ...createNote({ position: { x: 5, y: 5 }, size: { w: 10, h: 10 }, parentId: parent.id }),
      id: 'child',
    };
    ctx.store.add(parent);
    ctx.store.add(child);
    tool.setSelection([parent.id, child.id]);

    actions.duplicate();

    const clones = ctx.store
      .getAll()
      .filter((element) => element.id !== parent.id && element.id !== child.id);
    const [cloneParent] = clones.filter((element) => !element.parentId);
    const [cloneChild] = clones.filter((element) => element.parentId === cloneParent?.id);
    expect(ctx.store.count).toBe(4);
    expect(clones).toHaveLength(2);
    expect(clones.map((element) => element.position)).toEqual([
      { x: 20, y: 20 },
      { x: 25, y: 25 },
    ]);
    expect(new Set(clones.map((element) => element.id))).toHaveLength(2);
    expect(cloneParent).toBeDefined();
    expect(cloneChild).toBeDefined();
    expect(tool.selectedIds).toEqual([cloneParent?.id]);
  });

  it('duplicates a selected child closure as a detached tree', () => {
    const { actions, ctx, tool } = makeActions();
    const parent = { ...createNote({ position: { x: 0, y: 0 } }), id: 'parent' };
    const child = { ...createNote({ position: { x: 5, y: 5 }, parentId: parent.id }), id: 'child' };
    const grandchild = {
      ...createNote({ position: { x: 10, y: 10 }, parentId: child.id }),
      id: 'grandchild',
    };
    for (const element of [parent, child, grandchild]) ctx.store.add(element);
    tool.setSelection([child.id]);

    actions.duplicate();

    const cloneChild = ctx.store
      .getAll()
      .find(
        (element) =>
          ![parent.id, child.id, grandchild.id].includes(element.id) && !element.parentId,
      );
    const cloneGrandchild = ctx.store
      .getAll()
      .find((element) => element.id !== grandchild.id && element.parentId === cloneChild?.id);
    expect(cloneChild).toBeDefined();
    expect(cloneGrandchild).toBeDefined();
    expect(ctx.store.getById(child.id)?.parentId).toBe(parent.id);
    expect(ctx.store.getById(grandchild.id)?.parentId).toBe(child.id);
    expect(tool.selectedIds).toEqual([cloneChild?.id]);
  });

  it('undoes and redoes a three-level duplicate without breaking hierarchy', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const parent = { ...createNote({ position: { x: 0, y: 0 } }), id: 'parent' };
    const child = { ...createNote({ position: { x: 5, y: 5 }, parentId: parent.id }), id: 'child' };
    const grandchild = {
      ...createNote({ position: { x: 10, y: 10 }, parentId: child.id }),
      id: 'grandchild',
    };
    for (const element of [parent, child, grandchild]) ctx.store.add(element);
    stack.clear();
    tool.setSelection([parent.id]);

    actions.duplicate();
    const cloneParent = tool.selectedIds[0];
    const cloneChild = ctx.store.getChildren(cloneParent)[0];
    const cloneGrandchild = cloneChild && ctx.store.getChildren(cloneChild.id)[0];
    expect(cloneChild?.parentId).toBe(cloneParent);
    expect(cloneGrandchild?.parentId).toBe(cloneChild?.id);

    actions.undo();
    expect(ctx.store.getById(cloneParent)).toBeUndefined();
    expect(ctx.store.getById(cloneChild?.id ?? '')).toBeUndefined();
    actions.redo();
    expect(ctx.store.getById(cloneParent)).toBeDefined();
    expect(ctx.store.getById(cloneChild?.id ?? '')?.parentId).toBe(cloneParent);
    expect(ctx.store.getById(cloneGrandchild?.id ?? '')?.parentId).toBe(cloneChild?.id);
  });

  it('copies the selection then removes it from the store', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.cut();

    expect(actions.hasClipboard()).toBe(true);
    expect(ctx.store.getById(note.id)).toBeUndefined();
  });

  it('pastes a cut parent tree with only clone-to-clone ownership and root selection', () => {
    const { actions, ctx, tool } = makeActions();
    const parent = { ...createNote({ position: { x: 0, y: 0 } }), id: 'parent' };
    const child = { ...createNote({ position: { x: 5, y: 5 }, parentId: parent.id }), id: 'child' };
    const grandchild = {
      ...createNote({ position: { x: 10, y: 10 }, parentId: child.id }),
      id: 'grandchild',
    };
    for (const element of [parent, child, grandchild]) ctx.store.add(element);
    tool.setSelection([parent.id]);

    actions.cut();
    actions.paste();

    const cloneRoot = tool.selectedIds[0];
    const cloneChild = cloneRoot && ctx.store.getChildren(cloneRoot)[0];
    const cloneGrandchild = cloneChild && ctx.store.getChildren(cloneChild.id)[0];
    expect(ctx.store.count).toBe(3);
    expect(cloneRoot).toBeDefined();
    expect(cloneChild?.parentId).toBe(cloneRoot);
    expect(cloneGrandchild?.parentId).toBe(cloneChild?.id);
    expect([cloneRoot, cloneChild?.id, cloneGrandchild?.id]).not.toContain(parent.id);
    expect([cloneRoot, cloneChild?.id, cloneGrandchild?.id]).not.toContain(child.id);
    expect([cloneRoot, cloneChild?.id, cloneGrandchild?.id]).not.toContain(grandchild.id);
    expect(tool.selectedIds).toEqual([cloneRoot]);
  });

  it('duplicates two selected roots and selects exactly their cloned roots', () => {
    const { actions, ctx, tool } = makeActions();
    const first = { ...createNote({ position: { x: 0, y: 0 } }), id: 'first' };
    const firstChild = {
      ...createNote({ position: { x: 5, y: 5 }, parentId: first.id }),
      id: 'first-child',
    };
    const second = { ...createNote({ position: { x: 100, y: 0 } }), id: 'second' };
    const secondChild = {
      ...createNote({ position: { x: 105, y: 5 }, parentId: second.id }),
      id: 'second-child',
    };
    for (const element of [first, firstChild, second, secondChild]) ctx.store.add(element);
    tool.setSelection([first.id, second.id]);

    actions.duplicate();

    const clonedRoots = ctx.store
      .getAll()
      .filter(
        (element) => ![first.id, firstChild.id, second.id, secondChild.id].includes(element.id),
      )
      .filter((element) => !element.parentId)
      .map((element) => element.id);
    expect(tool.selectedIds).toHaveLength(2);
    expect(tool.selectedIds).toEqual(clonedRoots);
    for (const rootId of tool.selectedIds) {
      expect(ctx.store.getById(rootId)?.parentId).toBeUndefined();
      expect(ctx.store.getChildren(rootId)).toHaveLength(1);
    }
    expect(tool.selectedIds).not.toContain(firstChild.id);
    expect(tool.selectedIds).not.toContain(secondChild.id);
  });

  it('leaves the source tree untouched when cut preparation cannot clone it', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const parent = { ...createNote({ position: { x: 0, y: 0 } }), id: 'parent' };
    const child = {
      ...createNote({ position: { x: 5, y: 5 }, parentId: parent.id }),
      id: 'child',
      unsupported: () => undefined,
    } as unknown as typeof parent;
    ctx.store.add(parent);
    ctx.store.add(child);
    stack.clear();
    tool.setSelection([parent.id]);
    const removed = vi.fn();
    ctx.store.on('remove', removed);

    expect(() => actions.cut()).toThrow();

    expect(ctx.store.getAll().map((element) => element.id)).toEqual([parent.id, child.id]);
    expect(tool.selectedIds).toEqual([parent.id]);
    expect(stack.undoCount).toBe(0);
    expect(removed).not.toHaveBeenCalled();
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

describe('KeyboardActions.rotate', () => {
  it('rotate() delegates to the rotate dep with the direction', () => {
    const rotate = vi.fn();
    const { actions, ctx, tool } = makeActions({ rotate });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.rotate('cw');

    expect(rotate).toHaveBeenCalledWith('cw');
  });

  it('rotate() no-ops while a tool interaction is active', () => {
    const rotate = vi.fn();
    const { actions, ctx, tool } = makeActions({ rotate, isToolActive: () => true });
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.rotate('cw');

    expect(rotate).not.toHaveBeenCalled();
  });

  it('rotate() no-ops with empty selection', () => {
    const rotate = vi.fn();
    const { actions, tool } = makeActions({ rotate });
    tool.setSelection([]);

    actions.rotate('ccw');

    expect(rotate).not.toHaveBeenCalled();
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
    const ctx = makeCtx({ constraintService: makeSnapProxy(40) });
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

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -40])(
    'falls back to 10 units for invalid cell nudge step %s',
    (nudgeStep) => {
      const constraintService = new ConstraintServiceProxy();
      constraintService.setImplementation({
        constrainPoint: (point) => point,
        getConstraintInfo: () => ({ type: 'test-mode', nudgeStep }),
        hasCapability: () => false,
      });
      constraintService.setActive(true);
      const ctx = makeCtx({ constraintService });
      const { actions, tool } = makeActions({ ctx });
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      ctx.store.add(note);
      tool.setSelection([note.id]);

      actions.nudge(1, 0, true);

      expect(ctx.store.getById(note.id)?.position.x).toBe(10);
    },
  );

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

  it('coalesces a subtree nudge burst and undo restores every member', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const parent = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    const child = createNote({
      position: { x: 20, y: 20 },
      size: { w: 40, h: 20 },
      parentId: parent.id,
      locked: true,
    });
    ctx.store.add(parent);
    ctx.store.add(child);
    stack.clear();
    tool.setSelection([parent.id]);

    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    vi.advanceTimersByTime(400);

    expect(stack.undoCount).toBe(1);
    expect(ctx.store.getById(parent.id)?.position).toEqual({ x: 2, y: 0 });
    expect(ctx.store.getById(child.id)?.position).toEqual({ x: 22, y: 20 });
    expect(stack.undo(ctx.store)).toBe(true);
    expect(ctx.store.getById(parent.id)?.position).toEqual({ x: 0, y: 0 });
    expect(ctx.store.getById(child.id)?.position).toEqual({ x: 20, y: 20 });
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

  it('continuation nudge BURST after a foreign transaction forms ONE undo step', () => {
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
    const afterForeign = stack.undoCount;
    expect(afterForeign).toBe(2); // nudge's move (auto-committed) + foreign add

    // continuation BURST: two back-to-back nudges with NO timer advance between
    // them, so they are one burst. The first must re-begin a tx (foreign takeover);
    // the second must EXTEND that same tx, not record a separate untransacted step.
    actions.nudge(1, 0, false);
    actions.nudge(1, 0, false);
    expect(ctx.store.getById(note.id)?.position.x).toBe(3);
    vi.advanceTimersByTime(400);
    // the whole continuation burst is exactly ONE undo step (not two). Against the
    // pre-fix code each continuation nudge after the foreign commit lands as its own
    // untransacted step, so this would be afterForeign + 2.
    expect(stack.undoCount).toBe(afterForeign + 1);

    // undoing once reverts the WHOLE continuation burst (x: 3 -> 1), not just the
    // last nudge (which would leave x: 3 -> 2 under the pre-fix code).
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

  it('centers pasted extension clones with the bounds of the context registry', () => {
    const elementRegistry = createTestBoxRegistry();
    const ctx = makeCtx({ elementRegistry, store: new ElementStore(elementRegistry) });
    const { actions, tool } = makeActions({ ctx });
    ctx.store.add({
      id: 'box',
      type: 'extension',
      extensionType: 'test:box',
      position: { x: 100, y: 100 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    });
    tool.setSelection(['box']);
    actions.copy();
    (
      actions as unknown as { deps: { getLastPointerWorld: () => { x: number; y: number } } }
    ).deps.getLastPointerWorld = () => ({ x: 500, y: 500 });

    actions.paste();

    const pasted = ctx.store.getAll().find((el) => el.id !== 'box');
    expect(pasted?.position).toEqual({ x: 480, y: 490 });
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
    const second = createNote({ position: { x: 10, y: 10 }, size: { w: 100, h: 50 }, index: 'a1' });
    ctx.store.add(second);
    actions.zOrder('front');
    expect(ctx.store.getById(note.id)?.index).toBe('a0');
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
  it('bringForward is ONE undo step restoring the order', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });

    const a = createNote({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, index: 'a0' });
    const b = createNote({ position: { x: 10, y: 10 }, size: { w: 50, h: 50 }, index: 'a1' });
    ctx.store.add(a);
    ctx.store.add(b);
    stack.clear();
    tool.setSelection([a.id]); // select the bottom element

    const undoCountBefore = stack.undoCount;
    actions.zOrder('forward');

    expect(ctx.store.getAll().map((el) => el.id)).toEqual([b.id, a.id]);
    expect(stack.undoCount).toBe(undoCountBefore + 1);

    expect(stack.canUndo).toBe(true);
    recorder.pause();
    stack.undo(ctx.store);
    recorder.resume();

    expect(ctx.store.getAll().map((el) => el.id)).toEqual([a.id, b.id]);
    expect(stack.canUndo).toBe(false);
  });
});

describe('KeyboardActions.cycleSelection', () => {
  function makeNote(x: number, z: number, extra: Record<string, unknown> = {}) {
    return createNote({ position: { x, y: 0 }, size: { w: 50, h: 50 }, index: `a${z}`, ...extra });
  }

  it('selects the first eligible (lowest render order) from an empty selection on +1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [c, a, b]) ctx.store.add(el);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([a.id]);
  });

  it('selects the last eligible (highest render order) from an empty selection on -1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [c, a, b]) ctx.store.add(el);

    actions.cycleSelection(-1);

    expect(tool.selectedIds).toEqual([c.id]);
  });

  it('moves to the next element in render order on +1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [a, b, c]) ctx.store.add(el);
    tool.setSelection([a.id]);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([b.id]);
  });

  it('moves to the previous element in render order on -1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [a, b, c]) ctx.store.add(el);
    tool.setSelection([c.id]);

    actions.cycleSelection(-1);

    expect(tool.selectedIds).toEqual([b.id]);
  });

  it('wraps from the last to the first on +1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [a, b, c]) ctx.store.add(el);
    tool.setSelection([c.id]);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([a.id]);
  });

  it('wraps from the first to the last on -1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    for (const el of [a, b, c]) ctx.store.add(el);
    tool.setSelection([a.id]);

    actions.cycleSelection(-1);

    expect(tool.selectedIds).toEqual([c.id]);
  });

  it('collapses a multi-selection to the one after the highest-ordered member on +1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    const d = makeNote(300, 3);
    for (const el of [a, b, c, d]) ctx.store.add(el);
    tool.setSelection([a.id, c.id]);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([d.id]);
  });

  it('collapses a multi-selection to the one before the lowest-ordered member on -1', () => {
    const { actions, ctx, tool } = makeActions();
    const a = makeNote(0, 0);
    const b = makeNote(100, 1);
    const c = makeNote(200, 2);
    const d = makeNote(300, 3);
    for (const el of [a, b, c, d]) ctx.store.add(el);
    tool.setSelection([b.id, d.id]);

    actions.cycleSelection(-1);

    expect(tool.selectedIds).toEqual([a.id]);
  });

  it('never cycles onto locked or hidden-layer elements', () => {
    const ctx = makeCtx({
      isLayerVisible: (layerId: string) => layerId !== 'hidden-layer',
    });
    const { actions, tool } = makeActions({ ctx });
    const a = makeNote(0, 0);
    const locked = makeNote(100, 1, { locked: true });
    const hidden = makeNote(300, 3, { layerId: 'hidden-layer' });
    const b = makeNote(400, 4);
    for (const el of [a, locked, hidden, b]) ctx.store.add(el);
    tool.setSelection([a.id]);

    actions.cycleSelection(1);
    expect(tool.selectedIds).toEqual([b.id]);

    actions.cycleSelection(1); // wraps back to a, skipping all the excluded ones
    expect(tool.selectedIds).toEqual([a.id]);
  });

  it('is a no-op (selection unchanged) when there are no eligible elements', () => {
    const { actions, ctx, tool } = makeActions();
    const locked = makeNote(100, 1, { locked: true });
    ctx.store.add(locked);
    tool.setSelection([]);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([]);
  });

  it('is a no-op when isToolActive returns true', () => {
    const { actions, ctx, tool } = makeActions({ isToolActive: () => true });
    const a = makeNote(0, 0);
    ctx.store.add(a);

    actions.cycleSelection(1);

    expect(tool.selectedIds).toEqual([]);
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
    const note = makeNote(0, 0);
    ctx.store.add(note);

    actions.cycleSelection(1);

    expect(ctx.switchTool).toHaveBeenCalledWith('select');
    expect(selectTool.selectedIds).toEqual([note.id]);
  });
});

interface LinkElement extends BaseElement {
  type: 'link';
  targetId: string;
}

const linkDefinition: ElementTypeDefinition<LinkElement> = {
  type: 'test:link',
  legacyTypes: [],
  decodeLegacy: () => {
    throw new Error('no legacy');
  },
  validateData: (data) => typeof data['targetId'] === 'string',
  unwrap: ({ data, ...base }) => ({ ...base, type: 'link', targetId: String(data['targetId']) }),
  wrap: ({ targetId, ...base }) => ({
    ...base,
    type: 'extension',
    extensionType: 'test:link',
    data: { targetId },
  }),
  bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 10, h: 10 }),
};

describe('KeyboardActions extension cloneRemap', () => {
  const idMaps: ReadonlyMap<string, string>[] = [];
  const remapping: ElementTypeDefinition<LinkElement> = {
    ...linkDefinition,
    cloneRemap: (el, idMap) => {
      idMaps.push(new Map(idMap));
      return { ...el, targetId: idMap.get(el.targetId) ?? 'dangling' };
    },
  };

  function setup(def: ElementTypeDefinition<LinkElement>) {
    idMaps.length = 0;
    const registry = new ElementRegistry();
    registry.register(def);
    const ctx = makeCtx({
      store: new ElementStore(registry),
      elementRegistry: registry,
      activeLayerId: 'layer-2',
    });
    const made = makeActions({ ctx });
    const target = createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const link: ExtensionElementEnvelope = {
      id: 'link-1',
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 5, y: 5 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      data: { targetId: target.id },
    };
    ctx.store.add(target);
    ctx.store.add(link);
    return { ...made, target, link };
  }

  function cloneOf(ctx: ToolContext, source: { id: string; type: string }) {
    return ctx.store.getAll().find((el) => el.type === source.type && el.id !== source.id);
  }

  it('duplicate with the target remaps data.targetId to the target clone', () => {
    const { actions, ctx, tool, target, link } = setup(remapping);
    tool.setSelection([target.id, link.id]);

    actions.duplicate();

    const targetClone = cloneOf(ctx, target);
    const linkClone = cloneOf(ctx, link);
    expect(targetClone).toBeDefined();
    expect(linkClone).toMatchObject({
      position: { x: 25, y: 25 },
      layerId: 'layer-2',
      data: { targetId: targetClone?.id },
    });
    expect(linkClone?.id).not.toBe(link.id);
    expect(idMaps).toEqual([
      new Map([
        [target.id, targetClone?.id],
        [link.id, linkClone?.id],
      ]),
    ]);
  });

  it('duplicate alone passes the map without the target to the def', () => {
    const { actions, ctx, tool, link } = setup(remapping);
    tool.setSelection([link.id]);

    actions.duplicate();

    const linkClone = cloneOf(ctx, link);
    expect(linkClone).toMatchObject({ data: { targetId: 'dangling' } });
    expect(idMaps).toEqual([new Map([[link.id, linkClone?.id]])]);
  });

  it('paste with the target remaps data.targetId to the target clone', () => {
    const { actions, ctx, tool, target, link } = setup(remapping);
    tool.setSelection([target.id, link.id]);
    actions.copy();

    actions.paste();

    const targetClone = cloneOf(ctx, target);
    const linkClone = cloneOf(ctx, link);
    expect(linkClone).toMatchObject({ data: { targetId: targetClone?.id } });
  });

  it('a throwing cloneRemap on the second clone adds nothing and records no undo step', () => {
    let calls = 0;
    const registry = new ElementRegistry();
    registry.register<LinkElement>({
      ...linkDefinition,
      cloneRemap: (el) => {
        calls++;
        if (calls === 2) throw new Error('remap failed');
        return el;
      },
    });
    const ctx = makeCtx({ store: new ElementStore(registry), elementRegistry: registry });
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const links: ExtensionElementEnvelope[] = ['link-a', 'link-b'].map((id) => ({
      id,
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      data: { targetId: 'none' },
    }));
    for (const link of links) ctx.store.add(link);
    stack.clear();
    tool.setSelection(links.map((link) => link.id));
    const added = vi.fn();
    ctx.store.on('add', added);

    expect(() => actions.duplicate()).toThrow('remap failed');

    expect(ctx.store.getAll().map((el) => el.id)).toEqual(['link-a', 'link-b']);
    expect(tool.selectedIds).toEqual(['link-a', 'link-b']);
    expect(stack.undoCount).toBe(0);
    expect(added).not.toHaveBeenCalled();
  });

  it('keeps canonical clone structure when an erased remapper replaces envelope fields', () => {
    const registry = new ElementRegistry();
    registry.register(linkDefinition);
    const ctx = makeCtx({ store: new ElementStore(registry), elementRegistry: registry });
    const { actions, tool } = makeActions({ ctx });
    const parent = {
      ...createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
      id: 'parent',
      layerId: 'layer-1',
    };
    const link: ExtensionElementEnvelope = {
      id: 'link',
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 5, y: 5 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      parentId: parent.id,
      data: { targetId: 'before' },
    };
    ctx.store.add(parent);
    ctx.store.add(link);
    const sibling: ExtensionElementEnvelope = {
      id: 'sibling',
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 10, y: 10 },
      index: 'a2',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      parentId: parent.id,
      data: { targetId: link.id },
    };
    const grandchild = {
      ...createNote({ position: { x: 8, y: 8 }, size: { w: 5, h: 5 }, parentId: link.id }),
      id: 'grandchild',
      layerId: 'layer-1',
    };
    ctx.store.add(sibling);
    ctx.store.add(grandchild);
    const adapter = registry.getAdapter('test:link');
    if (!adapter) throw new Error('missing adapter');
    const maps: ReadonlyMap<string, string>[] = [];
    const returnedData = { targetId: 'after' };
    const validateEnvelope = adapter.validateEnvelope;
    adapter.validateEnvelope = (element) => {
      element.data['validatorMutation'] = true;
      return validateEnvelope(element);
    };
    adapter.cloneRemap = (element, idMap) => {
      maps.push(new Map(idMap));
      const mutableElement = element as unknown as {
        id: string;
        parentId?: string;
        position: { x: number; y: number };
        data: Record<string, unknown>;
      };
      mutableElement.id = 'attacker-id';
      mutableElement.parentId = parent.id;
      mutableElement.position.x = 999;
      mutableElement.data['targetId'] = 'attacker-data';
      const mutableMap = idMap as Map<string, string>;
      mutableMap.set(parent.id, 'attacker-parent');
      mutableMap.delete(link.id);
      mutableMap.set('attacker-id', 'attacker-clone');
      return {
        ...element,
        id: 'attacker-id',
        parentId: parent.id,
        data: returnedData,
      } as ExtensionElementEnvelope;
    };
    tool.setSelection([parent.id]);

    actions.duplicate();

    const expectedSourceIds = [parent.id, link.id, sibling.id, grandchild.id];
    const [firstMap, secondMap] = maps;
    if (!firstMap || !secondMap) throw new Error('clone remaps did not receive id maps');
    const parentClone = ctx.store.getById(firstMap.get(parent.id) ?? '');
    const linkClone = ctx.store.getById(firstMap.get(link.id) ?? '');
    const siblingClone = ctx.store.getById(firstMap.get(sibling.id) ?? '');
    const grandchildClone = ctx.store.getById(firstMap.get(grandchild.id) ?? '');
    returnedData.targetId = 'mutated-after-clone';

    expect(ctx.store.getById('attacker-id')).toBeUndefined();
    expect(parentClone).toBeDefined();
    expect(linkClone).toMatchObject({
      parentId: parentClone?.id,
      position: { x: 25, y: 25 },
      data: { targetId: 'after' },
    });
    expect(siblingClone).toMatchObject({
      parentId: parentClone?.id,
      position: { x: 30, y: 30 },
      data: { targetId: 'after' },
    });
    expect(grandchildClone).toMatchObject({ parentId: linkClone?.id });
    expect(linkClone?.data).not.toHaveProperty('validatorMutation');
    expect(siblingClone?.data).not.toHaveProperty('validatorMutation');
    expect(tool.selectedIds).toEqual([parentClone?.id]);
    expect([...tool.selectedIds].every((id) => ctx.store.getById(id) !== undefined)).toBe(true);
    expect(maps).toHaveLength(2);
    expect(secondMap).toEqual(firstMap);
    for (const map of maps) {
      expect(map.size).toBe(4);
      expect([...map.keys()].sort()).toEqual(expectedSourceIds.sort());
      expect([...map.values()].every((id) => ctx.store.getById(id) !== undefined)).toBe(true);
    }
  });

  it('rejects invalid remapped data before adding a clone or recording history', () => {
    const registry = new ElementRegistry();
    registry.register(linkDefinition);
    const ctx = makeCtx({ store: new ElementStore(registry), elementRegistry: registry });
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const link: ExtensionElementEnvelope = {
      id: 'link',
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 5, y: 5 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      data: { targetId: 'before' },
    };
    ctx.store.add(link);
    stack.clear();
    const adapter = registry.getAdapter('test:link');
    if (!adapter) throw new Error('missing adapter');
    adapter.cloneRemap = (element) =>
      ({ ...element, data: { targetId: 1 } }) as ExtensionElementEnvelope;
    const added = vi.fn();
    ctx.store.on('add', added);
    tool.setSelection([link.id]);

    expect(() => actions.duplicate()).toThrow('Invalid cloned extension data');

    expect(ctx.store.getAll().map((element) => element.id)).toEqual([link.id]);
    expect(tool.selectedIds).toEqual([link.id]);
    expect(stack.undoCount).toBe(0);
    expect(added).not.toHaveBeenCalled();
  });

  it('validates a registered extension clone even when it has no remapper', () => {
    const registry = new ElementRegistry();
    registry.register(linkDefinition);
    const ctx = makeCtx({ store: new ElementStore(registry), elementRegistry: registry });
    const { actions, tool } = makeActions({ ctx });
    const link: ExtensionElementEnvelope = {
      id: 'link',
      type: 'extension',
      extensionType: 'test:link',
      position: { x: 5, y: 5 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: 'layer-1',
      data: { targetId: 1 },
    };
    ctx.store.add(link);
    tool.setSelection([link.id]);

    expect(() => actions.duplicate()).toThrow('Invalid cloned extension data');
    expect(ctx.store.getAll().map((element) => element.id)).toEqual([link.id]);
    expect(tool.selectedIds).toEqual([link.id]);
  });

  it('preflights malformed clipboard hierarchy before mutating the store', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const a = { ...createNote({ position: { x: 0, y: 0 }, parentId: 'b' }), id: 'a' };
    const b = { ...createNote({ position: { x: 5, y: 5 }, parentId: 'a' }), id: 'b' };
    (actions as unknown as { clipboard: CanvasElement[] }).clipboard = [a, b];
    const added = vi.fn();
    ctx.store.on('add', added);

    expect(() => actions.paste()).toThrow('Invalid hierarchy');

    expect(ctx.store.count).toBe(0);
    expect(tool.selectedIds).toEqual([]);
    expect(stack.undoCount).toBe(0);
    expect(added).not.toHaveBeenCalled();
  });

  it('rejects a clone id that collides with a raw non-scene store entry before adding', () => {
    const ctx = makeCtx();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(ctx.store, stack);
    const { actions, tool } = makeActions({ ctx, recorder, stack });
    const source = { ...createNote({ position: { x: 0, y: 0 } }), id: 'source' };
    const hidden = createNote({ position: { x: 10, y: 10 }, parentId: 'missing' });
    ctx.store.add(source);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1);
    const probe = createId('note');
    const [, time, counter, client] = probe.split('_');
    if (!time || !counter || !client) throw new Error('invalid probe id');
    const collisionId = formatId(
      'note',
      time,
      (Number.parseInt(counter, 36) + 1).toString(36),
      client,
    );
    ctx.store.add({ ...hidden, id: collisionId }, { origin: 'remote' });
    stack.clear();
    const added = vi.fn();
    ctx.store.on('add', added);
    tool.setSelection([source.id]);

    expect(() => actions.duplicate()).toThrow(`Clone id collision "${collisionId}"`);

    now.mockRestore();
    expect(ctx.store.getById(source.id)).toBeDefined();
    expect(ctx.store.getById(collisionId)).toBeDefined();
    expect(tool.selectedIds).toEqual([source.id]);
    expect(stack.undoCount).toBe(0);
    expect(added).not.toHaveBeenCalled();
  });

  it('a def without cloneRemap keeps the clone data unchanged', () => {
    const { actions, ctx, tool, target, link } = setup(linkDefinition);
    tool.setSelection([target.id, link.id]);

    actions.duplicate();

    const linkClone = cloneOf(ctx, link);
    expect(linkClone).toMatchObject({ data: { targetId: target.id } });
  });
});
