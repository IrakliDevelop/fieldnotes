/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { gridElementTypeDefinition } from './grid-definition';
import { ElementRegistry } from './element-registry';
import type { GridElement, ExtensionElementEnvelope } from './types';

function makeGrid(overrides: Partial<GridElement> = {}): GridElement {
  return {
    id: 'grid-1',
    type: 'grid',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    gridType: 'square',
    hexOrientation: 'pointy',
    cellSize: 40,
    strokeColor: '#000000',
    strokeWidth: 1,
    opacity: 1,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<ExtensionElementEnvelope> = {}): ExtensionElementEnvelope {
  return {
    id: 'grid-1',
    type: 'extension',
    extensionType: 'vtt:grid',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    data: {
      gridType: 'square',
      hexOrientation: 'pointy',
      cellSize: 40,
      strokeColor: '#000000',
      strokeWidth: 1,
      opacity: 1,
    },
    ...overrides,
  };
}

describe('GridElementTypeDefinition', () => {
  it('has correct type and legacy types', () => {
    expect(gridElementTypeDefinition.type).toBe('vtt:grid');
    expect(gridElementTypeDefinition.legacyTypes).toEqual(['grid']);
  });

  describe('wrap / unwrap round-trip', () => {
    it('wrap converts GridElement to envelope', () => {
      const grid = makeGrid({ cellSize: 50, gridType: 'hex' });
      const envelope = gridElementTypeDefinition.wrap(grid);

      expect(envelope.type).toBe('extension');
      expect(envelope.extensionType).toBe('vtt:grid');
      expect(envelope.data['gridType']).toBe('hex');
      expect(envelope.data['cellSize']).toBe(50);
    });

    it('unwrap converts envelope to GridElement', () => {
      const envelope = makeEnvelope({
        data: {
          gridType: 'hex',
          hexOrientation: 'flat',
          cellSize: 60,
          strokeColor: '#fff',
          strokeWidth: 2,
          opacity: 0.5,
        },
      });
      const grid = gridElementTypeDefinition.unwrap(envelope);

      expect(grid.type).toBe('grid');
      expect(grid.gridType).toBe('hex');
      expect(grid.hexOrientation).toBe('flat');
      expect(grid.cellSize).toBe(60);
    });

    it('round-trip preserves all fields', () => {
      const original = makeGrid({
        gridType: 'hex',
        hexOrientation: 'flat',
        cellSize: 55,
        strokeColor: '#aabbcc',
        strokeWidth: 3,
        opacity: 0.7,
      });

      const envelope = gridElementTypeDefinition.wrap(original);
      const restored = gridElementTypeDefinition.unwrap(envelope);

      expect(restored).toEqual(original);
    });
  });

  describe('legacy codec', () => {
    it('decodeLegacy converts raw wire fields to typed element', () => {
      const raw = {
        id: 'g-1',
        position: { x: 10, y: 20 },
        zIndex: 5,
        locked: true,
        layerId: 'bg',
        gridType: 'hex',
        hexOrientation: 'flat',
        cellSize: 80,
        strokeColor: '#ff0000',
        strokeWidth: 2,
        opacity: 0.8,
      };

      const grid = gridElementTypeDefinition.decodeLegacy(raw);

      expect(grid.type).toBe('grid');
      expect(grid.gridType).toBe('hex');
      expect(grid.cellSize).toBe(80);
      expect(grid.position).toEqual({ x: 10, y: 20 });
    });

    it('encodeLegacy converts typed element to wire fields', () => {
      const grid = makeGrid({ cellSize: 100 });
      const legacy = gridElementTypeDefinition.encodeLegacy(grid);

      expect(legacy['type']).toBe('grid');
      expect(legacy['cellSize']).toBe(100);
      expect(legacy['gridType']).toBe('square');
    });

    it('legacy round-trip preserves fields', () => {
      const original = makeGrid({
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 45,
        strokeColor: '#123456',
        strokeWidth: 2,
        opacity: 0.9,
      });

      const encoded = gridElementTypeDefinition.encodeLegacy(original);
      const decoded = gridElementTypeDefinition.decodeLegacy(encoded);

      expect(decoded).toEqual(original);
    });
  });

  describe('validateData', () => {
    it('accepts valid grid data', () => {
      expect(
        gridElementTypeDefinition.validateData({
          gridType: 'square',
          hexOrientation: 'pointy',
          cellSize: 40,
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(true);
    });

    it('accepts hex grid data', () => {
      expect(
        gridElementTypeDefinition.validateData({
          gridType: 'hex',
          hexOrientation: 'flat',
          cellSize: 50,
          strokeColor: '#fff',
          strokeWidth: 2,
          opacity: 0.5,
        }),
      ).toBe(true);
    });

    it('rejects missing gridType', () => {
      expect(
        gridElementTypeDefinition.validateData({
          hexOrientation: 'pointy',
          cellSize: 40,
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(false);
    });

    it('rejects invalid gridType', () => {
      expect(
        gridElementTypeDefinition.validateData({
          gridType: 'triangle',
          hexOrientation: 'pointy',
          cellSize: 40,
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(false);
    });

    it('rejects non-number cellSize', () => {
      expect(
        gridElementTypeDefinition.validateData({
          gridType: 'square',
          hexOrientation: 'pointy',
          cellSize: 'big',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(false);
    });
  });

  describe('bounds', () => {
    it('returns null (grid has no finite bounds)', () => {
      const grid = makeGrid();
      expect(gridElementTypeDefinition.bounds(grid)).toBeNull();
    });
  });

  describe('renderMode', () => {
    it('is canvas', () => {
      expect(gridElementTypeDefinition.renderMode).toBe('canvas');
    });
  });

  describe('registry integration', () => {
    it('registers and retrieves by extension type', () => {
      const registry = new ElementRegistry();
      registry.register(gridElementTypeDefinition);

      const adapter = registry.getAdapter('vtt:grid');
      expect(adapter).toBeDefined();
      expect(adapter!.legacyTypes).toEqual(['grid']);
    });

    it('retrieves by legacy type', () => {
      const registry = new ElementRegistry();
      registry.register(gridElementTypeDefinition);

      const adapter = registry.getAdapterByLegacyType('grid');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('vtt:grid');
    });

    it('adapter validates envelopes', () => {
      const registry = new ElementRegistry();
      registry.register(gridElementTypeDefinition);
      const adapter = registry.getAdapter('vtt:grid')!;

      expect(adapter.validateEnvelope(makeEnvelope())).toBe(true);
      expect(adapter.validateEnvelope(makeEnvelope({ extensionType: 'wrong' }))).toBe(false);
    });

    it('adapter decodeLegacy produces valid envelope', () => {
      const registry = new ElementRegistry();
      registry.register(gridElementTypeDefinition);
      const adapter = registry.getAdapter('vtt:grid')!;

      const envelope = adapter.decodeLegacy({
        id: 'g-1',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 40,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
      });

      expect(envelope.type).toBe('extension');
      expect(envelope.extensionType).toBe('vtt:grid');
      expect(adapter.validateEnvelope(envelope)).toBe(true);
    });
  });
});
