/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { ElementRegistry } from './element-registry';
import type { ElementTypeDefinition, ExtensionElementEnvelope } from './types';

// ─── Test fixture: a minimal extension element type ──────────────────────────

interface MarkerElement {
  id: string;
  type: 'marker';
  position: { x: number; y: number };
  zIndex: number;
  locked: boolean;
  layerId: string;
  label: string;
  color: string;
}

function makeMarkerEnvelope(overrides: Partial<MarkerElement> = {}): ExtensionElementEnvelope {
  return {
    id: 'marker-1',
    type: 'extension',
    extensionType: 'test:marker',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    data: { label: 'hello', color: '#ff0000' },
    ...overrides,
  };
}

const markerDefinition: ElementTypeDefinition<MarkerElement> = {
  type: 'test:marker',
  legacyTypes: ['marker'],
  decodeLegacy: (raw) => ({
    id: raw['id'] as string,
    type: 'marker',
    position: raw['position'] as { x: number; y: number },
    zIndex: raw['zIndex'] as number,
    locked: raw['locked'] as boolean,
    layerId: raw['layerId'] as string,
    label: raw['label'] as string,
    color: raw['color'] as string,
  }),
  encodeLegacy: (el) => ({
    id: el.id,
    type: 'marker',
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    label: el.label,
    color: el.color,
  }),
  validateData: (data) => typeof data['label'] === 'string' && typeof data['color'] === 'string',
  unwrap: (env) => ({
    id: env.id,
    type: 'marker',
    position: env.position,
    zIndex: env.zIndex,
    locked: env.locked,
    layerId: env.layerId,
    label: env.data['label'] as string,
    color: env.data['color'] as string,
  }),
  wrap: (el) => ({
    id: el.id,
    type: 'extension',
    extensionType: 'test:marker',
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    data: { label: el.label, color: el.color },
  }),
  bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 10, h: 10 }),
  hitTest: (el, point) => {
    return (
      point.x >= el.position.x &&
      point.x <= el.position.x + 10 &&
      point.y >= el.position.y &&
      point.y <= el.position.y + 10
    );
  },
  renderMode: 'canvas',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ElementRegistry', () => {
  describe('register', () => {
    it('returns a typed ElementTypeKey', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(key.type).toBe('test:marker');
      expect(typeof key.matches).toBe('function');
      expect(typeof key.unwrap).toBe('function');
      expect(typeof key.wrap).toBe('function');
      expect(typeof key.validateData).toBe('function');
    });

    it('throws on duplicate registration', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);

      expect(() => registry.register(markerDefinition)).toThrow(/already registered/i);
    });
  });

  describe('getAdapter', () => {
    it('returns the adapter for a registered extension type', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);

      const adapter = registry.getAdapter('test:marker');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('test:marker');
      expect(adapter!.legacyTypes).toEqual(['marker']);
    });

    it('returns undefined for unregistered type', () => {
      const registry = new ElementRegistry();
      expect(registry.getAdapter('test:nonexistent')).toBeUndefined();
    });
  });

  describe('getAdapterByLegacyType', () => {
    it('finds adapter by legacy type string', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);

      const adapter = registry.getAdapterByLegacyType('marker');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('test:marker');
    });

    it('returns undefined for unregistered legacy type', () => {
      const registry = new ElementRegistry();
      expect(registry.getAdapterByLegacyType('unknown')).toBeUndefined();
    });
  });

  describe('adapter operations', () => {
    it('validateEnvelope checks extensionType and data', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      const adapter = registry.getAdapter('test:marker')!;

      expect(adapter.validateEnvelope(makeMarkerEnvelope())).toBe(true);
      expect(adapter.validateEnvelope(makeMarkerEnvelope({ extensionType: 'other:type' }))).toBe(
        false,
      );
      expect(adapter.validateEnvelope(makeMarkerEnvelope({ data: { invalid: true } }))).toBe(false);
    });

    it('decodeLegacy converts raw fields to envelope', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      const adapter = registry.getAdapter('test:marker')!;

      const envelope = adapter.decodeLegacy({
        id: 'm-1',
        position: { x: 5, y: 10 },
        zIndex: 2,
        locked: false,
        layerId: 'default',
        label: 'test',
        color: '#00ff00',
      });

      expect(envelope.type).toBe('extension');
      expect(envelope.extensionType).toBe('test:marker');
      expect(envelope.data['label']).toBe('test');
      expect(envelope.data['color']).toBe('#00ff00');
    });

    it('encodeLegacy converts envelope to legacy wire fields', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      const adapter = registry.getAdapter('test:marker')!;

      const envelope = makeMarkerEnvelope();
      const legacy = adapter.encodeLegacy(envelope);

      expect(legacy['type']).toBe('marker');
      expect(legacy['label']).toBe('hello');
      expect(legacy['color']).toBe('#ff0000');
    });

    it('bounds delegates through unwrap', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      const adapter = registry.getAdapter('test:marker')!;

      const envelope = makeMarkerEnvelope({ position: { x: 100, y: 200 } });
      const b = adapter.bounds(envelope);

      expect(b).toEqual({ x: 100, y: 200, w: 10, h: 10 });
    });
  });

  describe('ElementTypeKey', () => {
    it('matches returns true for valid envelope', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(key.matches(makeMarkerEnvelope())).toBe(true);
    });

    it('matches returns false for wrong extensionType', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(key.matches(makeMarkerEnvelope({ extensionType: 'other:type' }))).toBe(false);
    });

    it('matches returns false for invalid data', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(key.matches(makeMarkerEnvelope({ data: { bad: true } }))).toBe(false);
    });

    it('unwrap returns typed element for valid envelope', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      const marker = key.unwrap(makeMarkerEnvelope());
      expect(marker.type).toBe('marker');
      expect(marker.label).toBe('hello');
      expect(marker.color).toBe('#ff0000');
    });

    it('unwrap throws on extensionType mismatch', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(() => key.unwrap(makeMarkerEnvelope({ extensionType: 'wrong' }))).toThrow(
        /extensionType mismatch/i,
      );
    });

    it('unwrap throws on data validation failure', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(() => key.unwrap(makeMarkerEnvelope({ data: { invalid: true } }))).toThrow(
        /validation failed/i,
      );
    });

    it('wrap converts typed element to envelope', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      const marker: MarkerElement = {
        id: 'm-1',
        type: 'marker',
        position: { x: 5, y: 10 },
        zIndex: 1,
        locked: false,
        layerId: 'default',
        label: 'wrapped',
        color: '#0000ff',
      };

      const envelope = key.wrap(marker);
      expect(envelope.type).toBe('extension');
      expect(envelope.extensionType).toBe('test:marker');
      expect(envelope.data['label']).toBe('wrapped');
      expect(envelope.data['color']).toBe('#0000ff');
    });

    it('validateData checks envelope data contents', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      expect(key.validateData({ label: 'ok', color: '#000' })).toBe(true);
      expect(key.validateData({ bad: true })).toBe(false);
    });
  });

  describe('unregister', () => {
    it('removes the type from all indexes', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);

      registry.unregister('test:marker');

      expect(registry.getAdapter('test:marker')).toBeUndefined();
      expect(registry.getAdapterByLegacyType('marker')).toBeUndefined();
    });

    it('allows re-registration after unregister', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      registry.unregister('test:marker');

      expect(() => registry.register(markerDefinition)).not.toThrow();
    });

    it('is a no-op for unregistered type', () => {
      const registry = new ElementRegistry();
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  describe('getTypes', () => {
    it('returns all registered extension type strings', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);

      expect(registry.getTypes()).toEqual(['test:marker']);
    });

    it('returns empty array when no types registered', () => {
      const registry = new ElementRegistry();
      expect(registry.getTypes()).toEqual([]);
    });
  });

  describe('round-trip', () => {
    it('wrap → unwrap preserves typed data', () => {
      const registry = new ElementRegistry();
      const key = registry.register(markerDefinition);

      const original: MarkerElement = {
        id: 'rt-1',
        type: 'marker',
        position: { x: 42, y: 84 },
        zIndex: 5,
        locked: true,
        layerId: 'bg',
        label: 'round-trip',
        color: '#abcdef',
      };

      const envelope = key.wrap(original);
      const restored = key.unwrap(envelope);

      expect(restored).toEqual(original);
    });

    it('decodeLegacy → encodeLegacy preserves legacy fields', () => {
      const registry = new ElementRegistry();
      registry.register(markerDefinition);
      const adapter = registry.getAdapter('test:marker')!;

      const legacy = {
        id: 'lr-1',
        type: 'marker',
        position: { x: 1, y: 2 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        label: 'legacy',
        color: '#123456',
      };

      const envelope = adapter.decodeLegacy(legacy);
      const reencoded = adapter.encodeLegacy(envelope);

      expect(reencoded).toEqual(legacy);
    });
  });
});
