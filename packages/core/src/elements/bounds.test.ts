import { describe, it, expect } from 'vitest';
import { getElementsBoundingBox } from './bounds';
import { createNote, createShape, createStroke } from './element-factory';
import type { ExtensionElementEnvelope } from './types';

const unboundedExtension: ExtensionElementEnvelope = {
  id: 'extension',
  type: 'extension',
  extensionType: 'test:unbounded',
  position: { x: 0, y: 0 },
  zIndex: 0,
  locked: false,
  layerId: '',
  data: {},
};

describe('getElementsBoundingBox', () => {
  it('returns null for empty array', () => {
    expect(getElementsBoundingBox([])).toBeNull();
  });

  it('returns bounds of a single element', () => {
    const note = createNote({
      position: { x: 50, y: 100 },
      size: { w: 200, h: 100 },
    });
    const box = getElementsBoundingBox([note]);
    expect(box).toEqual({ x: 50, y: 100, w: 200, h: 100 });
  });

  it('computes union of multiple elements', () => {
    const a = createNote({
      position: { x: 0, y: 0 },
      size: { w: 100, h: 50 },
    });
    const b = createShape({
      position: { x: 200, y: 150 },
      size: { w: 80, h: 60 },
    });
    const box = getElementsBoundingBox([a, b]);
    expect(box).toEqual({ x: 0, y: 0, w: 280, h: 210 });
  });

  it('skips extension elements with no registered bounds adapter', () => {
    const note = createNote({
      position: { x: 10, y: 20 },
      size: { w: 100, h: 50 },
    });
    const box = getElementsBoundingBox([unboundedExtension, note]);
    expect(box).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('returns null when all elements have no bounds', () => {
    expect(getElementsBoundingBox([unboundedExtension])).toBeNull();
  });

  it('includes stroke elements via their computed bounds', () => {
    const stroke = createStroke({
      position: { x: 10, y: 10 },
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 80, pressure: 0.5 },
      ],
    });
    const box = getElementsBoundingBox([stroke]);
    expect(box).toEqual({ x: 10, y: 10, w: 100, h: 80 });
  });
});
