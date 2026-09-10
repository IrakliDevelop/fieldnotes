// @vitest-environment jsdom
/**
 * RollKeeper compatibility fixtures (core side).
 *
 * These tests verify what @fieldnotes/core guarantees for state persisted by
 * RollKeeper before the VTT extraction:
 *
 *   1. Legacy grid/template element types require the VTT adapters
 *   2. Core never leaks VTT-shaped elements into the v4 model
 *   3. The extensions field (fog plugin state) round-trips correctly
 *   4. Unknown plugin entries in extensions are tolerated
 *
 * Conversion from legacy types to extension envelopes is tested in @fieldnotes/vtt
 * (see packages/vtt/src/rollkeeper-compat.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { parseState, exportState } from '../core/state-serializer';
import type { ImportableCanvasState } from '../core/state-serializer';

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
  it('requires a VTT adapter instead of leaking a legacy grid into core', () => {
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

    expect(() => parseState(json)).toThrow(
      'Cannot migrate legacy element type "grid" without a registered adapter',
    );
  });

  it('also rejects legacy hex grids without a VTT adapter', () => {
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

    expect(() => parseState(json)).toThrow(
      'Cannot migrate legacy element type "grid" without a registered adapter',
    );
  });
});

describe('RollKeeper compatibility — legacy template element', () => {
  it('requires a VTT adapter instead of leaking a legacy template into core', () => {
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

    expect(() => parseState(json)).toThrow(
      'Cannot migrate legacy element type "template" without a registered adapter',
    );
  });
});

describe('RollKeeper compatibility — mixed legacy state', () => {
  it('fails transactionally before returning a partially migrated state', () => {
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

    expect(() => parseState(json)).toThrow(
      'Cannot migrate legacy element type "grid" without a registered adapter',
    );
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

    const exported = exportState([], { position: { x: 0, y: 0 }, zoom: 1 }, [], undefined, {
      fog: fogState,
    });

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
    const state: ImportableCanvasState = {
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
        } as unknown as ImportableCanvasState['elements'][number],
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
