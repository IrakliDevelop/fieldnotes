export type ShortcutBindings = Record<string, string | string[] | null>;

export interface ShortcutOptions {
  scope?: 'focus' | 'window';
  bindings?: ShortcutBindings;
}

export interface ShortcutsApi {
  rebind(action: string, bindings: string | string[] | null): void;
  disable(action: string): void;
  reset(action?: string): void;
  getBindings(): Record<string, string[]>;
}

interface ParsedBinding {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
  digit: boolean;
}

const DEFAULT_BINDINGS: readonly (readonly [string, readonly string[]])[] = [
  ['delete', ['delete', 'backspace']],
  ['deselect', ['escape']],
  ['undo', ['mod+z']],
  ['redo', ['mod+y', 'mod+shift+z']],
  ['select-all', ['mod+a']],
  ['copy', ['mod+c']],
  ['paste', ['mod+v']],
  ['duplicate', ['mod+d']],
  ['z-forward', [']']],
  ['z-backward', ['[']],
  ['z-front', ['mod+]']],
  ['z-back', ['mod+[']],
  ['zoom-fit', ['shift+1']],
  ['nudge-left', ['arrowleft']],
  ['nudge-right', ['arrowright']],
  ['nudge-up', ['arrowup']],
  ['nudge-down', ['arrowdown']],
  ['tool:select', ['v']],
  ['tool:hand', ['h']],
  ['tool:pencil', ['p']],
  ['tool:eraser', ['e']],
  ['tool:arrow', ['a']],
  ['tool:note', ['n']],
  ['tool:text', ['t']],
  ['tool:shape', ['s']],
  ['tool:measure', ['m']],
  ['tool:template', ['g']],
];

const ALLOW_SHIFT = new Set(['nudge-left', 'nudge-right', 'nudge-up', 'nudge-down']);
const MODIFIERS = new Set(['mod', 'ctrl', 'meta', 'shift', 'alt']);

function parseBinding(binding: string): ParsedBinding {
  const parts = binding.toLowerCase().split('+');
  const key = parts.pop();
  if (key === undefined || key.length === 0 || MODIFIERS.has(key)) {
    throw new Error(`Invalid shortcut binding "${binding}": missing key`);
  }
  const normalizedKey = key === 'space' ? ' ' : key;
  const parsed: ParsedBinding = {
    mod: false,
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
    key: normalizedKey,
    digit: /^[0-9]$/.test(normalizedKey),
  };
  for (const part of parts) {
    switch (part) {
      case 'mod':
        parsed.mod = true;
        break;
      case 'ctrl':
        parsed.ctrl = true;
        break;
      case 'meta':
        parsed.meta = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      case 'alt':
        parsed.alt = true;
        break;
      default:
        throw new Error(`Invalid shortcut binding "${binding}": unknown modifier "${part}"`);
    }
  }
  if (parsed.mod && (parsed.ctrl || parsed.meta)) {
    throw new Error(
      `Invalid shortcut binding "${binding}": "mod" already means Ctrl or Cmd; don't combine it with ctrl/meta`,
    );
  }
  return parsed;
}

function bindingMatches(p: ParsedBinding, e: KeyboardEvent, allowShift: boolean): boolean {
  if (p.mod) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else if (e.ctrlKey !== p.ctrl || e.metaKey !== p.meta) {
    return false;
  }
  if (!allowShift && e.shiftKey !== p.shift) return false;
  if (e.altKey !== p.alt) return false;
  return p.digit ? e.code === `Digit${p.key}` : e.key.toLowerCase() === p.key;
}

function toArray(bindings: string | string[] | null): string[] {
  if (bindings === null) return [];
  return Array.isArray(bindings) ? [...bindings] : [bindings];
}

export class ShortcutMap implements ShortcutsApi {
  private raw = new Map<string, string[]>();
  private parsed = new Map<string, ParsedBinding[]>();

  constructor(overrides?: ShortcutBindings) {
    this.applyDefaults();
    if (overrides) {
      for (const [action, bindings] of Object.entries(overrides)) {
        this.rebind(action, bindings);
      }
    }
  }

  /** First matching action in registration order wins when bindings conflict. */
  match(e: KeyboardEvent): string | null {
    for (const [action, parsedList] of this.parsed) {
      const allowShift = ALLOW_SHIFT.has(action);
      for (const p of parsedList) {
        if (bindingMatches(p, e, allowShift)) return action;
      }
    }
    return null;
  }

  rebind(action: string, bindings: string | string[] | null): void {
    const list = toArray(bindings);
    const parsedList = list.map(parseBinding);
    this.raw.set(action, list);
    this.parsed.set(action, parsedList);
  }

  disable(action: string): void {
    this.rebind(action, null);
  }

  reset(action?: string): void {
    if (action === undefined) {
      this.raw.clear();
      this.parsed.clear();
      this.applyDefaults();
      return;
    }
    const def = DEFAULT_BINDINGS.find(([name]) => name === action);
    if (def) {
      this.rebind(action, [...def[1]]);
    } else if (this.raw.has(action)) {
      this.raw.delete(action);
      this.parsed.delete(action);
    }
  }

  getBindings(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [action, list] of this.raw) {
      out[action] = [...list];
    }
    return out;
  }

  private applyDefaults(): void {
    for (const [action, bindings] of DEFAULT_BINDINGS) {
      this.rebind(action, [...bindings]);
    }
  }
}
