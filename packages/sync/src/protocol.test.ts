import { describe, it, expect } from 'vitest';
import { createShape, type CanvasElement } from '@fieldnotes/core';
import {
  isValidElement,
  isValidEnvelope,
  parseEnvelope,
  applyOpToMap,
  type SyncOp,
} from './protocol';

function shape(x = 0): CanvasElement {
  return createShape({ position: { x, y: x }, size: { width: 10, height: 10 } });
}

describe('isValidElement', () => {
  it('accepts a real element', () => {
    expect(isValidElement(shape())).toBe(true);
  });

  it('accepts a minimal id + known type', () => {
    expect(isValidElement({ id: 'x', type: 'shape' })).toBe(true);
  });

  it('rejects an object with no id', () => {
    expect(isValidElement({})).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(isValidElement({ id: 'x', type: 'bogus' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidElement(null)).toBe(false);
    expect(isValidElement('shape')).toBe(false);
    expect(isValidElement(42)).toBe(false);
  });
});

describe('isValidEnvelope', () => {
  it('rejects upsert with a bad element', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'upsert', element: {} } })).toBe(false);
  });

  it('accepts upsert with a valid element', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'upsert', element: shape() } })).toBe(true);
  });

  it('accepts remove with an id, rejects without', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'remove', id: 'x' } })).toBe(true);
    expect(isValidEnvelope({ from: 'A', op: { kind: 'remove' } })).toBe(false);
  });

  it('accepts clear and request-snapshot', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'clear' } })).toBe(true);
    expect(isValidEnvelope({ from: 'A', op: { kind: 'request-snapshot' } })).toBe(true);
  });

  it('accepts snapshot by shape only (even with a bad element inside)', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'snapshot', to: 'B', elements: [{}] } })).toBe(
      true,
    );
  });

  it('rejects snapshot missing to or non-array elements', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'snapshot', elements: [] } })).toBe(false);
    expect(
      isValidEnvelope({ from: 'A', op: { kind: 'snapshot', to: 'B', elements: 'nope' } }),
    ).toBe(false);
  });

  it('rejects unknown kinds, non-objects, and non-string from', () => {
    expect(isValidEnvelope({ from: 'A', op: { kind: 'bogus' } })).toBe(false);
    expect(isValidEnvelope(null)).toBe(false);
    expect(isValidEnvelope('x')).toBe(false);
    expect(isValidEnvelope({ from: 1, op: { kind: 'clear' } })).toBe(false);
  });
});

describe('parseEnvelope', () => {
  it('returns null for malformed JSON', () => {
    expect(parseEnvelope('{bad')).toBeNull();
    expect(parseEnvelope('')).toBeNull();
  });

  it('returns null for valid JSON that fails validation', () => {
    expect(parseEnvelope(JSON.stringify({ from: 'A', op: { kind: 'bogus' } }))).toBeNull();
  });

  it('returns the envelope for valid input', () => {
    const env = { from: 'A', op: { kind: 'clear' as const } };
    expect(parseEnvelope(JSON.stringify(env))).toEqual(env);
  });
});

describe('applyOpToMap', () => {
  it('upsert sets, remove deletes, clear empties', () => {
    const map = new Map<string, CanvasElement>();
    const el = shape(1);

    applyOpToMap(map, { kind: 'upsert', element: el });
    expect(map.get(el.id)).toBe(el);

    applyOpToMap(map, { kind: 'remove', id: el.id });
    expect(map.has(el.id)).toBe(false);

    map.set(el.id, el);
    applyOpToMap(map, { kind: 'clear' });
    expect(map.size).toBe(0);
  });

  it('treats control ops as no-ops', () => {
    const map = new Map<string, CanvasElement>();
    const el = shape(2);
    map.set(el.id, el);

    const ops: SyncOp[] = [
      { kind: 'request-snapshot' },
      { kind: 'snapshot', to: 'B', elements: [shape(3)] },
    ];
    for (const op of ops) applyOpToMap(map, op);

    expect(map.size).toBe(1);
    expect(map.get(el.id)).toBe(el);
  });
});
