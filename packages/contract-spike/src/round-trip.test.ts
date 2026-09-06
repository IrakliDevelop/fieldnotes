/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { ElementRegistry } from './element-registry';
import {
  serializeRuntimeToWireV3,
  parseWireToRuntime,
  migrateV3toV4,
  migrateElementToV4,
  roundTrip,
} from './serializer';
import type {
  BaseElement,
  ExtensionElementEnvelope,
  ElementTypeDefinition,
  RuntimeElement,
  WireElement,
  WireElementV3,
  CanvasStateV3,
  FogStateV1,
} from './types';
import type { GridElement, TemplateElement } from '@fieldnotes/core';

// ─── Test element definitions ────────────────────────────────────────────────

interface GridData extends BaseElement {
  type: 'grid';
  cellSize: number;
  gridType: 'square' | 'hex';
}

const gridDefinition: ElementTypeDefinition<GridData> = {
  type: 'vtt:grid',
  legacyTypes: ['grid'],
  decodeLegacy: (raw) => ({
    id: raw['id'] as string,
    type: 'grid' as const,
    position: raw['position'] as { x: number; y: number },
    zIndex: raw['zIndex'] as number,
    locked: raw['locked'] as boolean,
    layerId: raw['layerId'] as string,
    cellSize: raw['cellSize'] as number,
    gridType: raw['gridType'] as 'square' | 'hex',
  }),
  encodeLegacy: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    cellSize: el.cellSize,
    gridType: el.gridType,
  }),
  validateData: (data) =>
    typeof data['cellSize'] === 'number' &&
    (data['gridType'] === 'square' || data['gridType'] === 'hex'),
  unwrap: (env) => ({
    id: env.id,
    type: 'grid' as const,
    position: env.position,
    zIndex: env.zIndex,
    locked: env.locked,
    layerId: env.layerId,
    cellSize: env.data['cellSize'] as number,
    gridType: env.data['gridType'] as 'square' | 'hex',
  }),
  wrap: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    type: 'extension',
    extensionType: 'vtt:grid',
    data: { cellSize: el.cellSize, gridType: el.gridType },
  }),
  bounds: () => null,
};

interface TemplateData extends BaseElement {
  type: 'template';
  radius: number;
  templateShape: string;
}

const templateDefinition: ElementTypeDefinition<TemplateData> = {
  type: 'vtt:template',
  legacyTypes: ['template'],
  decodeLegacy: (raw) => ({
    id: raw['id'] as string,
    type: 'template' as const,
    position: raw['position'] as { x: number; y: number },
    zIndex: raw['zIndex'] as number,
    locked: raw['locked'] as boolean,
    layerId: raw['layerId'] as string,
    radius: raw['radius'] as number,
    templateShape: raw['templateShape'] as string,
  }),
  encodeLegacy: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    radius: el.radius,
    templateShape: el.templateShape,
  }),
  validateData: (data) =>
    typeof data['radius'] === 'number' && typeof data['templateShape'] === 'string',
  unwrap: (env) => ({
    id: env.id,
    type: 'template' as const,
    position: env.position,
    zIndex: env.zIndex,
    locked: env.locked,
    layerId: env.layerId,
    radius: env.data['radius'] as number,
    templateShape: env.data['templateShape'] as string,
  }),
  wrap: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    type: 'extension',
    extensionType: 'vtt:template',
    data: { radius: el.radius, templateShape: el.templateShape },
  }),
  bounds: () => null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBaseElement(id: string): RuntimeElement {
  return {
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    size: { w: 100, h: 100 },
    text: 'test',
    backgroundColor: '#fff',
    textColor: '#000',
  };
}

function makeGridEnvelope(): ExtensionElementEnvelope {
  return {
    id: 'grid-1',
    type: 'extension',
    extensionType: 'vtt:grid',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    data: { cellSize: 50, gridType: 'hex' },
  };
}

function makeTemplateEnvelope(): ExtensionElementEnvelope {
  return {
    id: 'tmpl-1',
    type: 'extension',
    extensionType: 'vtt:template',
    position: { x: 10, y: 20 },
    zIndex: 1,
    locked: false,
    layerId: 'default',
    data: { radius: 30, templateShape: 'circle' },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('v3/v4 round-trip', () => {
  it('serializes runtime envelopes to legacy wire format', () => {
    const registry = new ElementRegistry();
    registry.register(gridDefinition);
    registry.register(templateDefinition);

    const runtime: RuntimeElement[] = [makeBaseElement('note-1'), makeGridEnvelope()];
    const wire = serializeRuntimeToWireV3(runtime, registry);

    expect(wire).toHaveLength(2);
    expect(wire[0]!.type).toBe('note');
    expect(wire[1]!.type).toBe('grid');
    expect((wire[1] as unknown as Record<string, unknown>)['cellSize']).toBe(50);
  });

  it('parses legacy wire format back to runtime envelopes', () => {
    const registry = new ElementRegistry();
    registry.register(gridDefinition);

    const wire: WireElement[] = [
      makeBaseElement('note-1'),
      {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 50,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
      },
    ];

    const runtime = parseWireToRuntime(wire, registry);
    expect(runtime).toHaveLength(2);
    expect(runtime[0]!.type).toBe('note');
    expect(runtime[1]!.type).toBe('extension');
    expect((runtime[1] as ExtensionElementEnvelope).extensionType).toBe('vtt:grid');
    expect((runtime[1] as ExtensionElementEnvelope).data['cellSize']).toBe(50);
  });

  it('round-trip preserves data', () => {
    const registry = new ElementRegistry();
    registry.register(gridDefinition);
    registry.register(templateDefinition);

    const original: RuntimeElement[] = [
      makeBaseElement('note-1'),
      makeGridEnvelope(),
      makeTemplateEnvelope(),
    ];

    const result = roundTrip(original, registry);

    expect(result).toHaveLength(3);
    expect(result[0]!.type).toBe('note');
    expect(result[1]!.type).toBe('extension');
    expect((result[1] as ExtensionElementEnvelope).data['cellSize']).toBe(50);
    expect(result[2]!.type).toBe('extension');
    expect((result[2] as ExtensionElementEnvelope).data['radius']).toBe(30);
  });
});

describe('v3→v4 migration', () => {
  it('wraps fog state in PersistedPluginState envelope', () => {
    const fogState: FogStateV1 = {
      definition: {
        version: 1,
        generation: 'gen-1',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        cellSize: 50,
        base: 'covered',
      },
      tiles: [{ x: 0, y: 0, data: 'AAAA' }],
    };

    const v3: CanvasStateV3 = {
      version: 3,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [],
      fog: fogState,
    };

    const v4 = migrateV3toV4(v3);

    expect(v4.version).toBe(4);
    expect(v4.extensions['fog']).toBeDefined();
    expect(v4.extensions['fog']!.version).toBe(1);
    expect(v4.extensions['fog']!.data).toEqual(fogState);
    expect((v3 as unknown as Record<string, unknown>)['fog']).toBeDefined();
  });

  it('handles missing fog gracefully', () => {
    const v3: CanvasStateV3 = {
      version: 3,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [],
    };

    const v4 = migrateV3toV4(v3);
    expect(v4.version).toBe(4);
    expect(Object.keys(v4.extensions)).toHaveLength(0);
  });

  it('preserves layers, active layer, and existing extension state', () => {
    const v3: CanvasStateV3 = {
      version: 3,
      camera: { position: { x: 3, y: 4 }, zoom: 2 },
      elements: [],
      layers: [
        {
          id: 'tokens',
          name: 'Tokens',
          visible: true,
          locked: false,
          order: 0,
          opacity: 1,
        },
      ],
      activeLayerId: 'tokens',
      extensions: { custom: { version: 7, data: { enabled: true } } },
    };

    const v4 = migrateV3toV4(v3);

    expect(v4.camera).toEqual(v3.camera);
    expect(v4.layers).toEqual(v3.layers);
    expect(v4.activeLayerId).toBe('tokens');
    expect(v4.extensions['custom']).toEqual({ version: 7, data: { enabled: true } });
  });

  it('does not overwrite already-migrated fog extension state', () => {
    const v3: CanvasStateV3 = {
      version: 3,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [],
      fog: {
        definition: {
          version: 1,
          generation: 'legacy',
          bounds: { x: 0, y: 0, w: 1, h: 1 },
          cellSize: 1,
          base: 'covered',
        },
        tiles: [],
      },
      extensions: { fog: { version: 2, data: { generation: 'already-migrated' } } },
    };

    expect(migrateV3toV4(v3).extensions['fog']).toEqual(v3.extensions?.['fog']);
  });

  it('migrates grid and template elements to extension envelopes', () => {
    const grid: GridElement = {
      id: 'grid-1',
      type: 'grid',
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: 'default',
      gridType: 'hex',
      hexOrientation: 'pointy',
      cellSize: 50,
      strokeColor: '#000',
      strokeWidth: 1,
      opacity: 1,
    };

    const template: TemplateElement = {
      id: 'tmpl-1',
      type: 'template',
      position: { x: 10, y: 20 },
      zIndex: 1,
      locked: false,
      layerId: 'default',
      templateShape: 'circle',
      radius: 30,
      angle: 0,
      fillColor: '#ff0000',
      strokeColor: '#000',
      strokeWidth: 1,
      opacity: 0.8,
    };

    const v3: CanvasStateV3 = {
      version: 3,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [grid, template],
    };

    const v4 = migrateV3toV4(v3);

    expect(v4.elements).toHaveLength(2);

    const gridEnv = v4.elements[0] as ExtensionElementEnvelope;
    expect(gridEnv.type).toBe('extension');
    expect(gridEnv.extensionType).toBe('vtt:grid');
    expect(gridEnv.data['cellSize']).toBe(50);
    expect(gridEnv.data['gridType']).toBe('hex');
    expect(gridEnv.data['hexOrientation']).toBe('pointy');

    const tmplEnv = v4.elements[1] as ExtensionElementEnvelope;
    expect(tmplEnv.type).toBe('extension');
    expect(tmplEnv.extensionType).toBe('vtt:template');
    expect(tmplEnv.data['radius']).toBe(30);
    expect(tmplEnv.data['templateShape']).toBe('circle');
  });

  it('migrateElementToV4 passes through non-grid/template elements unchanged', () => {
    const note: WireElementV3 = {
      id: 'note-1',
      type: 'note',
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: 'default',
      size: { w: 100, h: 100 },
      text: 'test',
      backgroundColor: '#fff',
      textColor: '#000',
    };

    const result = migrateElementToV4(note);
    expect(result).toEqual(note);
  });
});
