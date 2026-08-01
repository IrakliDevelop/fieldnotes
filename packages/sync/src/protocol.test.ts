import { describe, it, expect } from 'vitest';
import {
  createArrow,
  createGrid,
  createHtmlElement,
  createImage,
  createNote,
  createShape,
  createStroke,
  createTemplate,
  createText,
  type CanvasElement,
} from '@fieldnotes/core';
import {
  isValidElement,
  isValidEnvelope,
  parseEnvelope,
  applyOpToMap,
  type SyncOp,
} from './protocol';

function shape(x = 0): CanvasElement {
  return createShape({ position: { x, y: x }, size: { w: 10, h: 10 } });
}

describe('isValidElement', () => {
  it('accepts every real element variant', () => {
    const elements: CanvasElement[] = [
      createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] }),
      createNote({ position: { x: 0, y: 0 } }),
      createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }),
      createImage({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, src: '/map.png' }),
      createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
      createText({ position: { x: 0, y: 0 } }),
      shape(),
      createGrid({}),
      createTemplate({
        position: { x: 0, y: 0 },
        templateShape: 'cone',
        radius: 30,
      }),
    ];

    for (const element of elements) expect(isValidElement(element)).toBe(true);
  });

  it('rejects a known type whose required fields are missing', () => {
    expect(isValidElement({ id: 'x', type: 'shape' })).toBe(false);
  });

  it('rejects malformed base fields and non-finite geometry', () => {
    const valid = shape();
    expect(isValidElement({ ...valid, position: { x: '0', y: 0 } })).toBe(false);
    expect(isValidElement({ ...valid, locked: 'false' })).toBe(false);
    expect(isValidElement({ ...valid, zIndex: Number.NaN })).toBe(false);
    expect(isValidElement({ ...valid, size: { w: Number.POSITIVE_INFINITY, h: 10 } })).toBe(false);
  });

  it('rejects malformed fields specific to each element variant', () => {
    const malformed: unknown[] = [
      { ...createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] }), points: [{}] },
      { ...createNote({ position: { x: 0, y: 0 } }), textColor: 42 },
      { ...createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }), from: null },
      {
        ...createImage({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, src: '/map.png' }),
        src: 42,
      },
      {
        ...createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
        interactive: 'yes',
      },
      { ...createText({ position: { x: 0, y: 0 } }), textAlign: 'justify' },
      { ...shape(), shape: 'triangle' },
      { ...createGrid({}), gridType: 'triangle' },
      {
        ...createTemplate({ position: { x: 0, y: 0 }, templateShape: 'cone', radius: 30 }),
        templateShape: 'triangle',
      },
    ];

    for (const element of malformed) expect(isValidElement(element)).toBe(false);
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
