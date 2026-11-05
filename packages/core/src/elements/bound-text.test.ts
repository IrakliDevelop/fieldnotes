import { describe, expect, it } from 'vitest';
import { createArrow, createNote, createShape, createText } from './element-factory';
import { ElementStore } from './element-store';
import { getBoundText, getBoundTextBox, isBoundTextContainer, layoutBoundText } from './bound-text';
import { ElementRegistry } from './element-registry';
import type { ExtensionElementEnvelope, ElementTypeDefinition } from './types';

function extension(id: string): ExtensionElementEnvelope {
  return {
    id,
    type: 'extension',
    extensionType: 'test:bound',
    position: { x: 0, y: 0 },
    index: 'a',
    version: 1,
    locked: false,
    layerId: '',
    data: {},
  };
}

function boundRegistry(
  boundTextLayout: ElementTypeDefinition<ExtensionElementEnvelope>['boundTextLayout'],
): ElementRegistry {
  const registry = new ElementRegistry();
  registry.register({
    type: 'test:bound',
    legacyTypes: [],
    decodeLegacy: () => extension('legacy'),
    validateData: () => true,
    unwrap: (element) => element,
    wrap: (element) => element,
    bounds: () => null,
    boundTextLayout,
  });
  return registry;
}

describe('bound text', () => {
  it('finds a text child whose advisory container matches its parent', () => {
    const store = new ElementStore();
    const rectangle = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      id: 'rect',
    };
    const text = {
      ...createText({ position: { x: 0, y: 0 }, parentId: rectangle.id }),
      id: 'text',
      containerId: rectangle.id,
    };
    store.add(rectangle);
    store.add(text);

    expect(getBoundText(rectangle, store)?.id).toBe(text.id);
  });

  it('leaves a mismatched advisory relation as ordinary text', () => {
    const store = new ElementStore();
    const rectangle = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      id: 'rect',
    };
    const text = {
      ...createText({ position: { x: 0, y: 0 }, parentId: rectangle.id }),
      id: 'text',
      containerId: 'other',
    };
    store.add(rectangle);
    expect(() => store.add(text)).not.toThrow();

    expect(getBoundText(rectangle, store)).toBeUndefined();
    expect(store.getAll().some((element) => element.id === text.id)).toBe(true);
  });

  it('uses padded rectangle and inscribed ellipse content boxes', () => {
    const registry = new ElementRegistry();
    const rectangle = createShape({ position: { x: 10, y: 20 }, size: { w: 100, h: 60 } });
    const ellipse = createShape({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 60 },
      shape: 'ellipse',
    });

    expect(getBoundTextBox(rectangle, registry, () => null)).toEqual({
      x: 18,
      y: 28,
      w: 84,
      h: 44,
    });
    const box = getBoundTextBox(ellipse, registry, () => null);
    expect(box.x).toBeCloseTo(24.64466094067263);
    expect(box.y).toBeCloseTo(28.786796564403573);
    expect(box.w).toBeCloseTo(70.71067811865476);
    expect(box.h).toBeCloseTo(42.42640687119285);
  });

  it('grows a rotated rectangle without shrinking it', () => {
    const registry = new ElementRegistry();
    const rectangle = createShape({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 30 },
    });
    rectangle.rotation = Math.PI / 2;
    const text = createText({ position: { x: 0, y: 0 }, text: 'text' });

    const result = layoutBoundText(rectangle, text, {
      registry,
      resolveBounds: () => null,
      remeasure: () => ({ x: 0, y: 0, w: 84, h: 40 }),
    });

    expect(result.container).toMatchObject({ size: { w: 100, h: 44 } });
    expect(result.container?.position?.x).toBeCloseTo(3);
    expect(result.container?.position?.y).toBeCloseTo(13);
    expect(result.text).toMatchObject({ size: { w: 84, h: 28 }, rotation: Math.PI / 2 });
  });

  it('keeps shorter and empty shape text from growing, and grows ellipse height by sqrt two', () => {
    const registry = new ElementRegistry();
    const rectangle = createShape({ position: { x: 0, y: 0 }, size: { w: 80, h: 60 } });
    const ellipse = createShape({
      position: { x: 0, y: 0 },
      size: { w: 80, h: 20 },
      shape: 'ellipse',
    });
    const short = createText({ position: { x: 0, y: 0 }, text: 'short', size: { w: 64, h: 12 } });
    const empty = createText({ position: { x: 0, y: 0 }, text: '', size: { w: 64, h: 100 } });
    const tall = createText({
      position: { x: 0, y: 0 },
      text: 'tall',
      size: { w: 56.5685424949238, h: 40 },
    });
    const remeasure = () => ({ x: 0, y: 0, w: 64, h: 40 });

    expect(
      layoutBoundText(rectangle, short, { registry, resolveBounds: () => null, remeasure })
        .container,
    ).toBeNull();
    expect(
      layoutBoundText(rectangle, empty, { registry, resolveBounds: () => null, remeasure })
        .container,
    ).toBeNull();
    expect(
      layoutBoundText(ellipse, tall, { registry, resolveBounds: () => null, remeasure }).container
        ?.size?.h,
    ).toBeCloseTo(56.5685424949238);
  });

  it('lays out eligible arrows at their visible anchor without wrapping or growth', () => {
    const registry = new ElementRegistry();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      fromBinding: { elementId: 'source' },
    });
    const text = createText({
      position: { x: 0, y: 0 },
      text: 'arrow',
      size: { w: 200, h: 10 },
      wrap: true,
    });
    const result = layoutBoundText(arrow, text, {
      registry,
      resolveBounds: () => ({ x: -10, y: -10, w: 20, h: 20 }),
      remeasure: () => ({ x: 0, y: 0, w: 12, h: 18 }),
    });

    expect(isBoundTextContainer(arrow, registry)).toBe(true);
    expect(result.container).toBeNull();
    expect(result.text?.size).toEqual({ w: 24, h: 18 });
    expect(result.text?.position.x).toBeCloseTo(43.00030517578125);
    expect(result.text?.position.y).toBe(-9);
    expect(isBoundTextContainer(createNote({ position: { x: 0, y: 0 } }), registry)).toBe(false);
  });

  it('rejects lines and selects the first matching text child by index', () => {
    const store = new ElementStore();
    const line = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, shape: 'line' });
    const rectangle = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
      id: 'rect',
    };
    const second = {
      ...createText({ position: { x: 0, y: 0 }, parentId: 'rect', index: 'b' }),
      id: 'second',
      containerId: 'rect',
    };
    const first = { ...second, id: 'first', index: 'a' };
    store.add(rectangle);
    store.add(second);
    store.add(first);

    expect(isBoundTextContainer(line, store.elementRegistry)).toBe(false);
    expect(getBoundText(rectangle, store)?.id).toBe('first');
    store.add({ ...first, id: 'aaa', index: 'a' });
    expect(getBoundText(rectangle, store)?.id).toBe('aaa');
  });

  it('rejects an extension whose layout hook returns null and floors extension box width', () => {
    const nullRegistry = boundRegistry(() => null);
    expect(isBoundTextContainer(extension('null'), nullRegistry)).toBe(false);

    const registry = boundRegistry(() => ({ box: { x: 20, y: 10, w: 8, h: 30 } }));
    expect(getBoundTextBox(extension('small'), registry, () => null)).toEqual({
      x: 16,
      y: 10,
      w: 16,
      h: 30,
    });
    expect(isBoundTextContainer(extension('unknown'), new ElementRegistry())).toBe(false);
    expect(isBoundTextContainer(extension('no-hook'), boundRegistry(undefined))).toBe(false);
  });

  it('lets extension text overflow without grow and relays one layout after width-changing growth', () => {
    const text = createText({ position: { x: 0, y: 0 }, text: 'long', size: { w: 40, h: 20 } });
    const noGrow = boundRegistry(() => ({ box: { x: 0, y: 0, w: 40, h: 10 } }));
    expect(
      layoutBoundText(extension('plain'), text, {
        registry: noGrow,
        resolveBounds: () => null,
        remeasure: () => ({ x: 0, y: 0, w: 40, h: 20 }),
      }),
    ).toMatchObject({ container: null, text: { size: { w: 40, h: 20 } } });

    let measures = 0;
    const registry = boundRegistry((element) => ({
      box: { x: 0, y: 0, w: element.id === 'grown' ? 60 : 40, h: element.id === 'grown' ? 30 : 10 },
      grow: (current) => ({ ...current, id: 'grown' }),
    }));
    const result = layoutBoundText(extension('start'), text, {
      registry,
      resolveBounds: () => null,
      remeasure: (_content, _fontSize, width) => {
        measures += 1;
        return { x: 0, y: 0, w: width ?? 0, h: 20 };
      },
    });
    expect(result.container?.id).toBe('grown');
    expect(result.text?.size).toEqual({ w: 60, h: 20 });
    expect(measures).toBe(1);
  });

  it('does not accept a shrinking extension grow result', () => {
    const registry = boundRegistry((element) => ({
      box: { x: 0, y: 0, w: 40, h: element.id === 'shrink' ? 5 : 10 },
      grow: (current) => ({ ...current, id: 'shrink' }),
    }));
    const text = createText({ position: { x: 0, y: 0 }, text: 'text', size: { w: 40, h: 20 } });
    const result = layoutBoundText(extension('full'), text, {
      registry,
      resolveBounds: () => null,
      remeasure: () => ({ x: 0, y: 0, w: 40, h: 20 }),
    });

    expect(result.container).toBeNull();
  });
});
