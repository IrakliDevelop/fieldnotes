// @vitest-environment jsdom
/**
 * RollKeeper compatibility fixtures (core side).
 *
 * These tests verify what @fieldnotes/core guarantees for state persisted by
 * RollKeeper before the VTT extraction:
 *
 *   1. Legacy grid/template element types are still accepted by the validator
 *   2. Without VTT adapters registered, they pass through as-is
 *   3. The extensions field (fog plugin state) round-trips correctly
 *   4. Unknown plugin entries in extensions are tolerated
 *
 * Conversion from legacy types to extension envelopes is tested in @fieldnotes/vtt
 * (see packages/vtt/src/rollkeeper-compat.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { parseState, exportState } from '../core/state-serializer';
import type { CanvasState } from '../core/state-serializer';

function legacyState(
  elements: Record<string, unknown>[],
  extensions?: Record<string, unknown>,
): string {
  const state: Record<string, unknown> = {
    version: 3,
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    elements,
    layers: [
      { id: 'default-layer', name: 'Layer 1', visible: true, locked: false, order: 0, opacity: 1 },
    ],
    activeLayerId: 'default-layer',
  };
  if (extensions) state.extensions = extensions;
  return JSON.stringify(state);
}

describe('RollKeeper compatibility — legacy grid element', () => {
  it('accepts legacy type: "grid" in state validator', () => {
    const json = legacyState([
      {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        zIndex: -1,
        locked: true,
        layerId: 'default-layer',
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 24,
        strokeColor: '#cccccc',
        strokeWidth: 1,
        opacity: 0.5,
      },
    ]);

    const state = parseState(json);
    expect(state.elements).toHaveLength(1);
    expect(state.elements[0]?.type).toBe('grid');
  });

  it('accepts legacy hex grid', () => {
    const json = legacyState([
      {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        zIndex: -1,
        locked: true,
        layerId: 'default-layer',
        gridType: 'hex',
        hexOrientation: 'flat',
        cellSize: 40,
        strokeColor: '#aabbcc',
        strokeWidth: 2,
        opacity: 0.8,
      },
    ]);

    const state = parseState(json);
    const grid = state.elements[0] as Record<string, unknown> | undefined;
    expect(grid?.type).toBe('grid');
    expect(grid?.gridType).toBe('hex');
    expect(grid?.hexOrientation).toBe('flat');
  });
});

describe('RollKeeper compatibility — legacy template element', () => {
  it('accepts legacy type: "template" in state validator', () => {
    const json = legacyState([
      {
        id: 'tpl-1',
        type: 'template',
        position: { x: 100, y: 200 },
        zIndex: 10,
        locked: false,
        layerId: 'default-layer',
        templateShape: 'circle',
        radius: 60,
        angle: 0,
        fillColor: 'rgba(255,0,0,0.25)',
        strokeColor: '#ff0000',
        strokeWidth: 2,
        opacity: 0.8,
        feetPerCell: 5,
        radiusFeet: 30,
        renderStyle: 'cells',
      },
    ]);

    const state = parseState(json);
    expect(state.elements).toHaveLength(1);
    const tpl = state.elements[0] as Record<string, unknown> | undefined;
    expect(tpl?.type).toBe('template');
    expect(tpl?.templateShape).toBe('circle');
    expect(tpl?.radiusFeet).toBe(30);
  });
});

describe('RollKeeper compatibility — mixed legacy state', () => {
  it('loads core elements + grid + template + fog extensions together', () => {
    const json = legacyState(
      [
        {
          id: 'stroke-1',
          type: 'stroke',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          layerId: 'default-layer',
          points: [{ x: 0, y: 0, pressure: 0.5 }],
          color: '#000',
          width: 2,
          opacity: 1,
        },
        {
          id: 'grid-1',
          type: 'grid',
          position: { x: 0, y: 0 },
          zIndex: -1,
          locked: true,
          layerId: 'default-layer',
          gridType: 'square',
          hexOrientation: 'pointy',
          cellSize: 24,
          strokeColor: '#ccc',
          strokeWidth: 1,
          opacity: 0.5,
        },
        {
          id: 'tpl-1',
          type: 'template',
          position: { x: 100, y: 200 },
          zIndex: 10,
          locked: false,
          layerId: 'default-layer',
          templateShape: 'circle',
          radius: 60,
          angle: 0,
          fillColor: 'rgba(255,0,0,0.25)',
          strokeColor: '#ff0000',
          strokeWidth: 2,
          opacity: 0.8,
        },
      ],
      {
        fog: {
          version: 1,
          data: {
            definitions: [{ id: 'fog-1', viewMode: 'dm', cells: { '0,0': 1 } }],
          },
        },
      },
    );

    const state = parseState(json);

    expect(state.elements).toHaveLength(3);
    expect(state.elements[0]?.type).toBe('stroke');
    expect(state.elements[1]?.type).toBe('grid');
    expect(state.elements[2]?.type).toBe('template');
    expect(state.extensions).toBeDefined();
    expect(state.extensions?.fog).toBeDefined();
    expect(state.extensions?.fog?.version).toBe(1);
  });
});

describe('RollKeeper compatibility — fog plugin state', () => {
  it('preserves fog extension state through round-trip', () => {
    const fogState = {
      version: 1,
      data: {
        definitions: [
          {
            id: 'fog-1',
            viewMode: 'dm',
            cells: { '0,0': 1, '1,0': 1, '0,1': 0 },
          },
        ],
      },
    };

    const exported = exportState(
      [],
      { position: { x: 0, y: 0 }, zoom: 1 },
      [],
      undefined,
      undefined,
      { fog: fogState },
    );

    expect(exported.extensions).toBeDefined();
    expect(exported.extensions?.fog).toEqual(fogState);

    const reparsed = parseState(JSON.stringify(exported));
    expect(reparsed.extensions?.fog).toEqual(fogState);
  });

  it('tolerates unknown plugin entries in extensions', () => {
    const json = legacyState([], {
      fog: { version: 1, data: {} },
      someFuturePlugin: { version: 2, data: { key: 'value' } },
    });

    const state = parseState(json);
    expect(state.extensions?.fog).toBeDefined();
    expect(state.extensions?.someFuturePlugin).toBeDefined();
    expect(state.extensions?.someFuturePlugin?.version).toBe(2);
  });

  it('rejects malformed extensions', () => {
    const json = legacyState([], {
      bad: 'not an object',
    });

    expect(() => parseState(json)).toThrow('extensions.bad must be an object');
  });

  it('rejects extensions with invalid version', () => {
    const json = legacyState([], {
      bad: { version: 0, data: {} },
    });

    expect(() => parseState(json)).toThrow('extensions.bad.version must be a positive integer');
  });
});

describe('RollKeeper compatibility — extension envelope passthrough', () => {
  it('accepts extension envelope elements in state', () => {
    const state: CanvasState = {
      version: 3,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [
        {
          id: 'ext-1',
          type: 'extension',
          extensionType: 'vtt:grid',
          position: { x: 0, y: 0 },
          zIndex: -1,
          locked: true,
          layerId: 'default-layer',
          data: { gridType: 'square', cellSize: 24 },
        } as unknown as CanvasState['elements'][number],
      ],
      layers: [
        {
          id: 'default-layer',
          name: 'Layer 1',
          visible: true,
          locked: false,
          order: 0,
          opacity: 1,
        },
      ],
    };

    const parsed = parseState(JSON.stringify(state));
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]?.type).toBe('extension');
  });
});
