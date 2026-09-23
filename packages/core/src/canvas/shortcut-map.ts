import { resolveActionId } from '../actions/legacy-action-ids';

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

function sameBinding(a: ParsedBinding, b: ParsedBinding): boolean {
  return (
    a.key === b.key &&
    a.mod === b.mod &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt
  );
}

function toArray(bindings: string | string[] | null): string[] {
  if (bindings === null) return [];
  return Array.isArray(bindings) ? [...bindings] : [bindings];
}

export class ShortcutMap implements ShortcutsApi {
  private raw = new Map<string, string[]>();
  private parsed = new Map<string, ParsedBinding[]>();
  private defaults = new Map<string, { bindings: readonly string[]; allowShift: boolean }>();
  private userOverridden = new Set<string>();
  private allowShiftSet = new Set<string>();

  constructor(overrides?: ShortcutBindings) {
    if (overrides) {
      for (const [action, bindings] of Object.entries(overrides)) {
        this.rebind(action, bindings);
      }
    }
  }

  /** First matching action in registration order wins when bindings conflict. */
  match(e: KeyboardEvent): string | null {
    for (const [action, parsedList] of this.parsed) {
      const allowShift = this.allowShiftSet.has(action);
      for (const p of parsedList) {
        if (bindingMatches(p, e, allowShift)) return action;
      }
    }
    return null;
  }

  /** Record a default binding from the action registry. */
  setDefault(action: string, bindings: readonly string[], allowShift: boolean): void {
    this.defaults.set(action, { bindings, allowShift });
    if (allowShift) {
      this.allowShiftSet.add(action);
    } else {
      this.allowShiftSet.delete(action);
    }
    if (!this.userOverridden.has(action)) {
      this.apply(action, [...bindings]);
    }
  }

  /** Remove a default binding when an action is unregistered. */
  clearDefault(action: string): void {
    this.defaults.delete(action);
    this.allowShiftSet.delete(action);
    if (!this.userOverridden.has(action)) {
      this.raw.delete(action);
      this.parsed.delete(action);
    }
  }

  rebind(action: string, bindings: string | string[] | null): void {
    const canonical = resolveActionId(action);
    this.userOverridden.add(canonical);
    this.apply(canonical, toArray(bindings));
  }

  disable(action: string): void {
    this.rebind(action, null);
  }

  reset(action?: string): void {
    if (action === undefined) {
      this.raw.clear();
      this.parsed.clear();
      this.userOverridden.clear();
      this.allowShiftSet.clear();
      for (const [id, def] of this.defaults) {
        if (def.allowShift) this.allowShiftSet.add(id);
        this.apply(id, [...def.bindings]);
      }
      return;
    }
    const canonical = resolveActionId(action);
    this.userOverridden.delete(canonical);
    const def = this.defaults.get(canonical);
    if (def) {
      if (def.allowShift) {
        this.allowShiftSet.add(canonical);
      } else {
        this.allowShiftSet.delete(canonical);
      }
      this.apply(canonical, [...def.bindings]);
    } else if (this.raw.has(canonical)) {
      this.raw.delete(canonical);
      this.parsed.delete(canonical);
    }
  }

  getBindings(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [action, list] of this.raw) {
      out[action] = [...list];
    }
    return out;
  }

  /**
   * Internal apply: sets the binding in raw/parsed maps and warns on
   * conflicts. Does NOT mark as user-overridden.
   */
  private apply(action: string, list: string[]): void {
    const parsedList = list.map(parseBinding);
    for (const p of parsedList) {
      for (const [otherAction, otherList] of this.parsed) {
        if (otherAction === action) continue;
        if (otherList.some((q) => sameBinding(p, q))) {
          console.warn(
            `[fieldnotes] shortcut binding for "${action}" conflicts with "${otherAction}"; first registered wins`,
          );
        }
      }
    }
    this.raw.set(action, list);
    this.parsed.set(action, parsedList);
  }
}
