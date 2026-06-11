/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { ShortcutMap } from './shortcut-map';

function kbd(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('ShortcutMap defaults', () => {
  it('matches mod+z to undo with ctrl', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('undo');
  });

  it('matches mod+z to undo with meta (mac)', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'z', metaKey: true }))).toBe('undo');
  });

  it('does NOT match mod+z when shift is held (shift-exactness)', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('matches both redo bindings', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(map.match(kbd({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('matches plain keys without modifiers', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'Escape' }))).toBe('deselect');
    expect(map.match(kbd({ key: 'Delete' }))).toBe('delete');
    expect(map.match(kbd({ key: 'Backspace' }))).toBe('delete');
    expect(map.match(kbd({ key: ']' }))).toBe('z-forward');
    expect(map.match(kbd({ key: '[', ctrlKey: true }))).toBe('z-back');
  });

  it('does not match a plain key when an unrelated modifier is held', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: ']', altKey: true }))).toBeNull();
  });

  it('matches digits via e.code (layout-independent)', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('zoom-fit');
    expect(map.match(kbd({ key: '1', code: 'Digit1' }))).toBeNull();
  });

  it('nudge bindings allow shift (grid-step variant)', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'ArrowLeft' }))).toBe('nudge-left');
    expect(map.match(kbd({ key: 'ArrowLeft', shiftKey: true }))).toBe('nudge-left');
    expect(map.match(kbd({ key: 'ArrowDown' }))).toBe('nudge-down');
  });

  it('matches default tool keys', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'v' }))).toBe('tool:select');
    expect(map.match(kbd({ key: 'P' }))).toBe('tool:pencil');
    expect(map.match(kbd({ key: 'g' }))).toBe('tool:template');
  });

  it('returns null for unbound keys', () => {
    const map = new ShortcutMap();
    expect(map.match(kbd({ key: 'q' }))).toBeNull();
  });
});

describe('ShortcutMap constructor overrides', () => {
  it('applies binding overrides', () => {
    const map = new ShortcutMap({ duplicate: 'mod+shift+d' });
    expect(map.match(kbd({ key: 'd', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'D', ctrlKey: true, shiftKey: true }))).toBe('duplicate');
  });

  it('disables an action with null', () => {
    const map = new ShortcutMap({ copy: null });
    expect(map.match(kbd({ key: 'c', ctrlKey: true }))).toBeNull();
  });

  it('accepts arrays and custom tool ids', () => {
    const map = new ShortcutMap({ 'tool:pencil': ['p', 'b'], 'tool:dm-fog': 'f' });
    expect(map.match(kbd({ key: 'b' }))).toBe('tool:pencil');
    expect(map.match(kbd({ key: 'f' }))).toBe('tool:dm-fog');
  });

  it('throws on malformed bindings at construction', () => {
    expect(() => new ShortcutMap({ undo: 'mod+' })).toThrow(/binding/i);
    expect(() => new ShortcutMap({ undo: 'bogus+z' })).toThrow(/bogus/i);
  });
});

describe('ShortcutMap runtime API', () => {
  it('rebind replaces bindings', () => {
    const map = new ShortcutMap();
    map.rebind('undo', 'mod+u');
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBeNull();
    expect(map.match(kbd({ key: 'u', ctrlKey: true }))).toBe('undo');
  });

  it('disable kills an action; reset(action) restores its default', () => {
    const map = new ShortcutMap();
    map.disable('delete');
    expect(map.match(kbd({ key: 'Delete' }))).toBeNull();
    map.reset('delete');
    expect(map.match(kbd({ key: 'Delete' }))).toBe('delete');
  });

  it('reset() restores everything, removing custom ids', () => {
    const map = new ShortcutMap({ 'tool:dm-fog': 'f' });
    map.rebind('undo', 'mod+u');
    map.reset();
    expect(map.match(kbd({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(map.match(kbd({ key: 'f' }))).toBeNull();
  });

  it('reset(unknownId) is a no-op; rebind(unknownId) is allowed', () => {
    const map = new ShortcutMap();
    expect(() => map.reset('nonsense')).not.toThrow();
    map.rebind('tool:custom', 'x');
    expect(map.match(kbd({ key: 'x' }))).toBe('tool:custom');
  });

  it('getBindings returns a copy reflecting current state', () => {
    const map = new ShortcutMap();
    map.rebind('undo', 'mod+u');
    map.disable('copy');
    const b = map.getBindings();
    expect(b['undo']).toEqual(['mod+u']);
    expect(b['copy']).toEqual([]);
    expect(b['redo']).toEqual(['mod+y', 'mod+shift+z']);
    b['undo'] = ['hacked'];
    expect(map.getBindings()['undo']).toEqual(['mod+u']);
  });

  it('rebind throws on malformed binding', () => {
    const map = new ShortcutMap();
    expect(() => map.rebind('undo', 'mod+ctrl+')).toThrow();
  });
});
