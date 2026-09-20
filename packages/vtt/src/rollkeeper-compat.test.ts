/**
 * RollKeeper compatibility fixtures (VTT side).
 *
 * These tests verify that VTT element type adapters correctly convert between
 * legacy wire format (type: "grid"/"template") and extension envelopes.
 *
 * Core-side guarantees (legacy types accepted by validator, extensions field
 * round-trips) are tested in packages/core/src/integration/rollkeeper-compat.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ElementRegistry } from '@fieldnotes/core';
import { registerVttElementTypes } from './register';

let registry: ElementRegistry;

beforeAll(() => {
  registry = new ElementRegistry();
  registerVttElementTypes(registry);
});

describe('VTT adapter — legacy grid conversion', () => {
  it('finds grid adapter by legacy type "grid"', () => {
    const adapter = registry.getAdapterByLegacyType('grid');
    expect(adapter).toBeDefined();
    expect(adapter?.type).toBe('vtt:grid');
  });

  it('decodes legacy grid fields into extension envelope', () => {
    const adapter = registry.getAdapterByLegacyType('grid');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const legacy = {
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
    };

    const envelope = adapter.decodeLegacy(structuredClone(legacy));
    expect(envelope.type).toBe('extension');
    expect(envelope.extensionType).toBe('vtt:grid');
    expect(envelope.id).toBe('grid-1');
    expect(envelope.data.gridType).toBe('hex');
    expect(envelope.data.hexOrientation).toBe('flat');
    expect(envelope.data.cellSize).toBe(40);
    expect(envelope.data.strokeColor).toBe('#aabbcc');
  });

  it('decodeLegacy preserves all grid fields', () => {
    const adapter = registry.getAdapterByLegacyType('grid');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const original = {
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
    };

    const envelope = adapter.decodeLegacy(structuredClone(original));

    expect(envelope.type).toBe('extension');
    expect(envelope.extensionType).toBe('vtt:grid');
    expect(envelope.data.gridType).toBe('square');
    expect(envelope.data.cellSize).toBe(24);
    expect(envelope.data.strokeColor).toBe('#ccc');
  });
});

describe('VTT adapter — legacy template conversion', () => {
  it('finds template adapter by legacy type "template"', () => {
    const adapter = registry.getAdapterByLegacyType('template');
    expect(adapter).toBeDefined();
    expect(adapter?.type).toBe('vtt:template');
  });

  it('decodes legacy template fields into extension envelope', () => {
    const adapter = registry.getAdapterByLegacyType('template');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const legacy = {
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
    };

    const envelope = adapter.decodeLegacy(structuredClone(legacy));
    expect(envelope.type).toBe('extension');
    expect(envelope.extensionType).toBe('vtt:template');
    expect(envelope.id).toBe('tpl-1');
    expect(envelope.data.templateShape).toBe('circle');
    expect(envelope.data.radius).toBe(60);
    expect(envelope.data.radiusFeet).toBe(30);
    expect(envelope.data.renderStyle).toBe('cells');
  });

  it('decodeLegacy preserves all template fields including optionals', () => {
    const adapter = registry.getAdapterByLegacyType('template');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const original = {
      id: 'tpl-1',
      type: 'template',
      position: { x: 50, y: 50 },
      zIndex: 5,
      locked: false,
      layerId: 'default-layer',
      templateShape: 'rectangle',
      radius: 45,
      angle: 0.78,
      width: 30,
      fillColor: '#00ff0040',
      strokeColor: '#00ff00',
      strokeWidth: 2,
      opacity: 0.9,
      feetPerCell: 5,
      radiusFeet: 15,
      renderStyle: 'geometric',
    };

    const envelope = adapter.decodeLegacy(structuredClone(original));

    expect(envelope.type).toBe('extension');
    expect(envelope.extensionType).toBe('vtt:template');
    expect(envelope.data.templateShape).toBe('rectangle');
    expect(envelope.data.radius).toBe(45);
    expect(envelope.data.width).toBe(30);
    expect(envelope.data.renderStyle).toBe('geometric');
  });
});

describe('VTT adapter — validation', () => {
  it('validates well-formed grid envelope', () => {
    const adapter = registry.getAdapter('vtt:grid');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const envelope = {
      id: 'grid-1',
      type: 'extension' as const,
      extensionType: 'vtt:grid',
      position: { x: 0, y: 0 },
      zIndex: -1,
      locked: true,
      layerId: 'default-layer',
      data: {
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 24,
        strokeColor: '#ccc',
        strokeWidth: 1,
        opacity: 0.5,
      },
    };
    expect(adapter.validateEnvelope(envelope)).toBe(true);
  });

  it('rejects malformed grid envelope data', () => {
    const adapter = registry.getAdapter('vtt:grid');
    expect(adapter).toBeDefined();
    if (!adapter) throw new Error('adapter is not registered');

    const envelope = {
      id: 'grid-1',
      type: 'extension' as const,
      extensionType: 'vtt:grid',
      position: { x: 0, y: 0 },
      zIndex: -1,
      locked: true,
      layerId: 'default-layer',
      data: { gridType: 'invalid' },
    };
    expect(adapter.validateEnvelope(envelope)).toBe(false);
  });
});
