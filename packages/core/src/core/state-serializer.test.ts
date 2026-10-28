// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  exportState,
  migrateElementData,
  migrateState,
  parseState,
  registerLegacyStateMigrator,
  unregisterLegacyStateMigrator,
} from './state-serializer';
import type { CanvasState, ImportableCanvasState, LegacyStateMigrator } from './state-serializer';
import { ElementStore } from '../elements/element-store';
import { pickBaseFields } from '../elements/base-fields';
import {
  createArrow,
  createHtmlElement,
  createImage,
  createNote,
  createShape,
  createStroke,
  createText,
} from '../elements/element-factory';
import type { Layer } from '../layers/types';
import { ElementRegistry } from '../elements/element-registry';
import { Viewport } from '../canvas/viewport';
import { getDefaultElementRegistry, setDefaultElementRegistry } from '../elements/default-registry';
import type { BaseElement, CanvasElement, ElementTypeDefinition } from '../elements/types';

interface LegacyMarker extends BaseElement {
  type: 'marker';
  label: string;
}

const markerDefinition: ElementTypeDefinition<LegacyMarker> = {
  type: 'test:marker',
  legacyTypes: ['marker'],
  decodeLegacy: (raw) => ({
    ...pickBaseFields(raw as unknown as BaseElement),
    type: 'marker',
    label: raw['label'] as string,
  }),
  validateData: (data) => typeof data['label'] === 'string',
  unwrap: (envelope) => ({
    ...pickBaseFields(envelope),
    type: 'marker',
    label: envelope.data['label'] as string,
  }),
  wrap: (element) => ({
    ...pickBaseFields(element),
    type: 'extension',
    extensionType: 'test:marker',
    data: { label: element.label },
  }),
  bounds: () => null,
};

function makeCamera(x = 0, y = 0, zoom = 1) {
  return { position: { x, y }, zoom };
}

describe('exportState', () => {
  it('exports version, camera, and elements', () => {
    const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
    const note = createNote({ position: { x: 10, y: 20 } });
    const state = exportState([stroke, note], makeCamera(100, 200, 1.5));

    expect(state.version).toBe(6);
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

  it('exportState omits transient html elements', () => {
    const normal = createHtmlElement({
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      layerId: 'default-layer',
    });
    const transient = createHtmlElement({
      position: { x: 20, y: 20 },
      size: { w: 10, h: 10 },
      layerId: 'default-layer',
      transient: true,
    });

    const state = exportState([normal, transient], makeCamera());

    expect(state.elements).toHaveLength(1);
    expect(state.elements[0]?.id).toBe(normal.id);
  });
});

describe('parseState', () => {
  function validState(): CanvasState {
    return {
      version: 6,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [
        createStroke({
          index: 'a0',
          points: [{ x: 0, y: 0, pressure: 0.5 }],
          layerId: 'default-layer',
        }),
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

    expect(state.version).toBe(6);
    expect(state.camera.zoom).toBe(1);
    expect(state.elements).toHaveLength(1);
  });

  it('retains a valid v6 parent relationship regardless of element order', () => {
    const state = validState();
    const source = createStroke({
      index: 'a0',
      points: [{ x: 0, y: 0, pressure: 0.5 }],
      layerId: 'default-layer',
    });
    const parent = { ...source, id: 'parent' };
    const child = { ...source, id: 'child', index: 'a1', parentId: 'parent' };
    state.elements = [child, parent];

    expect(parseState(JSON.stringify(state)).elements[0]).toMatchObject({
      id: 'child',
      parentId: 'parent',
    });
  });

  it('parseState accepts an html element carrying transient', () => {
    const data = validState();
    const html = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      layerId: 'default-layer',
      transient: true,
    });
    data.elements = [html];

    const state = parseState(JSON.stringify(data));

    expect(state.elements).toHaveLength(1);
    const parsed = state.elements[0];
    expect(parsed?.type).toBe('html');
    expect(parsed?.type === 'html' && parsed.transient).toBe(true);
  });

  it('rejects an html element whose transient is not a boolean', () => {
    const data = validState();
    const html = createHtmlElement({
      index: 'a0',
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      layerId: 'default-layer',
    }) as unknown as Record<string, unknown>;
    html['transient'] = 'yes';
    data.elements = [html as unknown as CanvasState['elements'][number]];

    expect(() => parseState(JSON.stringify(data))).toThrow('malformed html data');
  });

  it('migrates registered legacy element types without domain knowledge in core', () => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const data = {
      ...validState(),
      version: 4,
      elements: [
        {
          id: 'marker-1',
          type: 'marker',
          position: { x: 10, y: 20 },
          zIndex: 1,
          locked: false,
          layerId: 'default-layer',
          label: 'hello',
        },
      ],
    };

    const state = parseState(JSON.stringify(data), registry);

    expect(state).toMatchObject({
      version: 6,
      elements: [
        {
          id: 'marker-1',
          type: 'extension',
          extensionType: 'test:marker',
          data: { label: 'hello' },
        },
      ],
    });
  });

  it('rejects malformed registered legacy data before migration mutates state', () => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const data = {
      ...validState(),
      version: 4,
      elements: [
        {
          id: 'marker-1',
          type: 'marker',
          position: { x: 10, y: 20 },
          zIndex: 1,
          locked: false,
          layerId: 'default-layer',
          label: 42,
        },
      ],
    };

    expect(() => parseState(JSON.stringify(data), registry)).toThrow('malformed marker data');
  });

  it('rejects a v4 extension envelope whose registered adapter finds the data malformed', () => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const data = validState();
    data.elements = [
      {
        id: 'marker-1',
        type: 'extension',
        extensionType: 'test:marker',
        position: { x: 10, y: 20 },
        index: 'a1',
        version: 1,
        locked: false,
        layerId: 'default-layer',
        data: { label: 42 },
      },
    ];

    expect(() => parseState(JSON.stringify(data), registry)).toThrow('malformed test:marker data');
  });

  it('preserves a v4 extension envelope with no registered adapter', () => {
    const data = validState();
    data.elements = [
      {
        id: 'unknown-1',
        type: 'extension',
        extensionType: 'app:unknown',
        position: { x: 10, y: 20 },
        index: 'a1',
        version: 1,
        locked: false,
        layerId: 'default-layer',
        data: { anything: true },
      },
    ];

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseState(JSON.stringify(data), new ElementRegistry()).elements).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"app:unknown"'));
    warn.mockRestore();
  });

  it.each([
    ['absent', undefined, true],
    ['{w: 10, h: 5}', { w: 10, h: 5 }, true],
    ["{w: 'a'}", { w: 'a' }, false],
    ['{w: 10} without h', { w: 10 }, false],
    ['null', null, false],
  ])('validates an extension envelope size that is %s', (_, size, valid) => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const data = {
      ...validState(),
      elements: [
        {
          id: 'marker-1',
          type: 'extension',
          extensionType: 'test:marker',
          position: { x: 10, y: 20 },
          index: 'a1',
          version: 1,
          locked: false,
          layerId: 'default-layer',
          data: { label: 'hi' },
          size,
        },
      ],
    };

    const parse = () => parseState(JSON.stringify(data), registry);
    if (valid) expect(parse().elements).toHaveLength(1);
    else expect(parse).toThrow('malformed extension data');
  });

  it('warns once per unknown extension type per parse and keeps the elements', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unknown = (id: string, extensionType: string) => ({
      id,
      type: 'extension' as const,
      extensionType,
      position: { x: 0, y: 0 },
      index: 'a1',
      version: 1,
      locked: false,
      layerId: 'default-layer',
      data: {},
    });
    const data = validState();
    data.elements = [unknown('a', 'app:one'), unknown('b', 'app:one'), unknown('c', 'app:two')];
    const json = JSON.stringify(data);

    expect(parseState(json, new ElementRegistry()).elements).toHaveLength(3);
    parseState(json, new ElementRegistry());

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[fieldnotes] Unknown extension element type "app:one" kept without validation',
      '[fieldnotes] Unknown extension element type "app:two" kept without validation',
      '[fieldnotes] Unknown extension element type "app:one" kept without validation',
      '[fieldnotes] Unknown extension element type "app:two" kept without validation',
    ]);
    warn.mockRestore();
  });

  it('sanitizes text-element HTML during import', () => {
    const state = validState();
    const text = createText({
      index: 'a0',
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
    state.activeLayerId = 'default-layer';
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
      index: 'a0',
      points: [
        { x: 1, y: 2, pressure: 0.5 },
        { x: 3, y: 4, pressure: 0.8 },
      ],
      layerId: 'default-layer',
    });
    const note = createNote({
      index: 'a0',
      position: { x: 10, y: 20 },
      text: 'hello',
      layerId: 'default-layer',
    });
    const arrow = createArrow({
      index: 'a0',
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
    (data as { version: number }).version = 7;
    expect(() => parseState(JSON.stringify(data))).toThrow('unsupported version 7');
  });

  it.each([0, -1, 1.5])('rejects invalid version %s', (version) => {
    const data = validState();
    (data as { version: number }).version = version;
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

  it('throws on an unregistered legacy element type', () => {
    const data = {
      version: 1,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [{ id: '1', type: 'unknown', position: { x: 0, y: 0 }, zIndex: 0, locked: false }],
    };
    expect(() => parseState(JSON.stringify(data))).toThrow('without a registered adapter');
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
      createStroke({
        index: 'a0',
        points: [{ x: 0, y: 0, pressure: 0.5 }],
        layerId: 'default-layer',
      }),
      createNote({ index: 'a0', position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      createArrow({
        index: 'a0',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        layerId: 'default-layer',
      }),
      createImage({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'data:image/png;base64,',
        layerId: 'default-layer',
      }),
      createHtmlElement({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      createText({ index: 'a0', position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      createShape({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
    ];

    expect(parseState(JSON.stringify(data)).elements).toHaveLength(7);
  });

  it.each([
    ['stroke', 'points'],
    ['note', 'size'],
    ['arrow', 'from'],
    ['image', 'src'],
    ['html', 'size'],
    ['text', 'textAlign'],
    ['shape', 'strokeWidth'],
  ])('rejects malformed %s-specific data', (type, field) => {
    const data = validState();
    const elements = {
      stroke: createStroke({
        index: 'a0',
        points: [{ x: 0, y: 0, pressure: 0.5 }],
        layerId: 'default-layer',
      }),
      note: createNote({ index: 'a0', position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      arrow: createArrow({
        index: 'a0',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        layerId: 'default-layer',
      }),
      image: createImage({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        src: 'image.png',
        layerId: 'default-layer',
      }),
      html: createHtmlElement({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
      text: createText({ index: 'a0', position: { x: 0, y: 0 }, layerId: 'default-layer' }),
      shape: createShape({
        index: 'a0',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        layerId: 'default-layer',
      }),
    };
    const element = elements[type as keyof typeof elements] as unknown as Record<string, unknown>;
    element[field] = null;
    data.elements = [element as unknown as CanvasState['elements'][number]];

    expect(() => parseState(JSON.stringify(data))).toThrow(`malformed ${type} data`);
  });

  it('preserves an arrow label across an export → parse round-trip', () => {
    const arrow = createArrow({
      index: 'a0',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 5 },
      label: 'flows to',
    });
    const json = JSON.stringify(exportState([arrow], makeCamera()));
    const restored = parseState(json);
    const a = restored.elements.find((e) => e.type === 'arrow');
    expect((a as { label?: string }).label).toBe('flows to');
  });

  it('preserves stroke blendMode across an export → parse round-trip', () => {
    const stroke = createStroke({
      index: 'a0',
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
    const note = createNote({ index: 'a0', position: { x: 10, y: 20 }, layerId: 'default-layer' });
    note.groupId = 'group_abc';
    const json = JSON.stringify(exportState([note], makeCamera()));
    const restored = parseState(json);
    expect(restored.elements[0]?.groupId).toBe('group_abc');
  });

  it('round-trips rotation on elements', () => {
    const note = createNote({ index: 'a0', position: { x: 10, y: 20 }, layerId: 'default-layer' });
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
      delete state.layers;
      const json = JSON.stringify(state);
      const parsed = parseState(json);
      expect(parsed.layers).toHaveLength(1);
      const first = parsed.layers?.[0];
      expect(first?.id).toBe('default-layer');
      expect(first?.name).toBe('Layer 1');
    });

    it('adds layerId to elements missing it', () => {
      const state = validState();
      delete state.layers;
      const rawElements = state.elements.map((el) => {
        const raw: Partial<CanvasElement> = { ...el };
        delete raw.layerId;
        return raw;
      });
      const json = JSON.stringify({ ...state, elements: rawElements });
      const parsed = parseState(json);
      for (const el of parsed.elements) {
        expect(el.layerId).toBe('default-layer');
      }
    });

    it('preserves existing layers array', () => {
      const state = validState();
      state.layers = [
        { id: 'L1', name: 'Background', visible: true, locked: true, order: 0, opacity: 1 },
        { id: 'L2', name: 'Foreground', visible: true, locked: false, order: 1, opacity: 1 },
      ];
      const element = state.elements[0];
      if (!element) throw new Error('Test fixture must contain an element');
      element.layerId = 'L1';
      const json = JSON.stringify(state);
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
      expect(state.version).toBe(6);
      expect(state.elements).toEqual([]);
      expect(state.camera).toEqual({ position: { x: 0, y: 0 }, zoom: 1 });

      const json = JSON.stringify(state);
      const parsed = parseState(json);
      expect(parsed.elements).toEqual([]);
    });
  });

  describe('extensions', () => {
    it('exportState includes extensions when provided', () => {
      const extensions = {
        somePlugin: { version: 1, data: { definition: { version: 1 }, tiles: [] } },
      };
      const state = exportState([], makeCamera(), [], undefined, extensions);
      expect(state.extensions).toEqual(extensions);
    });

    it('exportState omits extensions when empty', () => {
      const state = exportState([], makeCamera(), [], undefined, {});
      expect(state.extensions).toBeUndefined();
    });

    it('exportState omits extensions when not provided', () => {
      const state = exportState([], makeCamera());
      expect(state.extensions).toBeUndefined();
    });

    it('exportState deep-copies extensions', () => {
      const extensions = { somePlugin: { version: 1, data: { foo: 'bar' } } };
      const state = exportState([], makeCamera(), [], undefined, extensions);
      extensions.somePlugin.data = { foo: 'mutated' };
      const pluginData = state.extensions?.somePlugin?.data as { foo: string } | undefined;
      expect(pluginData?.foo).toBe('bar');
    });

    it('parseState preserves extensions field', () => {
      const data = {
        version: 3,
        camera: { position: { x: 0, y: 0 }, zoom: 1 },
        elements: [],
        extensions: { somePlugin: { version: 1, data: { some: 'state' } } },
      };
      const state = parseState(JSON.stringify(data));
      expect(state.extensions).toEqual({ somePlugin: { version: 1, data: { some: 'state' } } });
    });

    it('parseState preserves unknown plugin extensions', () => {
      const data = {
        version: 3,
        camera: { position: { x: 0, y: 0 }, zoom: 1 },
        elements: [],
        extensions: {
          unknownPlugin: { version: 2, data: { custom: true } },
        },
      };
      const state = parseState(JSON.stringify(data));
      expect(state.extensions?.['unknownPlugin']).toEqual({
        version: 2,
        data: { custom: true },
      });
    });

    it('parseState rejects non-object extensions', () => {
      const data = {
        version: 3,
        camera: { position: { x: 0, y: 0 }, zoom: 1 },
        elements: [],
        extensions: 'bad',
      };
      expect(() => parseState(JSON.stringify(data))).toThrow('extensions must be an object');
    });

    it('roundtrip: extensions survive JSON serialize/parse', () => {
      const extensions = {
        somePlugin: { version: 1, data: { definition: { version: 1 }, tiles: [] } },
        other: { version: 3, data: [1, 2, 3] },
      };
      const exported = exportState([], makeCamera(), [], undefined, extensions);
      const json = JSON.stringify(exported);
      const parsed = parseState(json);
      expect(parsed.extensions).toEqual(extensions);
    });

    it('writes fog plugin state only in the v4 extensions envelope', () => {
      const fog = { definition: { version: 1 }, tiles: [] };
      const state = exportState([], makeCamera(), [], undefined, {
        fog: { version: 1, data: fog },
      });

      expect(state.extensions?.['fog']).toEqual({ version: 1, data: fog });
      expect('fog' in state).toBe(false);
    });

    it('lets registered legacy state migrators inspect and remove arbitrary primitive fields', () => {
      const migrated: unknown[] = [];
      const migrator: LegacyStateMigrator = (legacy) => {
        migrated.push(legacy);
        if ('legacyMarker' in legacy) {
          legacy.extensions ??= {};
          legacy.extensions['test'] = { version: 1, data: legacy.legacyMarker };
          delete legacy.legacyMarker;
        }
      };

      registerLegacyStateMigrator(migrator);
      try {
        const state = parseState(
          JSON.stringify({
            version: 3,
            camera: { position: { x: 0, y: 0 }, zoom: 1 },
            elements: [],
            legacyMarker: 42,
          }),
        );

        expect(migrated).toHaveLength(1);
        expect(state.extensions?.['test']).toEqual({ version: 1, data: 42 });
        expect('legacyMarker' in state).toBe(false);
      } finally {
        unregisterLegacyStateMigrator(migrator);
      }
    });
  });
});

describe('extension dataVersion', () => {
  const layer: Layer = {
    id: 'default-layer',
    name: 'Layer 1',
    visible: true,
    locked: false,
    order: 0,
    opacity: 1,
  };

  function envelope(data: Record<string, unknown>, dataVersion?: unknown) {
    return {
      id: 'm1',
      type: 'extension',
      extensionType: 'test:marker',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: 'default-layer',
      data,
      ...(dataVersion === undefined ? {} : { dataVersion }),
    };
  }

  function stateJson(el: unknown): string {
    return JSON.stringify({
      version: 5,
      camera: { position: { x: 0, y: 0 }, zoom: 1 },
      elements: [el],
      layers: [layer],
    });
  }

  // v1/v2 data stored `name`; v3 renamed it to `label`, which validateData requires.
  function versionedRegistry() {
    const migrate = vi.fn((data: Record<string, unknown>, from: number) => ({
      label: `${String(data['name'])}@${from}`,
    }));
    const registry = new ElementRegistry();
    registry.register({ ...markerDefinition, dataVersion: 3, migrate });
    return { registry, migrate };
  }

  it('migrates an envelope without dataVersion from 1 and stamps the current version', () => {
    const { registry, migrate } = versionedRegistry();

    const state = parseState(stateJson(envelope({ name: 'a' })), registry);

    expect(migrate.mock.calls).toEqual([[{ name: 'a' }, 1]]);
    expect(state.elements[0]).toMatchObject({ dataVersion: 3, data: { label: 'a@1' } });
  });

  it('migrates an envelope at dataVersion 2 from 2', () => {
    const { registry, migrate } = versionedRegistry();

    const state = parseState(stateJson(envelope({ name: 'b' }, 2)), registry);

    expect(migrate.mock.calls).toEqual([[{ name: 'b' }, 2]]);
    expect(state.elements[0]).toMatchObject({ dataVersion: 3, data: { label: 'b@2' } });
  });

  it.each([3, 4])('leaves an envelope at dataVersion %s untouched', (dataVersion) => {
    const { registry, migrate } = versionedRegistry();

    const state = parseState(stateJson(envelope({ label: 'c' }, dataVersion)), registry);

    expect(migrate).not.toHaveBeenCalled();
    expect(state.elements[0]).toMatchObject({ dataVersion, data: { label: 'c' } });
  });

  it('throws when migrate throws', () => {
    const registry = new ElementRegistry();
    registry.register({
      ...markerDefinition,
      dataVersion: 2,
      migrate: () => {
        throw new Error('cannot migrate');
      },
    });

    expect(() => parseState(stateJson(envelope({ name: 'a' })), registry)).toThrow(
      'cannot migrate',
    );
  });

  it.each([0, 1.5, '2', -1])('rejects dataVersion %j as an invalid element', (dataVersion) => {
    const { registry } = versionedRegistry();

    expect(() => parseState(stateJson(envelope({ label: 'x' }, dataVersion)), registry)).toThrow(
      'Invalid element "m1"',
    );
  });

  it.each([0, 1.5, '2', -1])(
    'migrateState rejects dataVersion %j as an invalid element',
    (dataVersion) => {
      const { registry } = versionedRegistry();
      const state = JSON.parse(stateJson(envelope({ label: 'x' }, dataVersion))) as CanvasState;

      expect(() => migrateState(state, registry)).toThrow(
        'Invalid element "m1": invalid dataVersion',
      );
    },
  );

  it('leaves unversioned types unchanged and unstamped', () => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);

    const state = parseState(stateJson(envelope({ label: 'x' })), registry);

    expect(state.elements[0]).toEqual(envelope({ label: 'x' }));
  });

  it('exportState stamps the current dataVersion without mutating the input', () => {
    const { registry } = versionedRegistry();
    const input = envelope({ label: 'x' }) as CanvasElement;

    const state = exportState([input], makeCamera(), [layer], undefined, undefined, registry);

    expect(state.elements[0]).toEqual({ ...envelope({ label: 'x' }), dataVersion: 3 });
    expect(input).toEqual(envelope({ label: 'x' }));
  });

  it('exportState keeps an existing dataVersion and leaves unversioned or unregistered envelopes unchanged', () => {
    const { registry } = versionedRegistry();
    registry.register({ ...markerDefinition, type: 'test:plain', legacyTypes: [] });
    const own = envelope({ label: 'x' }, 4) as CanvasElement;
    const plain = { ...envelope({ label: 'y' }), id: 'p1', extensionType: 'test:plain' };
    const unknown = { ...envelope({ any: 1 }), id: 'u1', extensionType: 'app:unknown' };

    const state = exportState(
      [own, plain as CanvasElement, unknown as CanvasElement],
      makeCamera(),
      [layer],
      undefined,
      undefined,
      registry,
    );

    expect(state.elements).toEqual([own, plain, unknown]);
  });

  it('a parse of an exported in-memory envelope does not migrate it', () => {
    const { registry, migrate } = versionedRegistry();
    const current = envelope({ label: 'x' }) as CanvasElement;

    const exported = exportState([current], makeCamera(), [layer], undefined, undefined, registry);
    const reparsed = parseState(JSON.stringify(exported), registry);

    expect(migrate).not.toHaveBeenCalled();
    expect(reparsed.elements[0]).toMatchObject({ dataVersion: 3, data: { label: 'x' } });
  });

  it('rejects a migrate result that is not a record as malformed data', () => {
    const registry = new ElementRegistry();
    registry.register({
      ...markerDefinition,
      dataVersion: 2,
      migrate: () => 'oops' as unknown as Record<string, unknown>,
      validateData: () => true,
    });

    expect(() => parseState(stateJson(envelope({ name: 'a' })), registry)).toThrow(
      'Invalid element "m1": malformed test:marker data',
    );
  });

  it('names the element when migrate throws', () => {
    const registry = new ElementRegistry();
    registry.register({
      ...markerDefinition,
      dataVersion: 2,
      migrate: () => {
        throw new Error('boom');
      },
    });

    expect(() => parseState(stateJson(envelope({ name: 'a' })), registry)).toThrow(
      /Invalid element "m1".*boom/,
    );
  });

  describe('viewport.loadState', () => {
    function stateObject(el: unknown) {
      return JSON.parse(stateJson(el)) as CanvasState;
    }

    it('migrates an envelope without dataVersion once from 1', () => {
      const { registry, migrate } = versionedRegistry();
      const viewport = new Viewport(document.createElement('div'), { elementRegistry: registry });

      viewport.loadState(stateObject(envelope({ name: 'a' })));

      expect(migrate.mock.calls).toEqual([[{ name: 'a' }, 1]]);
      expect(viewport.store.getById('m1')).toMatchObject({
        dataVersion: 3,
        data: { label: 'a@1' },
      });
      viewport.destroy();
    });

    it('loadJSON migrates an envelope exactly once', () => {
      const { registry, migrate } = versionedRegistry();
      const viewport = new Viewport(document.createElement('div'), { elementRegistry: registry });

      viewport.loadJSON(stateJson(envelope({ name: 'a' })));

      expect(migrate).toHaveBeenCalledTimes(1);
      expect(viewport.store.getById('m1')).toMatchObject({ data: { label: 'a@1' } });
      viewport.destroy();
    });

    it('loadJSON of a legacy element does not migrate the decoded envelope', () => {
      const { registry, migrate } = versionedRegistry();
      const viewport = new Viewport(document.createElement('div'), { elementRegistry: registry });
      const legacy = {
        id: 'm1',
        type: 'marker',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default-layer',
        label: 'old',
      };

      viewport.loadJSON(JSON.stringify({ ...stateObject(legacy), version: 3, elements: [legacy] }));

      expect(migrate).not.toHaveBeenCalled();
      expect(viewport.store.getById('m1')).toMatchObject({
        dataVersion: 3,
        data: { label: 'old' },
      });
      viewport.destroy();
    });

    it('loadState of a raw legacy element stamps the current dataVersion without migrating', () => {
      const { registry, migrate } = versionedRegistry();
      const viewport = new Viewport(document.createElement('div'), { elementRegistry: registry });
      const legacy = {
        id: 'm1',
        type: 'marker',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default-layer',
        label: 'old',
      };

      viewport.loadState({ ...stateObject(legacy), version: 3, elements: [legacy] });

      expect(migrate).not.toHaveBeenCalled();
      expect(viewport.store.getById('m1')).toMatchObject({
        dataVersion: 3,
        data: { label: 'old' },
      });
      viewport.destroy();
    });

    it('rejects a migrate result that is not a record and keeps the current state', () => {
      const registry = new ElementRegistry();
      registry.register({
        ...markerDefinition,
        dataVersion: 2,
        migrate: () => 'oops' as unknown as Record<string, unknown>,
      });
      const viewport = new Viewport(document.createElement('div'), { elementRegistry: registry });
      viewport.loadState(stateObject({ ...envelope({ label: 'kept' }, 2), id: 'm0' }));

      expect(() => viewport.loadState(stateObject(envelope({ name: 'a' })))).toThrow(
        'Invalid element "m1": malformed test:marker data',
      );
      expect(viewport.store.getAll().map((el) => el.id)).toEqual(['m0']);
      viewport.destroy();
    });
  });

  describe('migrateElementData', () => {
    const asElement = (raw: object) => raw as unknown as CanvasElement;

    it('migrates data without dataVersion from 1 and stamps the current version', () => {
      const { registry, migrate } = versionedRegistry();
      const input = asElement(envelope({ name: 'a' }));
      const before = structuredClone(input);
      expect(migrateElementData(input, registry)).toMatchObject({
        dataVersion: 3,
        data: { label: 'a@1' },
      });
      expect(migrate).toHaveBeenCalledWith({ name: 'a' }, 1);
      expect(input).toEqual(before);
    });

    it('migrates an older dataVersion from that version', () => {
      const { registry } = versionedRegistry();
      expect(migrateElementData(asElement(envelope({ name: 'a' }, 2)), registry)).toMatchObject({
        dataVersion: 3,
        data: { label: 'a@2' },
      });
    });

    it.each([3, 4])('returns dataVersion %i data unchanged', (dataVersion) => {
      const { registry, migrate } = versionedRegistry();
      const input = asElement(envelope({ label: 'x' }, dataVersion));
      expect(migrateElementData(input, registry)).toBe(input);
      expect(migrate).not.toHaveBeenCalled();
    });

    it('returns unknown extension types and core elements unchanged', () => {
      const unknown = asElement(envelope({ name: 'a' }));
      expect(migrateElementData(unknown, new ElementRegistry())).toBe(unknown);
      const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
      expect(migrateElementData(shape, versionedRegistry().registry)).toBe(shape);
    });

    it('throws the load-path errors', () => {
      const throwing = new ElementRegistry();
      throwing.register({
        ...markerDefinition,
        dataVersion: 2,
        migrate: () => {
          throw new Error('boom');
        },
      });
      const malformed = new ElementRegistry();
      malformed.register({
        ...markerDefinition,
        dataVersion: 2,
        migrate: () => 'nope' as unknown as Record<string, unknown>,
      });
      const input = asElement(envelope({ name: 'a' }));

      expect(() => migrateElementData(input, throwing)).toThrow(
        'Invalid element "m1": test:marker migrate failed: boom',
      );
      expect(() => migrateElementData(input, malformed)).toThrow(
        'Invalid element "m1": malformed test:marker data',
      );
    });
  });

  describe('with the default registry', () => {
    let previous: ElementRegistry;
    beforeEach(() => {
      previous = getDefaultElementRegistry();
    });
    afterEach(() => setDefaultElementRegistry(previous));

    it('an export and parse that both omit the registry do not migrate a current element', () => {
      const { registry, migrate } = versionedRegistry();
      setDefaultElementRegistry(registry);
      const current = envelope({ label: 'x' }) as CanvasElement;

      const reparsed = parseState(JSON.stringify(exportState([current], makeCamera(), [layer])));

      expect(migrate).not.toHaveBeenCalled();
      expect(reparsed.elements[0]).toMatchObject({ dataVersion: 3, data: { label: 'x' } });
    });
  });
});

describe('persisted state v5', () => {
  const layers = [
    { id: 'L1', name: 'One', visible: true, locked: false, order: 0, opacity: 1 },
    { id: 'L2', name: 'Two', visible: true, locked: false, order: 1, opacity: 1 },
  ];

  function legacyNote(id: string, layerId: string, zIndex: number) {
    return {
      id,
      type: 'note',
      position: { x: 0, y: 0 },
      zIndex,
      locked: false,
      layerId,
      size: { w: 10, h: 10 },
      text: '',
      backgroundColor: '#fff',
      textColor: '#000',
    };
  }

  function legacyState(version: number, elements: unknown[]) {
    return { version, camera: makeCamera(), elements, layers };
  }

  function storeOrder(state: CanvasState): string[] {
    const store = new ElementStore();
    store.setLayerOrder(new Map(layers.map((l) => [l.id, l.order])));
    store.loadSnapshot(state.elements);
    return store.getAll().map((el) => el.id);
  }

  const v4Elements = () => [
    legacyNote('e1', 'L1', 2),
    legacyNote('e2', 'L2', 0),
    legacyNote('e3', 'L1', 0),
    legacyNote('e4', 'L2', 1),
  ];

  it('v4 file loads in the same order', () => {
    const state = parseState(JSON.stringify(legacyState(4, v4Elements())));
    expect(state.version).toBe(6);
    expect(storeOrder(state)).toEqual(['e3', 'e1', 'e2', 'e4']);
    for (const el of state.elements) {
      expect(el.version).toBe(1);
      expect(el).not.toHaveProperty('zIndex');
    }
  });

  it('v4 file with every zIndex 0 keeps file order, not id order', () => {
    const elements = [legacyNote('c', 'L1', 0), legacyNote('a', 'L1', 0), legacyNote('b', 'L1', 0)];
    const state = parseState(JSON.stringify(legacyState(4, elements)));
    expect(storeOrder(state)).toEqual(['c', 'a', 'b']);
  });

  it('migrateState (the loadState path) gives a v4 file the same order', () => {
    const legacy = legacyState(4, v4Elements()) as unknown as ImportableCanvasState;
    const state = migrateState(legacy);
    expect(state.version).toBe(6);
    expect(storeOrder(state)).toEqual(['e3', 'e1', 'e2', 'e4']);
  });

  it('v3 legacy file still loads with order preserved', () => {
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const marker = { ...legacyNote('m', 'L1', 1), type: 'marker', label: 'x' };
    const elements = [marker, legacyNote('n', 'L1', 0), legacyNote('o', 'L1', 2)];
    const state = parseState(JSON.stringify(legacyState(3, elements)), registry);
    expect(storeOrder(state)).toEqual(['n', 'm', 'o']);
    expect(state.elements[0]).toMatchObject({ type: 'extension', version: 1 });
  });

  it('v5 round trip keeps index, version and editor', () => {
    const note = { ...createNote({ position: { x: 1, y: 2 }, layerId: 'L1' }), index: 'a3' };
    const edited = { ...note, id: 'edited', version: 7, editor: 'peer-1' };
    const json = JSON.stringify(exportState([note, edited], makeCamera(), layers));
    const state = parseState(json);
    expect(state.version).toBe(6);
    expect(state.elements[0]).toMatchObject({ index: 'a3', version: 1 });
    expect(state.elements[0]).not.toHaveProperty('editor');
    expect(state.elements[1]).toMatchObject({ index: 'a3', version: 7, editor: 'peer-1' });
  });

  it.each([
    ['an empty index', { index: '' }, 'invalid index'],
    ['a malformed index', { index: 'a00' }, 'invalid index'],
    ['version 0', { version: 0 }, 'invalid version'],
    ['a fractional version', { version: 1.5 }, 'invalid version'],
    ['a non-string editor', { editor: 3 }, 'invalid editor'],
  ])('v5 rejects %s', (_label, patch, message) => {
    const note = { ...createNote({ position: { x: 0, y: 0 }, layerId: 'L1' }), index: 'a0' };
    const state = { version: 5, camera: makeCamera(), elements: [{ ...note, ...patch }], layers };
    expect(() => parseState(JSON.stringify(state))).toThrow(message);
  });

  it('v5 extension envelopes require index and version', () => {
    const envelope = {
      id: 'x1',
      type: 'extension',
      extensionType: 'test:unknown',
      position: { x: 0, y: 0 },
      locked: false,
      layerId: 'L1',
      version: 1,
      data: {},
    };
    const state = { version: 5, camera: makeCamera(), elements: [envelope], layers };
    expect(() => parseState(JSON.stringify(state))).toThrow('invalid index');
  });

  it.each([1, 2, 3, 4, 5])('migrates v%s without retaining stray parentId', (version) => {
    const note = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'L1' }),
      ...(version < 5 ? { zIndex: 0 } : { index: 'a0' }),
      parentId: version === 1 ? { injected: true } : 'ignored',
    };
    const state = parseState(
      JSON.stringify({ version, camera: makeCamera(), elements: [note], layers }),
    );
    expect(state.version).toBe(6);
    expect(state.elements[0]).not.toHaveProperty('parentId');
  });

  it('migrates an explicit v5 fixture preserving indexed envelopes and metadata', () => {
    const envelope = {
      id: 'extension',
      type: 'extension',
      extensionType: 'test:marker',
      position: { x: 0, y: 0 },
      index: 'a1',
      version: 7,
      editor: 'peer',
      locked: false,
      layerId: 'L1',
      data: { label: 'kept' },
    };
    const registry = new ElementRegistry();
    registry.register(markerDefinition);
    const state = parseState(
      JSON.stringify({ version: 5, camera: makeCamera(), elements: [envelope], layers }),
      registry,
    );
    expect(state).toMatchObject({
      version: 6,
      elements: [{ index: 'a1', version: 7, editor: 'peer', data: { label: 'kept' } }],
    });
  });

  it('accepts v6 child-before-parent and preserves the relationship through export and parse', () => {
    const parent = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'L1' }),
      id: 'parent',
      index: 'a0',
    };
    const child = { ...parent, id: 'child', index: 'a1', parentId: 'parent' };
    const state = parseState(
      JSON.stringify({ version: 6, camera: makeCamera(), elements: [child, parent], layers }),
    );
    const reparsed = parseState(JSON.stringify(exportState(state.elements, makeCamera(), layers)));
    expect(reparsed.elements.find((element) => element.id === 'child')).toMatchObject({
      parentId: 'parent',
    });
  });

  it.each([
    ['non-string parent', { parentId: 4 }],
    ['missing parent', { parentId: 'missing' }],
    ['self parent', { parentId: 'note' }],
  ])('rejects v6 %s', (_label, patch) => {
    const note = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'L1' }),
      id: 'note',
      index: 'a0',
      ...patch,
    };
    expect(() =>
      parseState(JSON.stringify({ version: 6, camera: makeCamera(), elements: [note], layers })),
    ).toThrow(/Invalid hierarchy|base fields/);
  });

  it('rejects v6 cycles and cross-layer parents while accepting depth 32', () => {
    const base = createNote({ position: { x: 0, y: 0 }, layerId: 'L1' });
    const cycle = [
      { ...base, id: 'a', index: 'a0', parentId: 'b' },
      { ...base, id: 'b', index: 'a1', parentId: 'a' },
    ];
    const crossLayer = [
      { ...base, id: 'a', index: 'a0' },
      { ...base, id: 'b', index: 'a1', layerId: 'L2', parentId: 'a' },
    ];
    expect(() =>
      parseState(JSON.stringify({ version: 6, camera: makeCamera(), elements: cycle, layers })),
    ).toThrow(/Invalid hierarchy/);
    expect(() =>
      parseState(
        JSON.stringify({ version: 6, camera: makeCamera(), elements: crossLayer, layers }),
      ),
    ).toThrow(/Invalid hierarchy/);
    const chain = Array.from({ length: 33 }, (_, index) => ({
      ...base,
      id: `n${index}`,
      index: 'a1',
      parentId: index === 0 ? undefined : `n${index - 1}`,
    }));
    expect(
      parseState(JSON.stringify({ version: 6, camera: makeCamera(), elements: chain, layers }))
        .elements,
    ).toHaveLength(33);
  });

  it('rejects v6 full-canvas parent and child endpoints plus depth 33', () => {
    const registry = new ElementRegistry();
    registry.register({ ...markerDefinition, type: 'test:full', fullCanvas: true });
    const full = {
      id: 'full',
      type: 'extension',
      extensionType: 'test:full',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: 'L1',
      data: { label: 'full' },
    };
    const note = {
      ...createNote({ position: { x: 0, y: 0 }, layerId: 'L1' }),
      id: 'note',
      index: 'a1',
    };
    for (const elements of [
      [full, { ...note, parentId: 'full' }],
      [
        { ...note, id: 'parent' },
        { ...full, parentId: 'parent' },
      ],
    ]) {
      expect(() =>
        parseState(
          JSON.stringify({ version: 6, camera: makeCamera(), elements, layers }),
          registry,
        ),
      ).toThrow(/Invalid hierarchy/);
    }
    const chain = Array.from({ length: 34 }, (_, index) => ({
      ...note,
      id: `deep${index}`,
      parentId: index === 0 ? undefined : `deep${index - 1}`,
    }));
    expect(() =>
      parseState(JSON.stringify({ version: 6, camera: makeCamera(), elements: chain, layers })),
    ).toThrow(/Invalid hierarchy/);
  });

  it('rejects v7 state', () => {
    expect(() =>
      parseState(JSON.stringify({ version: 7, camera: makeCamera(), elements: [], layers })),
    ).toThrow(/unsupported version 7/);
  });
});
