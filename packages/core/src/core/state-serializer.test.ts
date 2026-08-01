// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportState, parseState } from './state-serializer';
import type { CanvasState } from './state-serializer';
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
} from '../elements/element-factory';
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

  it('includes activeLayerId when provided', () => {
    const state = exportState([], makeCamera(), [], 'layer-42');
    expect(state.activeLayerId).toBe('layer-42');
  });

  it('omits activeLayerId when not provided', () => {
    const state = exportState([], makeCamera());
    expect(state.activeLayerId).toBeUndefined();
  });

  it('strips cachedControlPoint from arrow elements', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      layerId: 'default-layer',
    });
    arrow.cachedControlPoint = { x: 50, y: 50 };

    const state = exportState([arrow], makeCamera());
    const exported = state.elements[0];
    expect(exported).toBeDefined();
    if (exported) {
      expect(exported.type).toBe('arrow');
      expect('cachedControlPoint' in exported).toBe(false);
    }
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

  it('sanitizes text-element HTML during import', () => {
    const state = validState();
    const text = createText({
      position: { x: 0, y: 0 },
      text: '<b>placeholder</b>',
      layerId: 'default-layer',
    });
    text.text = '<img src="x" onerror="alert(1)"><b onclick="alert(2)">safe</b>';
    state.elements = [text];

    const parsed = parseState(JSON.stringify(state));

    const imported = parsed.elements[0];
    expect(imported?.type === 'text' && imported.text).toBe('<b>safe</b>');
  });

  it('returns activeLayerId when present in state', () => {
    const state = validState();
    (state as Record<string, unknown>).activeLayerId = 'default-layer';
    const json = JSON.stringify(state);
    const parsed = parseState(json);
    expect(parsed.activeLayerId).toBe('default-layer');
  });

  it('returns undefined activeLayerId for old state format', () => {
    const state = validState();
    const json = JSON.stringify(state);
    const parsed = parseState(json);
    expect(parsed.activeLayerId).toBeUndefined();
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

  it('rejects unsupported future versions', () => {
    const data = validState();
    data.version = 3;
    expect(() => parseState(JSON.stringify(data))).toThrow('unsupported version 3');
  });

  it.each([0, -1, 1.5])('rejects invalid version %s', (version) => {
    const data = validState();
    data.version = version;
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

  it('rejects duplicate element IDs', () => {
    const data = validState();
    const element = data.elements[0];
    if (!element) throw new Error('Test fixture must contain an element');
    data.elements.push(structuredClone(element));
    expect(() => parseState(JSON.stringify(data))).toThrow('duplicate element id');
  });

  it('rejects non-finite camera and element geometry', () => {
    const stateWithBadCamera = JSON.stringify(validState()).replace('"x":0', '"x":1e400');
    expect(() => parseState(stateWithBadCamera)).toThrow('finite');

    const stateWithBadPoint = JSON.stringify(validState()).replace(
      '"pressure":0.5',
      '"pressure":1e400',
    );
    expect(() => parseState(stateWithBadPoint)).toThrow('malformed stroke data');
  });

  it('accepts valid data for every element type', () => {
    const data = validState();
    data.elements = [
      createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }], layerId: 'default-layer' }),
      createNote({ position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, layerId: 'default-layer' }),
      createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'data:image/png;base64,',
        layerId: 'default-layer',
      }),
      createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      createText({ position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      createShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      createGrid({ layerId: 'default-layer' }),
      createTemplate({
        position: { x: 0, y: 0 },
        templateShape: 'circle',
        radius: 10,
        layerId: 'default-layer',
      }),
    ];

    expect(parseState(JSON.stringify(data)).elements).toHaveLength(9);
  });

  it.each([
    ['stroke', 'points'],
    ['note', 'size'],
    ['arrow', 'from'],
    ['image', 'src'],
    ['html', 'size'],
    ['text', 'textAlign'],
    ['shape', 'strokeWidth'],
    ['grid', 'cellSize'],
    ['template', 'radius'],
  ])('rejects malformed %s-specific data', (type, field) => {
    const data = validState();
    const elements = {
      stroke: createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }], layerId: 'default-layer' }),
      note: createNote({ position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      arrow: createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, layerId: 'default-layer' }),
      image: createImage({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'image.png',
        layerId: 'default-layer',
      }),
      html: createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      text: createText({ position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      shape: createShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      grid: createGrid({ layerId: 'default-layer' }),
      template: createTemplate({
        position: { x: 0, y: 0 },
        templateShape: 'circle',
        radius: 10,
        layerId: 'default-layer',
      }),
    };
    const element = elements[type as keyof typeof elements] as unknown as Record<string, unknown>;
    element[field] = null;
    data.elements = [element as unknown as CanvasState['elements'][number]];

    expect(() => parseState(JSON.stringify(data))).toThrow(`malformed ${type} data`);
  });

  it('preserves an arrow label across an export → parse round-trip', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 20, y: 5 }, label: 'flows to' });
    const json = JSON.stringify(exportState([arrow], makeCamera()));
    const restored = parseState(json);
    const a = restored.elements.find((e) => e.type === 'arrow');
    expect((a as { label?: string }).label).toBe('flows to');
  });

  it('preserves stroke blendMode across an export → parse round-trip', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 0, pressure: 1 },
      ],
      blendMode: 'multiply',
      layerId: 'default-layer',
    });
    const json = JSON.stringify(exportState([stroke], makeCamera()));
    const restored = parseState(json);
    const s = restored.elements.find((e) => e.type === 'stroke');
    expect((s as { blendMode?: string }).blendMode).toBe('multiply');
  });

  it('round-trips groupId on elements', () => {
    const note = createNote({ position: { x: 10, y: 20 }, layerId: 'default-layer' });
    note.groupId = 'group_abc';
    const json = JSON.stringify(exportState([note], makeCamera()));
    const restored = parseState(json);
    expect(restored.elements[0]?.groupId).toBe('group_abc');
  });

  it('round-trips rotation on elements', () => {
    const note = createNote({ position: { x: 10, y: 20 }, layerId: 'default-layer' });
    note.rotation = Math.PI / 4;
    const json = JSON.stringify(exportState([note], makeCamera()));
    const restored = parseState(json);
    expect(restored.elements[0]?.rotation).toBeCloseTo(Math.PI / 4);
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
      const element = state.elements[0];
      if (!element) throw new Error('Test fixture must contain an element');
      element.layerId = 'L1';
      const json = JSON.stringify(raw);
      const parsed = parseState(json);
      expect(parsed.layers).toHaveLength(2);
      const first = parsed.layers?.[0];
      expect(first?.name).toBe('Background');
    });

    it('rejects malformed and duplicate layers', () => {
      const nonArray = validState() as unknown as Record<string, unknown>;
      nonArray['layers'] = 'bad';
      expect(() => parseState(JSON.stringify(nonArray))).toThrow('layers must be an array');

      const malformed = validState();
      const malformedLayer = malformed.layers?.[0];
      if (!malformedLayer) throw new Error('Test fixture must contain a layer');
      malformedLayer.opacity = 2;
      expect(() => parseState(JSON.stringify(malformed))).toThrow('malformed layer');

      const duplicate = validState();
      const duplicateLayer = duplicate.layers?.[0];
      if (!duplicateLayer || !duplicate.layers)
        throw new Error('Test fixture must contain a layer');
      duplicate.layers.push(structuredClone(duplicateLayer));
      expect(() => parseState(JSON.stringify(duplicate))).toThrow('duplicate layer id');
    });

    it('rejects unknown element and active layer references', () => {
      const badElementLayer = validState();
      const element = badElementLayer.elements[0];
      if (!element) throw new Error('Test fixture must contain an element');
      element.layerId = 'missing';
      expect(() => parseState(JSON.stringify(badElementLayer))).toThrow('unknown layerId');

      const badActiveLayer = validState();
      badActiveLayer.activeLayerId = 'missing';
      expect(() => parseState(JSON.stringify(badActiveLayer))).toThrow('activeLayerId');
    });
  });

  describe('edge cases', () => {
    it('parseState handles empty elements array', () => {
      const data = {
        version: 2,
        camera: { position: { x: 0, y: 0 }, zoom: 1 },
        elements: [],
      };
      const state = parseState(JSON.stringify(data));
      expect(state.elements).toEqual([]);
      expect(state.layers).toHaveLength(1);
    });

    it('exportState with empty store produces valid state', () => {
      const state = exportState([], makeCamera());
      expect(state.version).toBe(2);
      expect(state.elements).toEqual([]);
      expect(state.camera).toEqual({ position: { x: 0, y: 0 }, zoom: 1 });

      const json = JSON.stringify(state);
      const parsed = parseState(json);
      expect(parsed.elements).toEqual([]);
    });
  });
});
