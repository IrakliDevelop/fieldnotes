import { describe, expect, it } from 'vitest';
import { ElementHierarchy, validateHierarchy } from './element-hierarchy';
import { ElementRegistry } from './element-registry';
import type { NoteElement } from './types';

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

describe('ElementHierarchy', () => {
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
});
