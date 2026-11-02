import type { ActionDefinition } from '../actions/types';
import type { Bounds } from '../core/types';
import { foldText } from '../elements/scene-search';
import type { CameraView } from './camera-view';

/** The strings used by the command palette and shortcuts help. */
export interface PaletteStrings {
  readonly placeholder: string;
  readonly noResults: string;
  readonly actions: string;
  readonly board: string;
  readonly helpTitle: string;
  readonly close: string;
  readonly groups: Readonly<Record<string, string>>;
  readonly types: Readonly<Record<string, string>>;
}

/** Options for the command palette. */
export interface PaletteOptions {
  readonly strings?: Partial<PaletteStrings>;
}

/** Default strings used by the command palette and shortcuts help. */
export const DEFAULT_PALETTE_STRINGS: PaletteStrings = {
  placeholder: 'Search actions and the board',
  noResults: 'No matches. Try a shorter search.',
  actions: 'Actions',
  board: 'On the board',
  helpTitle: 'Keyboard shortcuts',
  close: 'Close the palette',
  groups: {
    edit: 'Edit',
    select: 'Select',
    arrange: 'Arrange',
    view: 'View',
    tool: 'Tools',
    palette: 'Palette',
    presentation: 'While presenting',
  },
  types: {
    note: 'Note',
    text: 'Text',
    arrow: 'Arrow',
    'core:frame': 'Frame',
  },
};

interface HelpFixedRow {
  readonly group: string;
  readonly label: string;
  readonly keys: readonly string[];
}

/** Fixed shortcut rows that do not correspond to registered actions. */
export const FIXED_HELP_ROWS: readonly HelpFixedRow[] = [
  { group: 'edit', label: 'Paste', keys: ['mod+v'] },
  { group: 'palette', label: 'Move through results', keys: ['arrowup', 'arrowdown'] },
  { group: 'palette', label: 'Run the action or go to the element', keys: ['enter'] },
  { group: 'palette', label: 'Close the palette', keys: ['escape'] },
  {
    group: 'presentation',
    label: 'Next slide',
    keys: ['arrowright', 'arrowdown', 'pagedown', 'space'],
  },
  {
    group: 'presentation',
    label: 'Previous slide',
    keys: ['arrowleft', 'arrowup', 'pageup', 'shift+space'],
  },
  { group: 'presentation', label: 'First slide', keys: ['home'] },
  { group: 'presentation', label: 'Last slide', keys: ['end'] },
  { group: 'presentation', label: 'End the presentation', keys: ['escape'] },
];

/** Merges palette string overrides with the defaults. */
export function resolvePaletteStrings(
  overrides: Partial<PaletteStrings> | undefined,
): PaletteStrings {
  return {
    ...DEFAULT_PALETTE_STRINGS,
    ...overrides,
    groups: { ...DEFAULT_PALETTE_STRINGS.groups, ...overrides?.groups },
    types: { ...DEFAULT_PALETTE_STRINGS.types, ...overrides?.types },
  };
}

/** A command palette row for a registered action. */
export interface PaletteActionRow {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly keys: readonly string[];
}

/** Searches enabled actions using palette ranking rules. */
export function searchActions(
  definitions: readonly ActionDefinition[],
  query: string,
  deps: {
    isEnabled(id: string): boolean;
    label(def: ActionDefinition): string;
    bindings: Readonly<Record<string, readonly string[]>>;
  },
): PaletteActionRow[] {
  const foldedQuery = foldText(query).trim();
  const matches: { row: PaletteActionRow; score: number; index: number }[] = [];

  for (const [index, definition] of definitions.entries()) {
    if (!deps.isEnabled(definition.id) || definition.id === 'palette.open') continue;

    const label = deps.label(definition);
    const row = {
      kind: 'action' as const,
      id: definition.id,
      label,
      keys: deps.bindings[definition.id] ?? [],
    };
    if (!foldedQuery) {
      matches.push({ row, score: 0, index });
      continue;
    }

    const foldedLabel = foldText(label);
    let score = -1;
    if (foldedLabel.startsWith(foldedQuery)) score = 0;
    else if (foldedLabel.split(/\s+/u).some((word) => word.startsWith(foldedQuery))) score = 1;
    else if (foldedLabel.includes(foldedQuery)) score = 2;
    else {
      const dot = definition.id.indexOf('.');
      const idTail = definition.id.slice(dot === -1 ? 0 : dot + 1);
      if (
        definition.keywords?.some((keyword) => foldText(keyword).includes(foldedQuery)) ||
        foldText(idTail).includes(foldedQuery)
      ) {
        score = 3;
      }
    }
    if (score !== -1) matches.push({ row, score, index });
  }

  if (foldedQuery) matches.sort((a, b) => a.score - b.score || a.index - b.index);
  return matches.map(({ row }) => row);
}

/** Formats a shortcut-map binding for display. */
export function formatBinding(binding: string, mac: boolean): string {
  const modifiers = new Set(binding.split('+'));
  const labels: string[] = [];
  const modifierLabels: readonly (readonly [string, string])[] = mac
    ? [
        ['ctrl', '⌃'],
        ['alt', '⌥'],
        ['shift', '⇧'],
        ['mod', '⌘'],
        ['meta', '⌘'],
      ]
    : [
        ['ctrl', 'Ctrl'],
        ['mod', 'Ctrl'],
        ['alt', 'Alt'],
        ['shift', 'Shift'],
        ['meta', 'Win'],
      ];
  for (const [modifier, label] of modifierLabels) {
    if (modifiers.delete(modifier)) labels.push(label);
  }
  const key = [...modifiers][0] ?? '';
  const names: Record<string, string> = {
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    ' ': 'Space',
    space: 'Space',
    escape: 'Esc',
    delete: 'Del',
    backspace: mac ? '⌫' : 'Backspace',
    enter: 'Enter',
    tab: 'Tab',
    home: 'Home',
    end: 'End',
    pageup: 'PgUp',
    pagedown: 'PgDn',
  };
  const keyLabel =
    names[key] ?? (key.length === 1 ? key.toUpperCase() : key[0]?.toUpperCase() + key.slice(1));
  return [...labels, keyLabel].filter(Boolean).join(mac ? '' : '+');
}

/** A section in the shortcuts help dialog. */
export interface HelpSection {
  readonly title: string;
  readonly rows: readonly { label: string; keys: readonly string[] }[];
}

/** Builds shortcut help sections from current action bindings. */
export function buildHelpSections(
  definitions: readonly ActionDefinition[],
  bindings: Readonly<Record<string, readonly string[]>>,
  label: (def: ActionDefinition) => string,
  strings: PaletteStrings,
): HelpSection[] {
  const groups = new Map<string, { label: string; keys: readonly string[] }[]>();
  for (const definition of definitions) {
    const keys = bindings[definition.id];
    if (!keys?.length) continue;
    const dot = definition.id.indexOf('.');
    const group = definition.id.slice(0, dot === -1 ? definition.id.length : dot);
    const rows = groups.get(group);
    const row = { label: label(definition), keys };
    if (rows) rows.push(row);
    else groups.set(group, [row]);
  }
  for (const fixed of FIXED_HELP_ROWS) {
    const rows = groups.get(fixed.group);
    const row = { label: fixed.label, keys: fixed.keys };
    if (rows) rows.push(row);
    else groups.set(fixed.group, [row]);
  }

  const sections: HelpSection[] = [];
  for (const [group, title] of Object.entries(strings.groups)) {
    const rows = groups.get(group);
    if (rows?.length) sections.push({ title, rows });
  }
  for (const [group, rows] of groups) {
    if (Object.prototype.hasOwnProperty.call(strings.groups, group)) continue;
    sections.push({ title: group[0]?.toUpperCase() + group.slice(1), rows });
  }
  return sections;
}

/** Returns a camera view that reveals bounds with comfortable padding. */
export function revealView(bounds: Bounds, visible: Bounds): CameraView {
  const pad = Math.max(0.1 * Math.max(bounds.w, bounds.h), 1);
  const padded = {
    x: bounds.x - pad,
    y: bounds.y - pad,
    w: bounds.w + pad * 2,
    h: bounds.h + pad * 2,
  };
  if (padded.w <= visible.w && padded.h <= visible.h) {
    return {
      x: padded.x + padded.w / 2 - visible.w / 2,
      y: padded.y + padded.h / 2 - visible.h / 2,
      w: visible.w,
      h: visible.h,
    };
  }
  return padded;
}
