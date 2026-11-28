import { describe, expect, it } from 'vitest';
import { buildFrameStructure } from './frame-structure';
import { createNote, createShape } from '../elements/element-factory';
import type { CanvasElement } from '../elements/types';

const shape = (layerId: string): CanvasElement =>
  createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId });
const note = (layerId: string): CanvasElement => createNote({ position: { x: 0, y: 0 }, layerId });

function build(
  elements: CanvasElement[],
  { hidden = [], fullCanvas = [] }: { hidden?: string[]; fullCanvas?: CanvasElement[] } = {},
) {
  return buildFrameStructure(
    elements,
    (layerId) => !hidden.includes(layerId),
    (element) => element.type === 'note',
    (element) => fullCanvas.includes(element),
  );
}

describe('buildFrameStructure', () => {
  it('groups a canvas-only scene by layer in scene order', () => {
    const s = build([shape('a'), shape('b'), shape('a')]);
    expect([...s.layerGroups]).toEqual([
      ['a', [0, 2]],
      ['b', [1]],
    ]);
    expect(s.firstDomIndex).toBe(-1);
    expect(s.hybridActive).toBe(false);
    expect(s.dom).toEqual([]);
    expect([...s.hybridRuns]).toEqual([]);
    expect(s.fullCanvas).toEqual([]);
    expect(s.visibleCount).toBe(3);
  });

  it('puts canvas elements above a leading DOM element in hybrid runs', () => {
    const s = build([note('a'), shape('a'), shape('a')]);
    expect(s.firstDomIndex).toBe(0);
    expect(s.hybridActive).toBe(true);
    expect([...s.hybridRuns]).toEqual([[2, [1, 2]]]);
    expect([...s.layerGroups]).toEqual([]);
    expect(s.dom).toEqual([{ rank: 0, order: 1 }]);
  });

  it('splits canvas, DOM, canvas, DOM, canvas into a layer group and two hybrid runs', () => {
    const s = build([shape('a'), note('a'), shape('a'), note('a'), shape('a')]);
    expect([...s.layerGroups]).toEqual([['a', [0]]]);
    expect([...s.hybridRuns]).toEqual([
      [3, [2]],
      [5, [4]],
    ]);
    expect(s.dom).toEqual([
      { rank: 1, order: 2 },
      { rank: 3, order: 4 },
    ]);
    expect([...s.hybridOrders]).toEqual([3, 5]);
    expect(s.firstDomIndex).toBe(1);
  });

  it('gives a hidden layer no paint order and lists only its DOM elements as hidden', () => {
    const s = build([shape('a'), note('h'), shape('h'), note('b'), shape('b')], {
      hidden: ['h'],
    });
    expect(s.visibleCount).toBe(3);
    expect(s.hiddenDom).toEqual([1]);
    expect(s.dom).toEqual([{ rank: 3, order: 2 }]);
    expect(s.firstDomIndex).toBe(1);
    expect([...s.layerGroups]).toEqual([['a', [0]]]);
    expect([...s.hybridRuns]).toEqual([[3, [4]]]);
  });

  it('keeps one hybrid run across a full-canvas element and a hidden-layer element', () => {
    const grid = shape('a');
    const s = build([note('a'), shape('a'), grid, note('h'), shape('h'), shape('a')], {
      hidden: ['h'],
      fullCanvas: [grid],
    });
    expect(s.fullCanvas).toEqual([2]);
    expect(s.hybridActive).toBe(true);
    expect([...s.hybridRuns]).toEqual([[2, [1, 5]]]);
    expect(s.hiddenDom).toEqual([3]);
    expect(s.visibleCount).toBe(4);
  });

  it('counts a full-canvas element as non-DOM when deciding hybridActive', () => {
    const grid = shape('a');
    const s = build([note('a'), grid], { fullCanvas: [grid] });
    expect(s.hybridActive).toBe(true);
    expect(s.fullCanvas).toEqual([1]);
    expect([...s.hybridRuns]).toEqual([]);
  });

  it('leaves a canvas scene with a trailing DOM element in layer groups', () => {
    const s = build([shape('a'), shape('a'), note('a')]);
    expect(s.firstDomIndex).toBe(2);
    expect(s.hybridActive).toBe(false);
    expect([...s.hybridRuns]).toEqual([]);
    expect([...s.layerGroups]).toEqual([['a', [0, 1]]]);
    expect(s.dom).toEqual([{ rank: 2, order: 3 }]);
  });
});
