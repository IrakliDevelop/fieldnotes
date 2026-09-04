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
  fogEncodeBase64,
} from '@fieldnotes/core';
import type { Layer } from '@fieldnotes/core';
import {
  isValidElement,
  isValidEnvelope,
  isValidLayerDefinition,
  isValidLayerRecord,
  isNewerLayerRecord,
  parseEnvelope,
  applyOpToMap,
  type LayerRecord,
  type SyncOp,
  isValidFogTileRecord,
  isValidFogMetaRecord,
  isValidFogSnapshot,
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

describe('fog wire validation', () => {
  const definition = {
    version: 1 as const,
    generation: 'gen-1',
    bounds: { x: 0, y: 0, w: 256, h: 256 },
    cellSize: 1,
    tileCells: 128 as const,
    base: 'covered' as const,
  };
  const data = fogEncodeBase64(new Uint8Array(2048).fill(0xff));
  const tile = {
    generation: 'gen-1',
    x: 0,
    y: 0,
    version: 1,
    editor: 'A',
    data,
  };

  it('requires exact canonical tile bytes, including padding bits', () => {
    expect(isValidFogTileRecord(tile)).toBe(true);
    expect(isValidFogTileRecord({ ...tile, data: data.slice(0, -1) + 'A' })).toBe(false);
    expect(isValidFogTileRecord({ ...tile, data: data.slice(0, -2) + 'B=' })).toBe(false);
    expect(isValidFogTileRecord({ ...tile, data: data.slice(0, -2) + '==' })).toBe(false);
  });

  it('rejects snapshot tiles when fog is disabled or coordinates miss the definition', () => {
    expect(isValidFogSnapshot({ meta: { version: 1, editor: 'A' }, tiles: [tile] })).toBe(false);
    expect(
      isValidFogSnapshot({
        meta: { version: 1, editor: 'A', definition },
        tiles: [{ ...tile, x: 2 }],
      }),
    ).toBe(false);
  });

  it('requires every patch record to match the outer generation', () => {
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'fog-patch', generation: 'gen-2', tiles: [tile] },
      }),
    ).toBe(false);
  });

  it('rejects non-ASCII ordering identifiers so JS and Redis tie-break identically', () => {
    expect(isValidFogMetaRecord({ version: 1, editor: '😀', definition })).toBe(false);
    expect(isValidFogTileRecord({ ...tile, editor: '\ue000' })).toBe(false);
  });
});

function layerDef(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-a',
    name: 'Layer A',
    visible: true,
    locked: false,
    order: 100,
    opacity: 1,
    ...overrides,
  };
}

describe('layer definition and record validation', () => {
  it('accepts a complete layer definition', () => {
    expect(isValidLayerDefinition(layerDef())).toBe(true);
  });

  it('rejects missing or malformed definition fields', () => {
    expect(isValidLayerDefinition({ ...layerDef(), name: 42 })).toBe(false);
    expect(isValidLayerDefinition({ ...layerDef(), visible: 'yes' })).toBe(false);
    expect(isValidLayerDefinition({ ...layerDef(), order: Number.NaN })).toBe(false);
    expect(isValidLayerDefinition({ ...layerDef(), opacity: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
    const withoutLocked: Partial<Layer> = { ...layerDef() };
    delete withoutLocked.locked;
    expect(isValidLayerDefinition(withoutLocked)).toBe(false);
    expect(isValidLayerDefinition(null)).toBe(false);
  });

  it('accepts records with and without a definition (tombstone)', () => {
    expect(
      isValidLayerRecord({ id: 'layer-a', version: 1, editor: 'A', definition: layerDef() }),
    ).toBe(true);
    expect(isValidLayerRecord({ id: 'layer-a', version: 3, editor: 'A' })).toBe(true);
  });

  it('rejects records with bad versions, missing editor, or mismatched definition id', () => {
    expect(isValidLayerRecord({ id: 'layer-a', version: 0, editor: 'A' })).toBe(false);
    expect(isValidLayerRecord({ id: 'layer-a', version: 1.5, editor: 'A' })).toBe(false);
    expect(isValidLayerRecord({ id: 'layer-a', version: Number.NaN, editor: 'A' })).toBe(false);
    expect(isValidLayerRecord({ id: 'layer-a', version: 1 })).toBe(false);
    expect(
      isValidLayerRecord({
        id: 'layer-b',
        version: 1,
        editor: 'A',
        definition: layerDef(), // definition.id is 'layer-a'
      }),
    ).toBe(false);
  });

  it('orders records by version, then lexicographic editor — deterministic ties', () => {
    const v1A: LayerRecord = { id: 'l', version: 1, editor: 'A' };
    const v2A: LayerRecord = { id: 'l', version: 2, editor: 'A' };
    const v2B: LayerRecord = { id: 'l', version: 2, editor: 'B' };
    expect(isNewerLayerRecord(v2A, v1A)).toBe(true);
    expect(isNewerLayerRecord(v1A, v2A)).toBe(false);
    expect(isNewerLayerRecord(v2B, v2A)).toBe(true);
    expect(isNewerLayerRecord(v2A, v2B)).toBe(false);
    expect(isNewerLayerRecord(v2A, v2A)).toBe(false); // equal is not newer — idempotent re-apply
  });
});

describe('isValidEnvelope layer ops', () => {
  it('accepts layer-upsert with a valid definition, version, and editor', () => {
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: 'A' },
      }),
    ).toBe(true);
  });

  it('rejects layer-upsert with malformed pieces', () => {
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'layer-upsert', layer: {}, version: 1, editor: 'A' },
      }),
    ).toBe(false);
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'layer-upsert', layer: layerDef(), version: 0, editor: 'A' },
      }),
    ).toBe(false);
    expect(
      isValidEnvelope({ from: 'A', op: { kind: 'layer-upsert', layer: layerDef(), version: 1 } }),
    ).toBe(false);
  });

  it('accepts layer-remove with id/version/editor, rejects without', () => {
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'layer-remove', id: 'l', version: 2, editor: 'A' },
      }),
    ).toBe(true);
    expect(
      isValidEnvelope({ from: 'A', op: { kind: 'layer-remove', version: 2, editor: 'A' } }),
    ).toBe(false);
    expect(isValidEnvelope({ from: 'A', op: { kind: 'layer-remove', id: 'l', editor: 'A' } })).toBe(
      false,
    );
  });

  it('accepts snapshot with a layers array by shape, rejects a non-array layers field', () => {
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'snapshot', to: 'B', elements: [], layers: [{ bogus: true }] },
      }),
    ).toBe(true);
    expect(
      isValidEnvelope({
        from: 'A',
        op: { kind: 'snapshot', to: 'B', elements: [], layers: 'nope' },
      }),
    ).toBe(false);
  });

  it('layer ops fail the pre-layer-sync envelope validator (old clients drop them)', () => {
    // Frozen copy of the isValidEnvelope switch as released in
    // @fieldnotes/sync 0.9.0 — the compatibility contract this feature relies
    // on: peers that predate layer sync must reject the new kinds outright.
    function legacyIsValidEnvelope(env: unknown): boolean {
      if (typeof env !== 'object' || env === null) return false;
      const e = env as {
        from?: unknown;
        op?: { kind?: unknown; id?: unknown; to?: unknown; elements?: unknown; element?: unknown };
      };
      if (typeof e.from !== 'string' || typeof e.op !== 'object' || e.op === null) return false;
      const op = e.op;
      switch (op.kind) {
        case 'upsert':
          return isValidElement(op.element);
        case 'remove':
          return typeof op.id === 'string';
        case 'clear':
        case 'request-snapshot':
        case 'presence':
        case 'presence-leave':
          return true;
        case 'snapshot':
          return typeof op.to === 'string' && Array.isArray(op.elements);
        default:
          return false;
      }
    }

    expect(
      legacyIsValidEnvelope({
        from: 'A',
        op: { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: 'A' },
      }),
    ).toBe(false);
    expect(
      legacyIsValidEnvelope({
        from: 'A',
        op: { kind: 'layer-remove', id: 'l', version: 2, editor: 'A' },
      }),
    ).toBe(false);
    // A snapshot that carries layers still passes the legacy validator: old
    // clients apply its elements and ignore the extra field.
    expect(
      legacyIsValidEnvelope({
        from: 'A',
        op: { kind: 'snapshot', to: 'B', elements: [], layers: [] },
      }),
    ).toBe(true);
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
      { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: 'A' },
      { kind: 'layer-remove', id: 'layer-a', version: 2, editor: 'A' },
    ];
    for (const op of ops) applyOpToMap(map, op);

    expect(map.size).toBe(1);
    expect(map.get(el.id)).toBe(el);
  });
});
