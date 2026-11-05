import { describe, expect, it } from 'vitest';
import { createShape, createText } from './element-factory';
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
