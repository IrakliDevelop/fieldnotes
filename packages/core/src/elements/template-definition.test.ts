/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { templateElementTypeDefinition } from './template-definition';
import { ElementRegistry } from './element-registry';
import type { TemplateElement, ExtensionElementEnvelope } from './types';

function makeTemplate(overrides: Partial<TemplateElement> = {}): TemplateElement {
  return {
    id: 'tmpl-1',
    type: 'template',
    position: { x: 100, y: 200 },
    zIndex: 1,
    locked: false,
    layerId: 'default',
    templateShape: 'circle',
    radius: 30,
    angle: 0,
    fillColor: 'rgba(255, 87, 34, 0.2)',
    strokeColor: '#FF5722',
    strokeWidth: 2,
    opacity: 0.6,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<ExtensionElementEnvelope> = {}): ExtensionElementEnvelope {
  return {
    id: 'tmpl-1',
    type: 'extension',
    extensionType: 'vtt:template',
    position: { x: 100, y: 200 },
    zIndex: 1,
    locked: false,
    layerId: 'default',
    data: {
      templateShape: 'circle',
      radius: 30,
      angle: 0,
      fillColor: 'rgba(255, 87, 34, 0.2)',
      strokeColor: '#FF5722',
      strokeWidth: 2,
      opacity: 0.6,
    },
    ...overrides,
  };
}

describe('TemplateElementTypeDefinition', () => {
  it('has correct type and legacy types', () => {
    expect(templateElementTypeDefinition.type).toBe('vtt:template');
    expect(templateElementTypeDefinition.legacyTypes).toEqual(['template']);
  });

  describe('wrap / unwrap round-trip', () => {
    it('wrap converts TemplateElement to envelope', () => {
      const tmpl = makeTemplate({ templateShape: 'cone', radius: 50 });
      const envelope = templateElementTypeDefinition.wrap(tmpl);

      expect(envelope.type).toBe('extension');
      expect(envelope.extensionType).toBe('vtt:template');
      expect(envelope.data['templateShape']).toBe('cone');
      expect(envelope.data['radius']).toBe(50);
    });

    it('unwrap converts envelope to TemplateElement', () => {
      const envelope = makeEnvelope({
        data: {
          templateShape: 'rectangle',
          radius: 60,
          angle: 1.5,
          width: 20,
          fillColor: '#ff0000',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 0.8,
        },
      });
      const tmpl = templateElementTypeDefinition.unwrap(envelope);

      expect(tmpl.type).toBe('template');
      expect(tmpl.templateShape).toBe('rectangle');
      expect(tmpl.radius).toBe(60);
      expect(tmpl.width).toBe(20);
    });

    it('round-trip preserves all fields including optionals', () => {
      const original = makeTemplate({
        templateShape: 'rectangle',
        radius: 45,
        angle: 0.5,
        width: 15,
        fillColor: '#aabbcc',
        strokeColor: '#112233',
        strokeWidth: 3,
        opacity: 0.9,
        feetPerCell: 5,
        radiusFeet: 30,
        renderStyle: 'geometric',
      });

      const envelope = templateElementTypeDefinition.wrap(original);
      const restored = templateElementTypeDefinition.unwrap(envelope);

      expect(restored).toEqual(original);
    });

    it('round-trip preserves absence of optional fields', () => {
      const original = makeTemplate();
      const envelope = templateElementTypeDefinition.wrap(original);
      const restored = templateElementTypeDefinition.unwrap(envelope);

      expect(restored.width).toBeUndefined();
      expect(restored.feetPerCell).toBeUndefined();
      expect(restored.radiusFeet).toBeUndefined();
      expect(restored.renderStyle).toBeUndefined();
    });
  });

  describe('legacy codec', () => {
    it('decodeLegacy converts raw wire fields to typed element', () => {
      const raw = {
        id: 't-1',
        position: { x: 5, y: 10 },
        zIndex: 2,
        locked: false,
        layerId: 'tokens',
        templateShape: 'cone',
        radius: 40,
        angle: 1.0,
        fillColor: '#ff0000',
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 0.5,
      };

      const tmpl = templateElementTypeDefinition.decodeLegacy(raw);

      expect(tmpl.type).toBe('template');
      expect(tmpl.templateShape).toBe('cone');
      expect(tmpl.radius).toBe(40);
    });

    it('encodeLegacy converts typed element to wire fields', () => {
      const tmpl = makeTemplate({ radius: 55 });
      const legacy = templateElementTypeDefinition.encodeLegacy(tmpl);

      expect(legacy['type']).toBe('template');
      expect(legacy['radius']).toBe(55);
      expect(legacy['templateShape']).toBe('circle');
    });

    it('legacy round-trip preserves fields', () => {
      const original = makeTemplate({
        templateShape: 'line',
        radius: 35,
        angle: 2.0,
        fillColor: '#abcdef',
        strokeColor: '#123456',
        strokeWidth: 4,
        opacity: 0.3,
      });

      const encoded = templateElementTypeDefinition.encodeLegacy(original);
      const decoded = templateElementTypeDefinition.decodeLegacy(encoded);

      expect(decoded).toEqual(original);
    });
  });

  describe('validateData', () => {
    it('accepts valid circle template data', () => {
      expect(
        templateElementTypeDefinition.validateData({
          templateShape: 'circle',
          radius: 30,
          angle: 0,
          fillColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(true);
    });

    it('accepts all valid template shapes', () => {
      for (const shape of ['circle', 'cone', 'line', 'square', 'rectangle']) {
        expect(
          templateElementTypeDefinition.validateData({
            templateShape: shape,
            radius: 10,
            angle: 0,
            fillColor: '#fff',
            strokeColor: '#000',
            strokeWidth: 1,
            opacity: 1,
          }),
        ).toBe(true);
      }
    });

    it('rejects invalid templateShape', () => {
      expect(
        templateElementTypeDefinition.validateData({
          templateShape: 'triangle',
          radius: 30,
          angle: 0,
          fillColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(false);
    });

    it('rejects non-number radius', () => {
      expect(
        templateElementTypeDefinition.validateData({
          templateShape: 'circle',
          radius: 'big',
          angle: 0,
          fillColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        }),
      ).toBe(false);
    });

    it('accepts optional renderStyle values', () => {
      for (const style of ['cells', 'geometric', undefined]) {
        expect(
          templateElementTypeDefinition.validateData({
            templateShape: 'circle',
            radius: 10,
            angle: 0,
            fillColor: '#fff',
            strokeColor: '#000',
            strokeWidth: 1,
            opacity: 1,
            renderStyle: style,
          }),
        ).toBe(true);
      }
    });

    it('rejects invalid renderStyle', () => {
      expect(
        templateElementTypeDefinition.validateData({
          templateShape: 'circle',
          radius: 10,
          angle: 0,
          fillColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
          renderStyle: 'invalid',
        }),
      ).toBe(false);
    });
  });

  describe('bounds', () => {
    it('returns finite bounds for circle template', () => {
      const tmpl = makeTemplate({
        templateShape: 'circle',
        radius: 30,
        position: { x: 100, y: 200 },
      });
      const b = templateElementTypeDefinition.bounds(tmpl);

      expect(b).toEqual({ x: 70, y: 170, w: 60, h: 60 });
    });

    it('returns finite bounds for square template', () => {
      const tmpl = makeTemplate({ templateShape: 'square', radius: 40, position: { x: 0, y: 0 } });
      const b = templateElementTypeDefinition.bounds(tmpl);

      expect(b).toEqual({ x: -20, y: -20, w: 40, h: 40 });
    });

    it('returns non-null bounds for all shapes', () => {
      for (const shape of ['circle', 'cone', 'line', 'square', 'rectangle'] as const) {
        const tmpl = makeTemplate({ templateShape: shape });
        expect(templateElementTypeDefinition.bounds(tmpl)).not.toBeNull();
      }
    });
  });

  describe('renderMode', () => {
    it('is canvas', () => {
      expect(templateElementTypeDefinition.renderMode).toBe('canvas');
    });
  });

  describe('registry integration', () => {
    it('registers and retrieves by extension type', () => {
      const registry = new ElementRegistry();
      registry.register(templateElementTypeDefinition);

      const adapter = registry.getAdapter('vtt:template');
      expect(adapter).toBeDefined();
      expect(adapter!.legacyTypes).toEqual(['template']);
    });

    it('retrieves by legacy type', () => {
      const registry = new ElementRegistry();
      registry.register(templateElementTypeDefinition);

      const adapter = registry.getAdapterByLegacyType('template');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('vtt:template');
    });

    it('adapter validates envelopes', () => {
      const registry = new ElementRegistry();
      registry.register(templateElementTypeDefinition);
      const adapter = registry.getAdapter('vtt:template')!;

      expect(adapter.validateEnvelope(makeEnvelope())).toBe(true);
      expect(adapter.validateEnvelope(makeEnvelope({ extensionType: 'wrong' }))).toBe(false);
    });

    it('adapter bounds delegates through unwrap', () => {
      const registry = new ElementRegistry();
      registry.register(templateElementTypeDefinition);
      const adapter = registry.getAdapter('vtt:template')!;

      const envelope = makeEnvelope({
        position: { x: 50, y: 50 },
        data: {
          templateShape: 'circle',
          radius: 20,
          angle: 0,
          fillColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
          opacity: 1,
        },
      });

      const b = adapter.bounds(envelope);
      expect(b).toEqual({ x: 30, y: 30, w: 40, h: 40 });
    });
  });
});
