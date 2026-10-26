import { describe, expect, it } from 'vitest';
import { ElementHierarchy, validateHierarchy } from './element-hierarchy';
import { ElementRegistry } from './element-registry';
import type {
  BaseElement,
  ExtensionElementEnvelope,
  ElementTypeDefinition,
  NoteElement,
} from './types';

function note(id: string, overrides: Partial<NoteElement> = {}): NoteElement {
  return {
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    size: { w: 10, h: 10 },
    text: '',
    backgroundColor: '#fff',
    textColor: '#000',
    index: id,
    version: 1,
    locked: false,
    layerId: 'layer',
    ...overrides,
  };
}

function fullCanvasDefinition(): ElementTypeDefinition<BaseElement> {
  return {
    type: 'test:full-canvas',
    legacyTypes: [],
    fullCanvas: true,
    decodeLegacy: (raw) => raw as unknown as BaseElement,
    validateData: () => true,
    unwrap: (element) => element,
    wrap: (element) => ({
      ...element,
      type: 'extension',
      extensionType: 'test:full-canvas',
      data: {},
    }),
    bounds: () => null,
  };
}

function extension(
  id: string,
  overrides: Partial<ExtensionElementEnvelope> = {},
): ExtensionElementEnvelope {
  return {
    id,
    type: 'extension',
    extensionType: 'test:full-canvas',
    position: { x: 0, y: 0 },
    index: id,
    version: 1,
    locked: false,
    layerId: 'layer',
    data: {},
    ...overrides,
  };
}

describe('ElementHierarchy', () => {
  it('projects ancestor clips lazily without masking the contributing parent', () => {
    const registry = new ElementRegistry();
    let calls = 0;
    registry.register<ExtensionElementEnvelope>({
      type: 'test:clip',
      legacyTypes: [],
      renderMode: 'canvas',
      decodeLegacy: (raw) => raw as ExtensionElementEnvelope,
      validateData: () => true,
      unwrap: (element) => element,
      wrap: (element) => element,
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      clipBounds: () => {
        calls++;
        return { x: 10, y: 10, w: 50, h: 50 };
      },
    });
    const root = extension('root', { extensionType: 'test:clip' });
    const child = note('child', { parentId: 'root' });
    const hierarchy = new ElementHierarchy(
      new Map([
        [root.id, root],
        [child.id, child],
      ]),
      registry,
      new Map(),
    );
    expect(calls).toBe(0);
    expect(hierarchy.getEffectiveClip(root.id)).toBeNull();
    expect(hierarchy.getEffectiveClip(child.id)).toEqual({ x: 10, y: 10, w: 50, h: 50 });
    expect(calls).toBe(1);
  });
  it('orders roots and descendants depth first by index then id', () => {
    const elements = new Map([
      ['b', note('b', { index: 'b' })],
      ['child', note('child', { parentId: 'a', index: 'z' })],
      ['a', note('a', { index: 'a' })],
      ['child-a', note('child-a', { parentId: 'a', index: 'a' })],
    ]);
    const hierarchy = new ElementHierarchy(elements, new ElementRegistry(), new Map());
    expect(hierarchy.scene.map((element) => element.id)).toEqual(['a', 'child-a', 'child', 'b']);
    expect(hierarchy.getDescendants('a').map((element) => element.id)).toEqual([
      'child-a',
      'child',
    ]);
  });

  it('fails closed for orphan descendants while retaining unrelated roots', () => {
    const elements = new Map([
      ['orphan', note('orphan', { parentId: 'missing' })],
      ['child', note('child', { parentId: 'orphan' })],
      ['root', note('root')],
    ]);
    const hierarchy = new ElementHierarchy(elements, new ElementRegistry(), new Map());
    expect(hierarchy.scene.map((element) => element.id)).toEqual(['root']);
    expect(() => validateHierarchy(elements, new ElementRegistry())).toThrow(/Invalid hierarchy/);
  });

  it.each([
    ['self', new Map([['a', note('a', { parentId: 'a' })]])],
    [
      'cycle',
      new Map([
        ['a', note('a', { parentId: 'b' })],
        ['b', note('b', { parentId: 'a' })],
      ]),
    ],
    [
      'cross-layer',
      new Map([
        ['a', note('a')],
        ['b', note('b', { parentId: 'a', layerId: 'other' })],
      ]),
    ],
  ])('rejects a %s relationship', (_name, elements) => {
    expect(() => validateHierarchy(elements, new ElementRegistry())).toThrow(/Invalid hierarchy/);
  });

  it('accepts depth 32 and rejects depth 33', () => {
    const atDepth = (depth: number) => {
      const elements = new Map<string, NoteElement>();
      for (let index = 0; index <= depth; index++) {
        elements.set(
          `n${index}`,
          note(`n${index}`, index === 0 ? {} : { parentId: `n${index - 1}` }),
        );
      }
      return elements;
    };

    expect(() => validateHierarchy(atDepth(32), new ElementRegistry())).not.toThrow();
    expect(() => validateHierarchy(atDepth(33), new ElementRegistry())).toThrow(
      /Invalid hierarchy/,
    );
  });

  it('orders layers, equal roots and equal siblings independently', () => {
    const elements = new Map([
      ['z', note('z', { index: 'a', layerId: 'late' })],
      ['b', note('b', { index: 'a' })],
      ['a', note('a', { index: 'a' })],
      ['child-b', note('child-b', { parentId: 'a', index: 'x' })],
      ['child-a', note('child-a', { parentId: 'a', index: 'x' })],
      ['grandchild', note('grandchild', { parentId: 'child-a', index: 'a' })],
    ]);
    const hierarchy = new ElementHierarchy(
      elements,
      new ElementRegistry(),
      new Map([
        ['late', 1],
        ['layer', 0],
      ]),
    );
    expect(hierarchy.scene.map((element) => element.id)).toEqual([
      'a',
      'child-a',
      'grandchild',
      'child-b',
      'b',
      'z',
    ]);
    expect(hierarchy.getChildren('a').map((element) => element.id)).toEqual(['child-a', 'child-b']);
    expect(hierarchy.getDescendants('a').map((element) => element.id)).toEqual([
      'child-a',
      'grandchild',
      'child-b',
    ]);
  });

  it('falls back to index and id when layers have no explicit order', () => {
    const elements = new Map([
      ['b', note('b', { layerId: 'unlisted-b', index: 'a1' })],
      ['a', note('a', { layerId: 'unlisted-a', index: 'a0' })],
    ]);
    const hierarchy = new ElementHierarchy(elements, new ElementRegistry(), new Map());
    expect(hierarchy.scene.map((element) => element.id)).toEqual(['a', 'b']);
  });

  it('rejects full-canvas endpoints but permits unknown extension relationships', () => {
    const registry = new ElementRegistry();
    registry.register(fullCanvasDefinition());
    const fullParent = new Map<string, NoteElement | ExtensionElementEnvelope>([
      ['full', extension('full')],
      ['child', note('child', { parentId: 'full' })],
    ]);
    const fullChild = new Map<string, NoteElement | ExtensionElementEnvelope>([
      ['parent', note('parent')],
      ['full', extension('full', { parentId: 'parent' })],
    ]);
    expect(() => validateHierarchy(fullParent, registry)).toThrow(/Invalid hierarchy/);
    expect(() => validateHierarchy(fullChild, registry)).toThrow(/Invalid hierarchy/);
    const unknown = new Map<string, NoteElement | ExtensionElementEnvelope>([
      ['parent', note('parent')],
      ['unknown', extension('unknown', { extensionType: 'unknown', parentId: 'parent' })],
    ]);
    expect(() => validateHierarchy(unknown, registry)).not.toThrow();
  });

  it('hides invalid ancestors and their descendants without hiding valid trees', () => {
    const elements = new Map([
      ['orphan', note('orphan', { parentId: 'missing' })],
      ['hidden', note('hidden', { parentId: 'orphan' })],
      ['root', note('root')],
      ['visible', note('visible', { parentId: 'root' })],
    ]);
    const hierarchy = new ElementHierarchy(elements, new ElementRegistry(), new Map());
    expect(hierarchy.scene.map((element) => element.id)).toEqual(['root', 'visible']);
    expect(hierarchy.getChildren('missing')).toEqual([]);
    expect(hierarchy.getDescendants('orphan')).toEqual([]);
  });
});
