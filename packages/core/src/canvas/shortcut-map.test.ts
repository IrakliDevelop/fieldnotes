/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { ShortcutMap } from './shortcut-map';

function kbd(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

/**
 * Seeds the same defaults the registry produces via {@link createBuiltinActions}
 * + {@link DEFAULT_TOOL_SHORTCUTS}, so the map behaves like a production setup.
 */
function seedAllDefaults(map: ShortcutMap): void {
  map.setDefault('edit.delete', ['delete', 'backspace'], false);
  map.setDefault('select.none', ['escape'], false);
  map.setDefault('edit.undo', ['mod+z'], false);
  map.setDefault('edit.redo', ['mod+y', 'mod+shift+z'], false);
  map.setDefault('select.all', ['mod+a'], false);
  map.setDefault('select.cycle', ['tab'], false);
  map.setDefault('select.cycle-reverse', ['shift+tab'], false);
  map.setDefault('edit.copy', ['mod+c'], false);
  // edit.paste has no default shortcut
  map.setDefault('edit.duplicate', ['mod+d'], false);
  map.setDefault('arrange.bring-forward', [']'], false);
  map.setDefault('arrange.send-backward', ['['], false);
  map.setDefault('arrange.bring-to-front', ['mod+]'], false);
  map.setDefault('arrange.send-to-back', ['mod+['], false);
  map.setDefault('view.zoom-to-fit', ['shift+1'], false);
  map.setDefault('view.zoom-in', ['mod+='], false);
  map.setDefault('view.zoom-out', ['mod+-'], false);
  map.setDefault('view.zoom-reset', ['mod+0'], false);
  map.setDefault('arrange.group', ['mod+g'], false);
  map.setDefault('arrange.ungroup', ['mod+shift+g'], false);
  map.setDefault('edit.cut', ['mod+x'], false);
  map.setDefault('arrange.toggle-lock', ['mod+shift+l'], false);
  map.setDefault('arrange.rotate-cw', ['r'], false);
  map.setDefault('arrange.rotate-ccw', ['shift+r'], false);
  map.setDefault('arrange.nudge-left', ['arrowleft'], true);
  map.setDefault('arrange.nudge-right', ['arrowright'], true);
  map.setDefault('arrange.nudge-up', ['arrowup'], true);
  map.setDefault('arrange.nudge-down', ['arrowdown'], true);
  map.setDefault('tool.select', ['v'], false);
  map.setDefault('tool.hand', ['h'], false);
  map.setDefault('tool.pencil', ['p'], false);
  map.setDefault('tool.eraser', ['e'], false);
  map.setDefault('tool.arrow', ['a'], false);
  map.setDefault('tool.note', ['n'], false);
  map.setDefault('tool.text', ['t'], false);
  map.setDefault('tool.shape', ['s'], false);
}

describe('ShortcutMap defaults', () => {
  it('starts empty without defaults', () => {
    const map = new ShortcutMap();
    expect(map.getBindings()).toEqual({});
  });

  it('matches mod+z to edit.undo with ctrl', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
  });

  it('matches mod+z to edit.undo with meta (mac)', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'z', metaKey: true }))).toBe('edit.undo');
  });

  it('does NOT match mod+z when shift is held (shift-exactness)', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
  });

  it('matches both redo bindings', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'y', ctrlKey: true }))).toBe('edit.redo');
    expect(map.match(kbd({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('edit.redo');
  });

  it('matches plain keys without modifiers', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'Escape' }))).toBe('select.none');
    expect(map.match(kbd({ key: 'Delete' }))).toBe('edit.delete');
    expect(map.match(kbd({ key: 'Backspace' }))).toBe('edit.delete');
    expect(map.match(kbd({ key: ']' }))).toBe('arrange.bring-forward');
    expect(map.match(kbd({ key: '[', ctrlKey: true }))).toBe('arrange.send-to-back');
  });

  it('does not match a plain key when an unrelated modifier is held', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: ']', altKey: true }))).toBeNull();
  });

  it('matches digits via e.code (layout-independent)', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('view.zoom-to-fit');
    expect(map.match(kbd({ key: '1', code: 'Digit1' }))).toBeNull();
  });

  it('nudge bindings allow shift (grid-step variant)', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'ArrowLeft' }))).toBe('arrange.nudge-left');
    expect(map.match(kbd({ key: 'ArrowLeft', shiftKey: true }))).toBe('arrange.nudge-left');
    expect(map.match(kbd({ key: 'ArrowDown' }))).toBe('arrange.nudge-down');
  });

  it('matches default tool keys', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'v' }))).toBe('tool.select');
    expect(map.match(kbd({ key: 'P' }))).toBe('tool.pencil');
    expect(map.match(kbd({ key: 'g' }))).toBeNull(); // tool:template removed (VTT)
  });

  it('returns null for unbound keys', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'q' }))).toBeNull();
  });

  it('maps mod+= / mod+- / mod+0 to the zoom actions', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: '=', ctrlKey: true }))).toBe('view.zoom-in');
    expect(map.match(kbd({ key: '-', ctrlKey: true }))).toBe('view.zoom-out');
    expect(map.match(kbd({ key: '0', ctrlKey: true, code: 'Digit0' }))).toBe('view.zoom-reset');
  });

  it('does NOT bind mod+v (paste is routed through the native paste event)', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'v', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'v', metaKey: true }))).toBeNull();
  });

  it('binds r to arrange.rotate-cw and shift+r to arrange.rotate-ccw by default', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    const bindings = map.getBindings();
    expect(bindings['arrange.rotate-cw']).toEqual(['r']);
    expect(bindings['arrange.rotate-ccw']).toEqual(['shift+r']);
  });

  it('matches r without shift to arrange.rotate-cw and with shift to arrange.rotate-ccw', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    const plain = new KeyboardEvent('keydown', { key: 'r' });
    const shifted = new KeyboardEvent('keydown', { key: 'R', shiftKey: true });
    expect(map.match(plain)).toBe('arrange.rotate-cw');
    expect(map.match(shifted)).toBe('arrange.rotate-ccw');
  });
});

describe('ShortcutMap setDefault', () => {
  it('rejects invalid defaults atomically, including for user-overridden actions', () => {
    const map = new ShortcutMap();
    map.setDefault('existing.action', ['mod+e'], false);
    map.rebind('overridden.action', 'mod+o');
    const bindingsBefore = map.getBindings();

    expect(() => map.setDefault('rejected.action', ['ctrl+'], true)).toThrow(/binding/i);
    expect(() => map.setDefault('overridden.action', ['ctrl+'], true)).toThrow(/binding/i);

    expect(map.getBindings()).toEqual(bindingsBefore);
    expect(map.getBindings()['rejected.action']).toBeUndefined();
    expect(() => map.reset()).not.toThrow();
    expect(map.getBindings()).toEqual({ 'existing.action': ['mod+e'] });
  });

  it('setDefault applies bindings and reset(id) restores them', () => {
    const map = new ShortcutMap();
    map.setDefault('edit.undo', ['mod+z'], false);
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    map.rebind('edit.undo', 'mod+u');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBeNull();
    map.reset('edit.undo');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
  });

  it('setDefault does not override a prior rebind; reset(id) then restores the default', () => {
    const map = new ShortcutMap();
    map.rebind('edit.undo', 'mod+u');
    map.setDefault('edit.undo', ['mod+z'], false);
    // user rebind should win
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBe('edit.undo');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBeNull();
    // reset restores the default
    map.reset('edit.undo');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBeNull();
  });

  it('reset() re-applies every default and drops user-only bindings', () => {
    const map = new ShortcutMap();
    map.setDefault('edit.undo', ['mod+z'], false);
    map.rebind('edit.undo', 'mod+u');
    map.rebind('custom.action', 'x');
    map.reset();
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'x' }))).toBeNull(); // user-only binding dropped
  });

  it('match honours allowShift per id', () => {
    const map = new ShortcutMap();
    map.setDefault('arrange.nudge-left', ['arrowleft'], true);
    map.setDefault('edit.undo', ['mod+z'], false);
    // nudge allows shift
    expect(map.match(kbd({ key: 'ArrowLeft', shiftKey: true }))).toBe('arrange.nudge-left');
    // undo does NOT allow shift
    expect(map.match(kbd({ key: 'z', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('match order follows default registration order for conflicts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    map.setDefault('first.action', ['mod+z'], false);
    map.setDefault('second.action', ['mod+z'], false);
    // first registered wins
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('first.action');
    warn.mockRestore();
  });
});

describe('ShortcutMap rebind overrides applied after defaults', () => {
  it('a new plugin id binding that conflicts with a built-in default keeps the built-in winning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    seedAllDefaults(map);
    // 'r' is already bound to arrange.rotate-cw by seedAllDefaults
    // A plugin tool bound to 'r' via user overrides should not displace it;
    // the first-registered action (arrange.rotate-cw) wins and a warning is emitted.
    map.rebind('tool.dm-fog', 'r');
    expect(map.match(kbd({ key: 'r' }))).toBe('arrange.rotate-cw');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('conflicts'));
    warn.mockRestore();
  });

  it('rebind with a legacy key rebinds the canonical id', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('undo', 'mod+u');
    const bindings = map.getBindings();
    expect(bindings['edit.undo']).toEqual(['mod+u']);
  });

  it('applies binding overrides via rebind', () => {
    const map = new ShortcutMap();
    map.rebind('duplicate', 'mod+shift+d');
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'd', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'D', ctrlKey: true, shiftKey: true }))).toBe('edit.duplicate');
  });

  it('disables an action with null via rebind', () => {
    const map = new ShortcutMap();
    map.rebind('copy', null);
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'c', ctrlKey: true }))).toBeNull();
  });

  it('accepts arrays and custom tool ids via rebind', () => {
    const map = new ShortcutMap();
    map.rebind('tool:pencil', ['p', 'b']);
    map.rebind('tool:dm-fog', 'f');
    seedAllDefaults(map);
    expect(map.match(kbd({ key: 'b' }))).toBe('tool.pencil');
    expect(map.match(kbd({ key: 'f' }))).toBe('tool.dm-fog');
  });

  it('throws on malformed bindings via rebind', () => {
    const map = new ShortcutMap();
    expect(() => map.rebind('edit.undo', 'mod+')).toThrow(/binding/i);
    expect(() => map.rebind('edit.undo', 'bogus+z')).toThrow(/bogus/i);
  });

  it('throws when mod is combined with ctrl or meta', () => {
    const map = new ShortcutMap();
    expect(() => map.rebind('edit.undo', 'mod+ctrl+z')).toThrow(/mod/i);
    expect(() => map.rebind('edit.undo', 'mod+meta+z')).toThrow(/mod/i);
  });

  it('still accepts mod with shift/alt and bare ctrl/meta', () => {
    const map = new ShortcutMap();
    expect(() => {
      map.rebind('a', 'mod+shift+z');
      map.rebind('b', 'mod+alt+z');
      map.rebind('c', 'ctrl+z');
      map.rebind('d', 'meta+z');
    }).not.toThrow();
  });
});

describe('ShortcutMap runtime API', () => {
  it('rebind replaces bindings', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('edit.undo', 'mod+u');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBe('edit.undo');
  });

  it('disable kills an action; reset(action) restores its default', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.disable('edit.delete');
    expect(map.match(kbd({ key: 'Delete' }))).toBeNull();
    map.reset('edit.delete');
    expect(map.match(kbd({ key: 'Delete' }))).toBe('edit.delete');
  });

  it('reset() restores everything, removing custom ids', () => {
    const map = new ShortcutMap();
    map.rebind('tool:dm-fog', 'f');
    seedAllDefaults(map);
    map.rebind('edit.undo', 'mod+u');
    map.reset();
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    expect(map.match(kbd({ key: 'f' }))).toBeNull();
  });

  it('reset(unknownId) is a no-op; rebind(unknownId) is allowed', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(() => map.reset('nonsense')).not.toThrow();
    map.rebind('tool.custom', 'x');
    expect(map.match(kbd({ key: 'x' }))).toBe('tool.custom');
  });

  it('getBindings returns a copy reflecting current state', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('edit.undo', 'mod+u');
    map.disable('edit.copy');
    const b = map.getBindings();
    expect(b['edit.undo']).toEqual(['mod+u']);
    expect(b['edit.copy']).toEqual([]);
    expect(b['edit.redo']).toEqual(['mod+y', 'mod+shift+z']);
    b['edit.undo'] = ['hacked'];
    expect(map.getBindings()['edit.undo']).toEqual(['mod+u']);
  });

  it('rebind throws on malformed binding', () => {
    const map = new ShortcutMap();
    expect(() => map.rebind('edit.undo', 'mod+ctrl+')).toThrow();
  });

  it('matches alt-modifier bindings', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('tool.hand', 'alt+k');
    expect(map.match(kbd({ key: 'k', altKey: true }))).toBe('tool.hand');
    expect(map.match(kbd({ key: 'k' }))).toBeNull();
  });

  it('reset(action) after rebind restores the default binding', () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('edit.undo', 'mod+u');
    map.reset('edit.undo');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBeNull();
  });

  it("supports the 'space' named key", () => {
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('tool.hand', 'space');
    expect(map.match(kbd({ key: ' ' }))).toBe('tool.hand');
  });

  it('rebind/disable/reset accept legacy ids and store canonical keys', () => {
    const map = new ShortcutMap();
    map.setDefault('edit.undo', ['mod+z'], false);
    map.rebind('undo', 'mod+u');
    const bindings = map.getBindings();
    expect(bindings['edit.undo']).toEqual(['mod+u']);
    expect(bindings['undo']).toBeUndefined();
  });
});

describe('ShortcutMap conflict warnings', () => {
  it("warns when an action's binding collides with a different action", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('my-action', 'mod+z'); // mod+z is already bound to edit.undo
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('conflicts with'));
    warn.mockRestore();
  });

  it('does not warn when rebinding an action to its own existing combo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('edit.undo', 'mod+z');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn during normal default-binding setup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    seedAllDefaults(map);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('match() is unchanged: the first-registered owner still wins the colliding combo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new ShortcutMap();
    seedAllDefaults(map);
    map.rebind('my-action', 'mod+z');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('edit.undo');
    warn.mockRestore();
  });
});
