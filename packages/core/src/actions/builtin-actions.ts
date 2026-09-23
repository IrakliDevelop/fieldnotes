import type { KeyboardActions } from '../canvas/keyboard-actions';
import type { ActionContext, ActionDefinition, ActionMenuPlacement } from './types';

/**
 * Dependencies required by the built-in action table.  The viewport wires
 * these when constructing the registry (Task 4).
 */
export interface BuiltinActionDeps {
  keyboardActions: KeyboardActions;
  zoomByFactor: (factor: number) => void;
  zoomToLevel: (level: number) => void;
  canPaste: () => boolean;
}

/** Context-menu groups emitted by the built-in table, in display order. */
export const BUILTIN_MENU_GROUPS = ['clipboard', 'arrange', 'transform', 'lock'] as const;

/** Default shortcut bindings for the eight built-in tool names. */
export const DEFAULT_TOOL_SHORTCUTS: Readonly<Record<string, readonly string[]>> = {
  select: ['v'],
  hand: ['h'],
  pencil: ['p'],
  eraser: ['e'],
  arrow: ['a'],
  note: ['n'],
  text: ['t'],
  shape: ['s'],
};

// ---------------------------------------------------------------------------
// Internal constants mirroring keyboard-handler.ts at base commit 19d9f9f
// ---------------------------------------------------------------------------

/** Zoom step used by the base keyboard handler. */
const ZOOM_STEP = 1.2;

/** Nudge deltas per canonical id, mirroring the base handler's NUDGE_DELTAS. */
export const NUDGE_DELTAS: Readonly<Record<string, readonly [number, number]>> = {
  'arrange.nudge-left': [-1, 0],
  'arrange.nudge-right': [1, 0],
  'arrange.nudge-up': [0, -1],
  'arrange.nudge-down': [0, 1],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasSelection(ctx: ActionContext): boolean {
  return ctx.selectedIds.length > 0;
}

function menu(group: string, order: number): ActionMenuPlacement {
  return { group, order };
}

// ---------------------------------------------------------------------------
// Built-in action table
// ---------------------------------------------------------------------------

/**
 * Produce the 28 non-tool action definitions that replace the
 * `KeyboardHandler.runAction` switch.  Order follows `DEFAULT_BINDINGS` in
 * `shortcut-map.ts`, with `edit.paste` inserted directly after `edit.copy`.
 */
export function createBuiltinActions(deps: BuiltinActionDeps): ActionDefinition[] {
  const ka = deps.keyboardActions;

  return [
    // --- edit.delete (was 'delete') ---
    {
      id: 'edit.delete',
      label: 'Delete',
      keywords: ['remove', 'trash'],
      icon: 'delete',
      shortcut: ['delete', 'backspace'],
      menu: menu('clipboard', 50),
      enabled: hasSelection,
      perform: () => ka.deleteSelected(),
    },
    // --- select.none (was 'deselect') ---
    {
      id: 'select.none',
      label: 'Deselect',
      keywords: ['deselect', 'clear selection'],
      icon: 'none',
      shortcut: ['escape'],
      preventDefault: false,
      enabled: hasSelection,
      perform: () => ka.deselect(),
    },
    // --- edit.undo ---
    {
      id: 'edit.undo',
      label: 'Undo',
      keywords: ['revert', 'back'],
      icon: 'undo',
      shortcut: ['mod+z'],
      perform: () => ka.undo(),
    },
    // --- edit.redo ---
    {
      id: 'edit.redo',
      label: 'Redo',
      keywords: ['repeat', 'forward'],
      icon: 'redo',
      shortcut: ['mod+y', 'mod+shift+z'],
      perform: () => ka.redo(),
    },
    // --- select.all ---
    {
      id: 'select.all',
      label: 'Select all',
      keywords: ['all', 'everything'],
      icon: 'all',
      shortcut: ['mod+a'],
      perform: () => ka.selectAll(),
    },
    // --- select.cycle ---
    {
      id: 'select.cycle',
      label: 'Next selection',
      keywords: ['next', 'cycle'],
      icon: 'cycle',
      shortcut: ['tab'],
      perform: () => ka.cycleSelection(1),
    },
    // --- select.cycle-reverse ---
    {
      id: 'select.cycle-reverse',
      label: 'Previous selection',
      keywords: ['previous', 'cycle back'],
      icon: 'cycle-reverse',
      shortcut: ['shift+tab'],
      perform: () => ka.cycleSelection(-1),
    },
    // --- edit.copy ---
    {
      id: 'edit.copy',
      label: 'Copy',
      keywords: ['clipboard', 'copy'],
      icon: 'copy',
      shortcut: ['mod+c'],
      menu: menu('clipboard', 20),
      enabled: hasSelection,
      perform: () => ka.copy(),
    },
    // --- edit.paste (inserted after copy; no default shortcut) ---
    {
      id: 'edit.paste',
      label: 'Paste',
      keywords: ['clipboard', 'insert'],
      icon: 'paste',
      menu: menu('clipboard', 30),
      enabled: () => deps.canPaste(),
      perform: () => ka.paste(),
    },
    // --- edit.duplicate ---
    {
      id: 'edit.duplicate',
      label: 'Duplicate',
      keywords: ['clone', 'copy in place'],
      icon: 'duplicate',
      shortcut: ['mod+d'],
      menu: menu('clipboard', 40),
      enabled: hasSelection,
      perform: () => ka.duplicate(),
    },
    // --- arrange.bring-forward (was 'z-forward') ---
    {
      id: 'arrange.bring-forward',
      label: 'Bring Forward',
      keywords: ['forward', 'layer up'],
      icon: 'bring-forward',
      shortcut: [']'],
      menu: menu('arrange', 20),
      enabled: hasSelection,
      perform: () => ka.zOrder('forward'),
    },
    // --- arrange.send-backward (was 'z-backward') ---
    {
      id: 'arrange.send-backward',
      label: 'Send Backward',
      keywords: ['backward', 'layer down'],
      icon: 'send-backward',
      shortcut: ['['],
      menu: menu('arrange', 30),
      enabled: hasSelection,
      perform: () => ka.zOrder('backward'),
    },
    // --- arrange.bring-to-front (was 'z-front') ---
    {
      id: 'arrange.bring-to-front',
      label: 'Bring to Front',
      keywords: ['front', 'top'],
      icon: 'bring-to-front',
      shortcut: ['mod+]'],
      menu: menu('arrange', 10),
      enabled: hasSelection,
      perform: () => ka.zOrder('front'),
    },
    // --- arrange.send-to-back (was 'z-back') ---
    {
      id: 'arrange.send-to-back',
      label: 'Send to Back',
      keywords: ['back', 'bottom'],
      icon: 'send-to-back',
      shortcut: ['mod+['],
      menu: menu('arrange', 40),
      enabled: hasSelection,
      perform: () => ka.zOrder('back'),
    },
    // --- view.zoom-to-fit (was 'zoom-fit') ---
    {
      id: 'view.zoom-to-fit',
      label: 'Zoom to fit',
      keywords: ['fit', 'frame all'],
      icon: 'zoom-to-fit',
      shortcut: ['shift+1'],
      perform: () => ka.zoomToFit(),
    },
    // --- view.zoom-in ---
    {
      id: 'view.zoom-in',
      label: 'Zoom in',
      keywords: ['magnify', 'enlarge'],
      icon: 'zoom-in',
      shortcut: ['mod+='],
      perform: () => deps.zoomByFactor(ZOOM_STEP),
    },
    // --- view.zoom-out ---
    {
      id: 'view.zoom-out',
      label: 'Zoom out',
      keywords: ['shrink', 'reduce'],
      icon: 'zoom-out',
      shortcut: ['mod+-'],
      perform: () => deps.zoomByFactor(1 / ZOOM_STEP),
    },
    // --- view.zoom-reset ---
    {
      id: 'view.zoom-reset',
      label: 'Reset zoom',
      keywords: ['100%', 'actual size'],
      icon: 'zoom-reset',
      shortcut: ['mod+0'],
      perform: () => deps.zoomToLevel(1),
    },
    // --- arrange.group ---
    {
      id: 'arrange.group',
      label: 'Group',
      keywords: ['combine', 'merge'],
      icon: 'group',
      shortcut: ['mod+g'],
      enabled: hasSelection,
      perform: () => ka.group(),
    },
    // --- arrange.ungroup ---
    {
      id: 'arrange.ungroup',
      label: 'Ungroup',
      keywords: ['split', 'separate'],
      icon: 'ungroup',
      shortcut: ['mod+shift+g'],
      enabled: hasSelection,
      perform: () => ka.ungroup(),
    },
    // --- edit.cut ---
    {
      id: 'edit.cut',
      label: 'Cut',
      keywords: ['move', 'clip'],
      icon: 'cut',
      shortcut: ['mod+x'],
      menu: menu('clipboard', 10),
      enabled: hasSelection,
      perform: () => ka.cut(),
    },
    // --- arrange.toggle-lock ---
    {
      id: 'arrange.toggle-lock',
      label: (ctx: ActionContext): string => {
        if (ctx.selectedIds.length === 0) return 'Lock';
        const allLocked = ctx.selectedIds.every((id) => ctx.store.getById(id)?.locked === true);
        return allLocked ? 'Unlock' : 'Lock';
      },
      keywords: ['lock', 'freeze'],
      icon: 'toggle-lock',
      shortcut: ['mod+shift+l'],
      menu: menu('lock', 10),
      enabled: hasSelection,
      perform: () => ka.toggleLock(),
    },
    // --- arrange.rotate-cw ---
    {
      id: 'arrange.rotate-cw',
      label: 'Rotate 90° CW',
      keywords: ['rotate', 'clockwise'],
      icon: 'rotate-cw',
      shortcut: ['r'],
      menu: menu('transform', 10),
      enabled: hasSelection,
      perform: () => ka.rotate('cw'),
    },
    // --- arrange.rotate-ccw ---
    {
      id: 'arrange.rotate-ccw',
      label: 'Rotate 90° CCW',
      keywords: ['rotate', 'counter-clockwise'],
      icon: 'rotate-ccw',
      shortcut: ['shift+r'],
      menu: menu('transform', 20),
      enabled: hasSelection,
      perform: () => ka.rotate('ccw'),
    },
    // --- arrange.nudge-left ---
    {
      id: 'arrange.nudge-left',
      label: 'Nudge left',
      keywords: ['move', 'left'],
      icon: 'nudge-left',
      shortcut: ['arrowleft'],
      allowShift: true,
      enabled: hasSelection,
      perform: (_ctx, inv) => ka.nudge(-1, 0, inv.shiftKey),
    },
    // --- arrange.nudge-right ---
    {
      id: 'arrange.nudge-right',
      label: 'Nudge right',
      keywords: ['move', 'right'],
      icon: 'nudge-right',
      shortcut: ['arrowright'],
      allowShift: true,
      enabled: hasSelection,
      perform: (_ctx, inv) => ka.nudge(1, 0, inv.shiftKey),
    },
    // --- arrange.nudge-up ---
    {
      id: 'arrange.nudge-up',
      label: 'Nudge up',
      keywords: ['move', 'up'],
      icon: 'nudge-up',
      shortcut: ['arrowup'],
      allowShift: true,
      enabled: hasSelection,
      perform: (_ctx, inv) => ka.nudge(0, -1, inv.shiftKey),
    },
    // --- arrange.nudge-down ---
    {
      id: 'arrange.nudge-down',
      label: 'Nudge down',
      keywords: ['move', 'down'],
      icon: 'nudge-down',
      shortcut: ['arrowdown'],
      allowShift: true,
      enabled: hasSelection,
      perform: (_ctx, inv) => ka.nudge(0, 1, inv.shiftKey),
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool actions
// ---------------------------------------------------------------------------

/** Dependencies for creating a tool action. */
export interface ToolActionDeps {
  switchTool: (name: string) => void;
  isToolActive: () => boolean;
  hasTool: (name: string) => boolean;
}

/**
 * Create an action definition for a single tool.  The shortcut is looked up
 * from {@link DEFAULT_TOOL_SHORTCUTS}; tools not in the table get no default.
 */
export function createToolAction(name: string, deps: ToolActionDeps): ActionDefinition {
  const shortcut = DEFAULT_TOOL_SHORTCUTS[name];
  return {
    id: `tool.${name}`,
    label: `${name.charAt(0).toUpperCase()}${name.slice(1)} tool`,
    keywords: [name],
    icon: name,
    shortcut,
    enabled: () => deps.hasTool(name) && !deps.isToolActive(),
    perform: () => deps.switchTool(name),
  };
}
