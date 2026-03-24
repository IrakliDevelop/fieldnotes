import { describe, it, expect } from 'vitest';
import { computeBounds, getElementRect } from './export-image';
import {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createText,
  createShape,
  createGrid,
} from '../elements/element-factory';

describe('getElementRect', () => {
  it('returns bounds for a note', () => {
    const note = createNote({ position: { x: 10, y: 20 }, size: { w: 200, h: 100 } });
    const rect = getElementRect(note);
    expect(rect).toEqual({ x: 10, y: 20, w: 200, h: 100 });
  });

  it('returns bounds for a shape', () => {
    const shape = createShape({ position: { x: 5, y: 5 }, size: { w: 50, h: 50 } });
    const rect = getElementRect(shape);
    expect(rect).toEqual({ x: 5, y: 5, w: 50, h: 50 });
  });

  it('returns bounds for a text element', () => {
    const text = createText({ position: { x: 0, y: 0 }, size: { w: 200, h: 28 } });
    const rect = getElementRect(text);
    expect(rect).toEqual({ x: 0, y: 0, w: 200, h: 28 });
  });

  it('returns bounds for an image', () => {
    const img = createImage({ position: { x: 50, y: 50 }, size: { w: 300, h: 200 }, src: '' });
    const rect = getElementRect(img);
    expect(rect).toEqual({ x: 50, y: 50, w: 300, h: 200 });
  });

  it('returns bounds for a stroke', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 50, pressure: 0.5 },
      ],
      position: { x: 10, y: 10 },
      width: 4,
    });
    const rect = getElementRect(stroke);
    expect(rect).toEqual({ x: 8, y: 8, w: 104, h: 54 });
  });

  it('returns bounds for a straight arrow with padding', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      width: 2,
    });
    const rect = getElementRect(arrow);
    expect(rect).not.toBeNull();
    if (rect) {
      expect(rect.x).toBeLessThan(0);
      expect(rect.w).toBeGreaterThan(100);
    }
  });

  it('returns null for grid elements', () => {
    const grid = createGrid({});
    expect(getElementRect(grid)).toBeNull();
  });

  it('returns null for stroke with no points', () => {
    const stroke = createStroke({ points: [] as never[] });
    expect(getElementRect(stroke)).toBeNull();
  });
});

describe('computeBounds', () => {
  it('computes bounding box of multiple elements with padding', () => {
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    const shape = createShape({ position: { x: 400, y: 50 }, size: { w: 100, h: 80 } });
    const bounds = computeBounds([note, shape], 10);
    expect(bounds).toEqual({ x: 90, y: 40, w: 420, h: 170 });
  });

  it('returns null for empty element list', () => {
    expect(computeBounds([], 10)).toBeNull();
  });

  it('returns null when all elements are grids', () => {
    const grid = createGrid({});
    expect(computeBounds([grid], 10)).toBeNull();
  });

  it('ignores grid elements in bounds calculation', () => {
    const note = createNote({ position: { x: 50, y: 50 }, size: { w: 100, h: 100 } });
    const grid = createGrid({});
    const bounds = computeBounds([note, grid], 0);
    expect(bounds).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });
});
