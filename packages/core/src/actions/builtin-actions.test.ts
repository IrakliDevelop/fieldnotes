import { describe, it, expect, vi } from 'vitest';

import type { KeyboardActions } from '../canvas/keyboard-actions';
import type { ActionContext, ActionDefinition, ActionInvocation } from './types';
import type { Viewport } from '../canvas/viewport';
import type { ElementStore } from '../elements/element-store';
import {
  createBuiltinActions,
  createToolAction,
  DEFAULT_TOOL_SHORTCUTS,
  BUILTIN_MENU_GROUPS,
} from './builtin-actions';
import type { BuiltinActionDeps, ToolActionDeps } from './builtin-actions';

// ---------- helpers ----------

function makeSpyKeyboardActions(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    deleteSelected: vi.fn(),
    deselect: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    cycleSelection: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    zOrder: vi.fn(),
    zoomToFit: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    cut: vi.fn(),
    toggleLock: vi.fn(),
    rotate: vi.fn(),
    nudge: vi.fn().mockReturnValue(true),
  };
}

function makeDeps(overrides?: Partial<BuiltinActionDeps>): BuiltinActionDeps {
  return {
    keyboardActions: makeSpyKeyboardActions() as unknown as KeyboardActions,
    zoomByFactor: vi.fn(),
    zoomToLevel: vi.fn(),
    canPaste: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<ActionContext>): ActionContext {
  return {
    viewport: {} as unknown as Viewport,
    store: { getById: vi.fn() } as unknown as ElementStore,
    selectedIds: ['el-1', 'el-2'],
    ...overrides,
  };
}

const defaultInvocation: ActionInvocation = { source: 'keyboard', shiftKey: false };

function findAction(actions: ActionDefinition[], id: string): ActionDefinition {
  const a = actions.find((d) => d.id === id);
  if (!a) throw new Error(`Action ${id} not found`);
  return a;
}

// ---------- Expected canonical order ----------
// DEFAULT_BINDINGS order (shortcut-map.ts:26-52) with edit.paste inserted
// directly after edit.copy (base switch order: copy, paste, duplicate).
const EXPECTED_IDS = [
  'edit.delete',
  'select.none',
  'edit.undo',
  'edit.redo',
  'select.all',
  'select.cycle',
  'select.cycle-reverse',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'arrange.bring-forward',
  'arrange.send-backward',
  'arrange.bring-to-front',
  'arrange.send-to-back',
  'view.zoom-to-fit',
  'view.zoom-in',
  'view.zoom-out',
  'view.zoom-reset',
  'arrange.group',
  'arrange.ungroup',
  'edit.cut',
  'arrange.toggle-lock',
  'arrange.rotate-cw',
  'arrange.rotate-ccw',
  'arrange.nudge-left',
  'arrange.nudge-right',
  'arrange.nudge-up',
  'arrange.nudge-down',
];

// Legacy DEFAULT_BINDINGS from shortcut-map.ts
const EXPECTED_SHORTCUTS: Record<string, readonly string[] | undefined> = {
  'edit.delete': ['delete', 'backspace'],
  'select.none': ['escape'],
  'edit.undo': ['mod+z'],
  'edit.redo': ['mod+y', 'mod+shift+z'],
  'select.all': ['mod+a'],
  'select.cycle': ['tab'],
  'select.cycle-reverse': ['shift+tab'],
  'edit.copy': ['mod+c'],
  'edit.paste': undefined,
  'edit.duplicate': ['mod+d'],
  'arrange.bring-forward': [']'],
  'arrange.send-backward': ['['],
  'arrange.bring-to-front': ['mod+]'],
  'arrange.send-to-back': ['mod+['],
  'view.zoom-to-fit': ['shift+1'],
  'view.zoom-in': ['mod+='],
  'view.zoom-out': ['mod+-'],
  'view.zoom-reset': ['mod+0'],
  'arrange.group': ['mod+g'],
  'arrange.ungroup': ['mod+shift+g'],
  'edit.cut': ['mod+x'],
  'arrange.toggle-lock': ['mod+shift+l'],
  'arrange.rotate-cw': ['r'],
  'arrange.rotate-ccw': ['shift+r'],
  'arrange.nudge-left': ['arrowleft'],
  'arrange.nudge-right': ['arrowright'],
  'arrange.nudge-up': ['arrowup'],
  'arrange.nudge-down': ['arrowdown'],
};

describe('createBuiltinActions', () => {
  it('emits the 28 non-tool ids in DEFAULT_BINDINGS order with edit.paste inserted after edit.copy', () => {
    const deps = makeDeps();
    const actions = createBuiltinActions(deps);
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(EXPECTED_IDS);
  });

  it('every definition has label, and shortcut equal to the legacy default bindings (edit.paste: shortcut undefined)', () => {
    const deps = makeDeps();
    const actions = createBuiltinActions(deps);
    for (const action of actions) {
      expect(action.label).toBeTruthy();
      const expected = EXPECTED_SHORTCUTS[action.id];
      if (expected === undefined) {
        expect(action.shortcut).toBeUndefined();
      } else {
        expect(action.shortcut).toEqual(expected);
      }
    }
  });

  // ---------- perform calls correct KeyboardActions methods ----------
  const PERFORM_TABLE: [string, string, unknown[]][] = [
    ['edit.delete', 'deleteSelected', []],
    ['select.none', 'deselect', []],
    ['edit.undo', 'undo', []],
    ['edit.redo', 'redo', []],
    ['select.all', 'selectAll', []],
    ['select.cycle', 'cycleSelection', [1]],
    ['select.cycle-reverse', 'cycleSelection', [-1]],
    ['edit.copy', 'copy', []],
    ['edit.paste', 'paste', []],
    ['edit.duplicate', 'duplicate', []],
    ['arrange.bring-forward', 'zOrder', ['forward']],
    ['arrange.send-backward', 'zOrder', ['backward']],
    ['arrange.bring-to-front', 'zOrder', ['front']],
    ['arrange.send-to-back', 'zOrder', ['back']],
    ['view.zoom-to-fit', 'zoomToFit', []],
    ['arrange.group', 'group', []],
    ['arrange.ungroup', 'ungroup', []],
    ['edit.cut', 'cut', []],
    ['arrange.toggle-lock', 'toggleLock', []],
    ['arrange.rotate-cw', 'rotate', ['cw']],
    ['arrange.rotate-ccw', 'rotate', ['ccw']],
  ];

  it.each(PERFORM_TABLE)('%s calls keyboardActions.%s with %j', (id, method, args) => {
    const spies = makeSpyKeyboardActions();
    const deps = makeDeps({
      keyboardActions: spies as unknown as KeyboardActions,
    });
    const actions = createBuiltinActions(deps);
    const action = findAction(actions, id);
    const ctx = makeCtx();
    action.perform(ctx, defaultInvocation);
    expect(spies[method]).toHaveBeenCalledWith(...args);
  });

  it('view.zoom-in/out/reset call zoomByFactor/zoomToLevel with the base constants', () => {
    const zoomByFactor = vi.fn();
    const zoomToLevel = vi.fn();
    const deps = makeDeps({ zoomByFactor, zoomToLevel });
    const actions = createBuiltinActions(deps);
    const ctx = makeCtx();

    // ZOOM_STEP = 1.2 from keyboard-handler.ts
    findAction(actions, 'view.zoom-in').perform(ctx, defaultInvocation);
    expect(zoomByFactor).toHaveBeenCalledWith(1.2);

    findAction(actions, 'view.zoom-out').perform(ctx, defaultInvocation);
    expect(zoomByFactor).toHaveBeenCalledWith(1 / 1.2);

    findAction(actions, 'view.zoom-reset').perform(ctx, defaultInvocation);
    expect(zoomToLevel).toHaveBeenCalledWith(1);
  });

  it('select.none has preventDefault false; all others leave it undefined', () => {
    const deps = makeDeps();
    const actions = createBuiltinActions(deps);
    for (const action of actions) {
      if (action.id === 'select.none') {
        expect(action.preventDefault).toBe(false);
      } else {
        expect(action.preventDefault).toBeUndefined();
      }
    }
  });

  it('nudge actions have allowShift true, forward invocation.shiftKey, and return nudge() boolean', () => {
    const NUDGE_DELTAS: Record<string, readonly [number, number]> = {
      'arrange.nudge-left': [-1, 0],
      'arrange.nudge-right': [1, 0],
      'arrange.nudge-up': [0, -1],
      'arrange.nudge-down': [0, 1],
    };

    const spies = makeSpyKeyboardActions();
    spies.nudge.mockReturnValue(true);
    const deps = makeDeps({ keyboardActions: spies as unknown as KeyboardActions });
    const actions = createBuiltinActions(deps);
    const ctx = makeCtx();

    for (const [id, [dx, dy]] of Object.entries(NUDGE_DELTAS)) {
      const action = findAction(actions, id);
      expect(action.allowShift).toBe(true);

      // With shiftKey = true
      spies.nudge.mockClear();
      const result = action.perform(ctx, { source: 'keyboard', shiftKey: true });
      expect(spies.nudge).toHaveBeenCalledWith(dx, dy, true);
      expect(result).toBe(true);

      // With shiftKey = false
      spies.nudge.mockReturnValue(false);
      spies.nudge.mockClear();
      const result2 = action.perform(ctx, { source: 'keyboard', shiftKey: false });
      expect(spies.nudge).toHaveBeenCalledWith(dx, dy, false);
      expect(result2).toBe(false);

      spies.nudge.mockReturnValue(true);
    }
  });

  it('menu placement matches the spec section 6 table', () => {
    const deps = makeDeps();
    const actions = createBuiltinActions(deps);

    const EXPECTED_MENU: Record<string, { group: string; order: number }> = {
      'edit.cut': { group: 'clipboard', order: 10 },
      'edit.copy': { group: 'clipboard', order: 20 },
      'edit.paste': { group: 'clipboard', order: 30 },
      'edit.duplicate': { group: 'clipboard', order: 40 },
      'edit.delete': { group: 'clipboard', order: 50 },
      'arrange.bring-to-front': { group: 'arrange', order: 10 },
      'arrange.bring-forward': { group: 'arrange', order: 20 },
      'arrange.send-backward': { group: 'arrange', order: 30 },
      'arrange.send-to-back': { group: 'arrange', order: 40 },
      'arrange.rotate-cw': { group: 'transform', order: 10 },
      'arrange.rotate-ccw': { group: 'transform', order: 20 },
      'arrange.toggle-lock': { group: 'lock', order: 10 },
    };

    for (const action of actions) {
      const expected = EXPECTED_MENU[action.id];
      if (expected) {
        expect(action.menu).toEqual(expected);
      } else {
        expect(action.menu).toBeUndefined();
      }
    }

    // Verify exactly 12 menu actions
    const menuActions = actions.filter((a) => a.menu !== undefined);
    expect(menuActions).toHaveLength(12);
  });

  it('enabled: selection actions need selectedIds, edit.paste needs canPaste, undo/redo/view always', () => {
    const canPaste = vi.fn().mockReturnValue(false);
    const deps = makeDeps({ canPaste });
    const actions = createBuiltinActions(deps);

    const selectionRequired = [
      'edit.cut',
      'edit.copy',
      'edit.duplicate',
      'edit.delete',
      'select.none',
      'arrange.bring-to-front',
      'arrange.bring-forward',
      'arrange.send-backward',
      'arrange.send-to-back',
      'arrange.group',
      'arrange.ungroup',
      'arrange.toggle-lock',
      'arrange.rotate-cw',
      'arrange.rotate-ccw',
      'arrange.nudge-left',
      'arrange.nudge-right',
      'arrange.nudge-up',
      'arrange.nudge-down',
    ];

    const alwaysEnabled = [
      'edit.undo',
      'edit.redo',
      'select.all',
      'select.cycle',
      'select.cycle-reverse',
      'view.zoom-in',
      'view.zoom-out',
      'view.zoom-reset',
      'view.zoom-to-fit',
    ];

    const ctxWithSelection = makeCtx({ selectedIds: ['el-1'] });
    const ctxWithoutSelection = makeCtx({ selectedIds: [] });

    // Selection-required actions: enabled with selection, disabled without
    for (const id of selectionRequired) {
      const action = findAction(actions, id);
      const { enabled } = action;
      expect(enabled).toBeDefined();
      if (enabled) {
        expect(enabled(ctxWithSelection)).toBe(true);
        expect(enabled(ctxWithoutSelection)).toBe(false);
      }
    }

    // Always-enabled actions: no enabled predicate or always true
    for (const id of alwaysEnabled) {
      const action = findAction(actions, id);
      if (action.enabled) {
        expect(action.enabled(ctxWithSelection)).toBe(true);
        expect(action.enabled(ctxWithoutSelection)).toBe(true);
      }
      // else: undefined means always enabled, which is correct
    }

    // edit.paste requires canPaste
    const pasteAction = findAction(actions, 'edit.paste');
    const pasteEnabled = pasteAction.enabled;
    expect(pasteEnabled).toBeDefined();
    if (pasteEnabled) {
      canPaste.mockReturnValue(false);
      expect(pasteEnabled(ctxWithSelection)).toBe(false);
      canPaste.mockReturnValue(true);
      expect(pasteEnabled(ctxWithSelection)).toBe(true);
    }
  });

  it('arrange.toggle-lock label is Unlock when every selected element is locked, else Lock', () => {
    const deps = makeDeps();
    const actions = createBuiltinActions(deps);
    const action = findAction(actions, 'arrange.toggle-lock');

    // All locked -> Unlock
    const getById = vi
      .fn()
      .mockReturnValueOnce({ locked: true })
      .mockReturnValueOnce({ locked: true });
    const ctx = makeCtx({
      store: { getById } as unknown as ElementStore,
      selectedIds: ['a', 'b'],
    });
    expect(typeof action.label).toBe('function');
    expect((action.label as (ctx: ActionContext) => string)(ctx)).toBe('Unlock');

    // Not all locked -> Lock
    const getById2 = vi
      .fn()
      .mockReturnValueOnce({ locked: true })
      .mockReturnValueOnce({ locked: false });
    const ctx2 = makeCtx({
      store: { getById: getById2 } as unknown as ElementStore,
      selectedIds: ['a', 'b'],
    });
    expect((action.label as (ctx: ActionContext) => string)(ctx2)).toBe('Lock');

    // No selection -> Lock
    const ctx3 = makeCtx({ selectedIds: [] });
    expect((action.label as (ctx: ActionContext) => string)(ctx3)).toBe('Lock');
  });
});

describe('createToolAction', () => {
  it('produces id tool.<name>, label <Name> tool, keywords [name], shortcut from DEFAULT_TOOL_SHORTCUTS for known tools, undefined otherwise', () => {
    const switchTool = vi.fn();
    const toolDeps: ToolActionDeps = {
      switchTool,
      isToolActive: vi.fn().mockReturnValue(false),
      hasTool: vi.fn().mockReturnValue(true),
    };

    // Known tool
    const pencilAction = createToolAction('pencil', toolDeps);
    expect(pencilAction.id).toBe('tool.pencil');
    expect(pencilAction.label).toBe('Pencil tool');
    expect(pencilAction.keywords).toEqual(['pencil']);
    expect(pencilAction.shortcut).toEqual(['p']);

    // Unknown tool
    const customAction = createToolAction('laser', toolDeps);
    expect(customAction.id).toBe('tool.laser');
    expect(customAction.label).toBe('Laser tool');
    expect(customAction.keywords).toEqual(['laser']);
    expect(customAction.shortcut).toBeUndefined();
  });

  it('enabled = hasTool && !isToolActive, perform calls switchTool(name)', () => {
    const switchTool = vi.fn();
    const hasTool = vi.fn().mockReturnValue(true);
    const isToolActive = vi.fn().mockReturnValue(false);
    const toolDeps: ToolActionDeps = { switchTool, hasTool, isToolActive };

    const action = createToolAction('pencil', toolDeps);
    const ctx = makeCtx();

    const { enabled } = action;
    expect(enabled).toBeDefined();
    if (!enabled) return;

    // enabled: hasTool true, isToolActive false -> true
    expect(enabled(ctx)).toBe(true);

    // enabled: isToolActive true -> false
    isToolActive.mockReturnValue(true);
    expect(enabled(ctx)).toBe(false);

    // enabled: hasTool false -> false
    isToolActive.mockReturnValue(false);
    hasTool.mockReturnValue(false);
    expect(enabled(ctx)).toBe(false);

    // perform calls switchTool
    hasTool.mockReturnValue(true);
    action.perform(ctx, defaultInvocation);
    expect(switchTool).toHaveBeenCalledWith('pencil');
  });

  it('DEFAULT_TOOL_SHORTCUTS has exactly the eight known tools', () => {
    expect(DEFAULT_TOOL_SHORTCUTS).toEqual({
      select: ['v'],
      hand: ['h'],
      pencil: ['p'],
      eraser: ['e'],
      arrow: ['a'],
      note: ['n'],
      text: ['t'],
      shape: ['s'],
    });
  });
});

describe('BUILTIN_MENU_GROUPS', () => {
  it('contains the four built-in groups in order', () => {
    expect(BUILTIN_MENU_GROUPS).toEqual(['clipboard', 'arrange', 'transform', 'lock']);
  });
});
