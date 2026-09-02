import { describe, it, expect } from 'vitest';
import {
  isAwarenessPresence,
  AWARENESS_PRESENCE_KIND,
  AWARENESS_MAX_SELECTION,
} from './awareness-presence';

const base = { kind: 'awareness', id: 'player-1' };

describe('isAwarenessPresence', () => {
  it('accepts a minimal identity frame and a fully populated snapshot', () => {
    expect(isAwarenessPresence(base)).toBe(true);
    expect(
      isAwarenessPresence({
        ...base,
        name: 'Ada',
        color: '#ff3b30',
        role: 'player',
        cursor: { x: 1.5, y: -2 },
        selection: ['a', 'b'],
        tool: 'select',
      }),
    ).toBe(true);
    expect(AWARENESS_PRESENCE_KIND).toBe('awareness');
    expect(AWARENESS_MAX_SELECTION).toBe(256);
  });

  it('accepts a cleared frame with only kind and id, and rejects cleared with a bad id', () => {
    expect(isAwarenessPresence({ ...base, cleared: true })).toBe(true);
    expect(isAwarenessPresence({ ...base, cleared: true, cursor: 'garbage' })).toBe(true);
    expect(isAwarenessPresence({ ...base, cleared: false })).toBe(false);
    expect(isAwarenessPresence({ kind: 'awareness', id: '', cleared: true })).toBe(false);
    expect(isAwarenessPresence({ kind: 'awareness', cleared: true })).toBe(false);
  });

  it('rejects other kinds and non-objects', () => {
    expect(isAwarenessPresence(null)).toBe(false);
    expect(isAwarenessPresence('awareness')).toBe(false);
    expect(isAwarenessPresence({ kind: 'ping', x: 1, y: 2 })).toBe(false);
    expect(isAwarenessPresence({ kind: 'poke', feature: 'roster' })).toBe(false);
  });

  it('enforces every string cap at the boundary', () => {
    expect(isAwarenessPresence({ kind: 'awareness', id: 'x'.repeat(128) })).toBe(true);
    expect(isAwarenessPresence({ kind: 'awareness', id: 'x'.repeat(129) })).toBe(false);
    expect(isAwarenessPresence({ kind: 'awareness', id: '' })).toBe(false);
    expect(isAwarenessPresence({ ...base, name: 'n'.repeat(64) })).toBe(true);
    expect(isAwarenessPresence({ ...base, name: 'n'.repeat(65) })).toBe(false);
    expect(isAwarenessPresence({ ...base, color: 'c'.repeat(64) })).toBe(true);
    expect(isAwarenessPresence({ ...base, color: 'c'.repeat(65) })).toBe(false);
    expect(isAwarenessPresence({ ...base, role: 'r'.repeat(32) })).toBe(true);
    expect(isAwarenessPresence({ ...base, role: 'r'.repeat(33) })).toBe(false);
    expect(isAwarenessPresence({ ...base, tool: 't'.repeat(64) })).toBe(true);
    expect(isAwarenessPresence({ ...base, tool: 't'.repeat(65) })).toBe(false);
    expect(isAwarenessPresence({ ...base, name: 7 })).toBe(false);
  });

  it('requires a finite cursor', () => {
    expect(isAwarenessPresence({ ...base, cursor: { x: 0, y: 0 } })).toBe(true);
    expect(isAwarenessPresence({ ...base, cursor: { x: NaN, y: 0 } })).toBe(false);
    expect(isAwarenessPresence({ ...base, cursor: { x: 0, y: Infinity } })).toBe(false);
    expect(isAwarenessPresence({ ...base, cursor: { x: '1', y: 0 } })).toBe(false);
    expect(isAwarenessPresence({ ...base, cursor: null })).toBe(false);
  });

  it('bounds the selection: count, id length, holes, entry type', () => {
    expect(isAwarenessPresence({ ...base, selection: [] })).toBe(true);
    expect(
      isAwarenessPresence({ ...base, selection: Array.from({ length: 256 }, (_, i) => `e${i}`) }),
    ).toBe(true);
    expect(
      isAwarenessPresence({ ...base, selection: Array.from({ length: 257 }, (_, i) => `e${i}`) }),
    ).toBe(false);
    expect(isAwarenessPresence({ ...base, selection: ['x'.repeat(128)] })).toBe(true);
    expect(isAwarenessPresence({ ...base, selection: ['x'.repeat(129)] })).toBe(false);
    expect(isAwarenessPresence({ ...base, selection: [''] })).toBe(false);
    expect(isAwarenessPresence({ ...base, selection: ['a', 1] })).toBe(false);
    expect(isAwarenessPresence({ ...base, selection: 'a' })).toBe(false);
    const sparse: (string | undefined)[] = ['a'];
    sparse[2] = 'c'; // hole at index 1 — `.every` would skip it
    expect(isAwarenessPresence({ ...base, selection: sparse })).toBe(false);
  });

  it('tolerates unknown extra fields (forward compatibility)', () => {
    expect(isAwarenessPresence({ ...base, future: { nested: true } })).toBe(true);
  });
});
