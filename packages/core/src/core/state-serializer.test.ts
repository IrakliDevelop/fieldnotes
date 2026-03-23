import { describe, it, expect } from 'vitest';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';
import { createStroke, createNote, createArrow } from '../elements/element-factory';
import type { Layer } from '../layers/types';

function makeCamera(x = 0, y = 0, zoom = 1) {
  return { position: { x, y }, zoom };
}

describe('exportState', () => {
  it('exports version, camera, and elements', () => {
    const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
    const note = createNote({ position: { x: 10, y: 20 } });
    const state = exportState([stroke, note], makeCamera(100, 200, 1.5));

    expect(state.version).toBe(2);
    expect(state.camera).toEqual({ position: { x: 100, y: 200 }, zoom: 1.5 });
    expect(state.elements).toHaveLength(2);
    expect(state.elements[0]?.type).toBe('stroke');
    expect(state.elements[1]?.type).toBe('note');
  });

  it('deep-copies elements so mutations do not affect exported state', () => {
    const stroke = createStroke({ points: [{ x: 1, y: 2, pressure: 0.5 }] });
    const state = exportState([stroke], makeCamera());

    stroke.points.push({ x: 5, y: 5, pressure: 0.5 });

    const exported = state.elements[0];
    expect(exported?.type === 'stroke' && exported.points).toHaveLength(1);
  });

  it('exports empty elements array', () => {
    const state = exportState([], makeCamera());
    expect(state.elements).toEqual([]);
  });

  it('exports layers in state', () => {
    const layers: Layer[] = [
      { id: 'L1', name: 'Layer 1', visible: true, locked: false, order: 0, opacity: 1 },
    ];
    const state = exportState([], makeCamera(), layers);
    expect(state.layers).toEqual(layers);
  });
});

describe('parseState', () => {
  function validState(): CanvasState {
    return {
      version: 2,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [
        createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }], layerId: 'default-layer' }),
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
  }

  it('parses valid JSON state', () => {
    const json = JSON.stringify(validState());
    const state = parseState(json);

    expect(state.version).toBe(2);
    expect(state.camera.zoom).toBe(1);
    expect(state.elements).toHaveLength(1);
  });

  it('round-trips through export and parse', () => {
    const layer = {
      id: 'default-layer',
      name: 'Layer 1',
      visible: true,
      locked: false,
      order: 0,
      opacity: 1,
    };
    const stroke = createStroke({
      points: [
        { x: 1, y: 2, pressure: 0.5 },
        { x: 3, y: 4, pressure: 0.8 },
      ],
      layerId: 'default-layer',
    });
    const note = createNote({
      position: { x: 10, y: 20 },
      text: 'hello',
      layerId: 'default-layer',
    });
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 50, y: 50 },
      layerId: 'default-layer',
    });

    const original = exportState([stroke, note, arrow], makeCamera(100, -50, 2), [layer]);
    const json = JSON.stringify(original);
    const restored = parseState(json);

    expect(restored).toEqual(original);
  });

  it('migrates legacy stroke points without pressure', () => {
    const data = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [
        {
          id: 'stroke_1',
          type: 'stroke',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
          color: '#000',
          width: 2,
          opacity: 1,
        },
      ],
    };
    const state = parseState(JSON.stringify(data));
    const stroke = state.elements[0];
    if (stroke?.type === 'stroke') {
      expect(stroke.points[0]?.pressure).toBe(0.5);
      expect(stroke.points[1]?.pressure).toBe(0.5);
    }
  });

  it('throws on invalid JSON', () => {
    expect(() => parseState('not json')).toThrow();
  });

  it('throws on missing version', () => {
    const data = { camera: { position: { x: 0, y: 0 }, zoom: 1 }, elements: [] };
    expect(() => parseState(JSON.stringify(data))).toThrow('version');
  });

  it('throws on missing camera', () => {
    const data = { version: 1, elements: [] };
    expect(() => parseState(JSON.stringify(data))).toThrow('camera');
  });

  it('throws on missing camera.position', () => {
    const data = { version: 1, camera: { zoom: 1 }, elements: [] };
    expect(() => parseState(JSON.stringify(data))).toThrow('position');
  });

  it('throws on invalid camera.zoom', () => {
    const data = { version: 1, camera: { position: { x: 0, y: 0 } }, elements: [] };
    expect(() => parseState(JSON.stringify(data))).toThrow('zoom');
  });

  it('throws on non-array elements', () => {
    const data = { version: 1, camera: { position: { x: 0, y: 0 }, zoom: 1 }, elements: 'bad' };
    expect(() => parseState(JSON.stringify(data))).toThrow('array');
  });

  it('throws on element with unknown type', () => {
    const data = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [{ id: '1', type: 'unknown', position: { x: 0, y: 0 }, zIndex: 0, locked: false }],
    };
    expect(() => parseState(JSON.stringify(data))).toThrow('unknown type');
  });

  it('throws on element missing id', () => {
    const data = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [{ type: 'stroke', position: { x: 0, y: 0 }, zIndex: 0, locked: false }],
    };
    expect(() => parseState(JSON.stringify(data))).toThrow('id');
  });

  it('throws on element missing zIndex', () => {
    const data = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [{ id: '1', type: 'stroke', position: { x: 0, y: 0 }, locked: false }],
    };
    expect(() => parseState(JSON.stringify(data))).toThrow('zIndex');
  });

  it('cleans stale arrow bindings on parse', () => {
    const state = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [
        {
          id: 'arrow-1',
          type: 'arrow',
          position: { x: 0, y: 0 },
          zIndex: 0,
          locked: false,
          from: { x: 0, y: 0 },
          to: { x: 100, y: 100 },
          bend: 0,
          color: '#000',
          width: 2,
          fromBinding: { elementId: 'nonexistent' },
          toBinding: { elementId: 'also-nonexistent' },
        },
      ],
    };
    const parsed = parseState(JSON.stringify(state));
    const arrow = parsed.elements[0];
    expect(arrow).toBeDefined();
    if (arrow && arrow.type === 'arrow') {
      expect(arrow.fromBinding).toBeUndefined();
      expect(arrow.toBinding).toBeUndefined();
    }
  });

  describe('layer migration', () => {
    it('adds default layer when layers array is missing', () => {
      const state = validState();
      const raw = state as Record<string, unknown>;
      delete raw['layers'];
      const json = JSON.stringify(raw);
      const parsed = parseState(json);
      expect(parsed.layers).toHaveLength(1);
      const first = parsed.layers?.[0];
      expect(first?.id).toBe('default-layer');
      expect(first?.name).toBe('Layer 1');
    });

    it('adds layerId to elements missing it', () => {
      const state = validState();
      const raw = state as Record<string, unknown>;
      delete raw['layers'];
      for (const el of state.elements) {
        const elRaw = el as Record<string, unknown>;
        delete elRaw['layerId'];
      }
      const json = JSON.stringify(raw);
      const parsed = parseState(json);
      for (const el of parsed.elements) {
        expect(el.layerId).toBe('default-layer');
      }
    });

    it('preserves existing layers array', () => {
      const state = validState();
      const raw = state as Record<string, unknown>;
      raw['layers'] = [
        { id: 'L1', name: 'Background', visible: true, locked: true, order: 0, opacity: 1 },
        { id: 'L2', name: 'Foreground', visible: true, locked: false, order: 1, opacity: 1 },
      ];
      const json = JSON.stringify(raw);
      const parsed = parseState(json);
      expect(parsed.layers).toHaveLength(2);
      const first = parsed.layers?.[0];
      expect(first?.name).toBe('Background');
    });
  });
});
