import { describe, expect, it } from 'vitest';
import type { ActionDefinition } from '../actions/types';
import {
  buildHelpSections,
  DEFAULT_PALETTE_STRINGS,
  FIXED_HELP_ROWS,
  formatBinding,
  resolvePaletteStrings,
  revealView,
  searchActions,
} from './palette-model';

function action(
  id: string,
  label: ActionDefinition['label'],
  keywords?: readonly string[],
): ActionDefinition {
  return { id, label, keywords, perform: () => undefined };
}

describe('palette model', () => {
  it('searchActions ranks label prefix, word prefix, contains, then keyword or id', () => {
    const definitions = [
      action('edit.undo', 'Undo', ['revert', 'back']),
      action('edit.redo', 'Redo'),
      action('select.all', 'Select all'),
      action('arrange.bring-forward', 'Bring Forward', ['forward', 'layer up']),
      action('palette.open', 'Command palette'),
    ];
    const deps = {
      isEnabled: () => true,
      label: (definition: ActionDefinition) =>
        typeof definition.label === 'string' ? definition.label : '',
      bindings: { 'edit.undo': ['mod+z'] },
    };

    expect(searchActions(definitions, 're', deps).map((row) => row.id)).toEqual([
      'edit.redo',
      'edit.undo',
    ]);
    expect(searchActions(definitions, 'all', deps).map((row) => row.id)).toEqual(['select.all']);
    expect(searchActions(definitions, 'do', deps).map((row) => row.id)).toEqual([
      'edit.undo',
      'edit.redo',
    ]);
    expect(searchActions(definitions, 'for', deps).map((row) => row.id)).toEqual([
      'arrange.bring-forward',
    ]);
    expect(searchActions(definitions, '', deps)).toEqual([
      { kind: 'action', id: 'edit.undo', label: 'Undo', keys: ['mod+z'] },
      { kind: 'action', id: 'edit.redo', label: 'Redo', keys: [] },
      { kind: 'action', id: 'select.all', label: 'Select all', keys: [] },
      { kind: 'action', id: 'arrange.bring-forward', label: 'Bring Forward', keys: [] },
    ]);
  });

  it('searchActions drops disabled actions and matches the resolved label', () => {
    const toggleLock = action('arrange.toggle-lock', () => 'Lock');
    const rows = searchActions([action('edit.redo', 'Redo'), toggleLock], 'unl', {
      isEnabled: (id) => id !== 'edit.redo',
      label: (definition) => (definition === toggleLock ? 'Unlock' : 'Redo'),
      bindings: {},
    });

    expect(rows).toEqual([
      { kind: 'action', id: 'arrange.toggle-lock', label: 'Unlock', keys: [] },
    ]);
  });

  it('searchActions keeps every score tier and tied prefix matches in registration order', () => {
    const definitions = [
      action('search.catalog', 'Catalog'),
      action('search.catapult', 'Catapult'),
      action('search.big-animal', 'Big Cat'),
      action('search.disperse', 'Scatter'),
      action('search.find', 'Find', ['category']),
      action('search.cat-id', 'Seek', ['seek']),
    ];

    expect(
      searchActions(definitions, 'cat', {
        isEnabled: () => true,
        label: (definition) => (typeof definition.label === 'string' ? definition.label : ''),
        bindings: {},
      }).map((row) => row.id),
    ).toEqual([
      'search.catalog',
      'search.catapult',
      'search.big-animal',
      'search.disperse',
      'search.find',
      'search.cat-id',
    ]);
  });

  it.each([
    ['mod+k', true, '⌘K'],
    ['mod+k', false, 'Ctrl+K'],
    ['mod+shift+z', true, '⇧⌘Z'],
    ['mod+shift+z', false, 'Ctrl+Shift+Z'],
    ['alt+mod+x', false, 'Ctrl+Alt+X'],
    ['ctrl+alt+shift+meta+x', false, 'Ctrl+Alt+Shift+Win+X'],
    ['ctrl+alt+x', true, '⌃⌥X'],
    ['shift+1', false, 'Shift+1'],
    ['arrowleft', false, '←'],
    [' ', false, 'Space'],
    ['space', false, 'Space'],
    ['escape', false, 'Esc'],
    ['backspace', true, '⌫'],
    ['backspace', false, 'Backspace'],
    ['pagedown', false, 'PgDn'],
    ['?', false, '?'],
    ['mod+]', false, 'Ctrl+]'],
    ['meta+k', false, 'Win+K'],
    ['enter', false, 'Enter'],
  ])('formatBinding renders %s on mac=%s as %s', (binding, mac, expected) => {
    expect(formatBinding(binding, mac)).toBe(expected);
  });

  it('buildHelpSections groups by namespace, appends fixed rows and shows rebinds', () => {
    const rename = action('edit.rename', () => 'Definition rename');
    const disabled = { ...action('edit.disabled', 'Disabled'), enabled: () => false };
    const definitions = [
      action('edit.undo', 'Undo'),
      rename,
      disabled,
      action('edit.paste', 'Paste'),
      action('tool.pencil', 'Pencil'),
      action('zoo.frob', 'Frob'),
    ];
    const sections = buildHelpSections(
      definitions,
      {
        'edit.undo': ['mod+u'],
        'edit.rename': ['mod+r'],
        'edit.disabled': ['mod+d'],
        'tool.pencil': ['p'],
        'zoo.frob': ['mod+shift+f'],
      },
      (definition) => {
        if (definition === rename) return 'Visible rename';
        return typeof definition.label === 'string' ? definition.label : '';
      },
      DEFAULT_PALETTE_STRINGS,
    );

    expect(sections.map((section) => section.title)).toEqual([
      'Edit',
      'Tools',
      'Palette',
      'While presenting',
      'Zoo',
    ]);
    expect(sections[0]?.rows).toEqual([
      { label: 'Undo', keys: ['mod+u'] },
      { label: 'Visible rename', keys: ['mod+r'] },
      { label: 'Disabled', keys: ['mod+d'] },
      { label: 'Paste', keys: ['mod+v'] },
    ]);
    expect(sections[2]?.rows).toEqual([
      { label: 'Move through results', keys: ['arrowup', 'arrowdown'] },
      { label: 'Run the action or go to the element', keys: ['enter'] },
      { label: 'Close the palette', keys: ['escape'] },
    ]);
    expect(sections[4]?.rows).toEqual([{ label: 'Frob', keys: ['mod+shift+f'] }]);
  });

  it('FIXED_HELP_ROWS fixes every fixed help row', () => {
    expect(FIXED_HELP_ROWS).toEqual([
      { group: 'edit', label: 'Paste', keys: ['mod+v'] },
      {
        group: 'palette',
        label: 'Move through results',
        keys: ['arrowup', 'arrowdown'],
      },
      {
        group: 'palette',
        label: 'Run the action or go to the element',
        keys: ['enter'],
      },
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
    ]);
  });

  it('resolvePaletteStrings merges top-level strings and groups and types per key', () => {
    const strings = resolvePaletteStrings({
      groups: { zoo: 'Zoo' },
      types: { 'zoo:cat': 'Cat' },
      placeholder: 'Suche',
      results: 'Treffer',
    });

    expect(DEFAULT_PALETTE_STRINGS).toEqual({
      placeholder: 'Search actions and the board',
      noResults: 'No matches. Try a shorter search.',
      actions: 'Actions',
      board: 'On the board',
      helpTitle: 'Keyboard shortcuts',
      close: 'Close the palette',
      results: 'results',
      groups: {
        edit: 'Edit',
        select: 'Select',
        arrange: 'Arrange',
        view: 'View',
        tool: 'Tools',
        palette: 'Palette',
        presentation: 'While presenting',
      },
      types: { note: 'Note', text: 'Text', arrow: 'Arrow', 'core:frame': 'Frame' },
    });
    expect(strings).toEqual({
      placeholder: 'Suche',
      noResults: 'No matches. Try a shorter search.',
      actions: 'Actions',
      board: 'On the board',
      helpTitle: 'Keyboard shortcuts',
      close: 'Close the palette',
      results: 'Treffer',
      groups: {
        edit: 'Edit',
        select: 'Select',
        arrange: 'Arrange',
        view: 'View',
        tool: 'Tools',
        palette: 'Palette',
        presentation: 'While presenting',
        zoo: 'Zoo',
      },
      types: {
        note: 'Note',
        text: 'Text',
        arrow: 'Arrow',
        'core:frame': 'Frame',
        'zoo:cat': 'Cat',
      },
    });
    expect(resolvePaletteStrings(undefined)).toEqual({
      placeholder: 'Search actions and the board',
      noResults: 'No matches. Try a shorter search.',
      actions: 'Actions',
      board: 'On the board',
      helpTitle: 'Keyboard shortcuts',
      close: 'Close the palette',
      results: 'results',
      groups: {
        edit: 'Edit',
        select: 'Select',
        arrange: 'Arrange',
        view: 'View',
        tool: 'Tools',
        palette: 'Palette',
        presentation: 'While presenting',
      },
      types: { note: 'Note', text: 'Text', arrow: 'Arrow', 'core:frame': 'Frame' },
    });
  });

  it('revealView pans when the element fits and zooms out when it does not', () => {
    const visible = { x: 0, y: 0, w: 800, h: 600 };

    expect(revealView({ x: 100, y: 100, w: 50, h: 20 }, visible)).toEqual({
      x: -275,
      y: -190,
      w: 800,
      h: 600,
    });
    expect(revealView({ x: 0, y: 0, w: 2000, h: 100 }, visible)).toEqual({
      x: -200,
      y: -200,
      w: 2400,
      h: 500,
    });
    expect(revealView({ x: 5, y: 5, w: 0, h: 0 }, visible)).toEqual({
      x: -395,
      y: -295,
      w: 800,
      h: 600,
    });
  });
});
