import { describe, it, expect } from 'vitest';
import { getElementBounds, boundsIntersect } from './element-bounds';
import {
  createNote,
  createImage,
  createShape,
  createText,
  createHtmlElement,
  createStroke,
  createArrow,
  createGrid,
} from './element-factory';

describe('getElementBounds', () => {
  it('returns bounds for a note', () => {
    const note = createNote({ position: { x: 10, y: 20 }, size: { w: 100, h: 50 } });
    const bounds = getElementBounds(note);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('returns bounds for an image', () => {
    const img = createImage({
      position: { x: 5, y: 15 },
      size: { w: 200, h: 100 },
      src: 'test.png',
    });
    const bounds = getElementBounds(img);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 5, y: 15, w: 200, h: 100 });
  });

  it('returns bounds for a shape', () => {
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 50, h: 50 } });
    const bounds = getElementBounds(shape);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it('returns bounds for a text element', () => {
    const text = createText({ position: { x: 30, y: 40 }, size: { w: 120, h: 30 } });
    const bounds = getElementBounds(text);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 30, y: 40, w: 120, h: 30 });
  });

  it('returns bounds for an html element', () => {
    const html = createHtmlElement({ position: { x: 7, y: 8 }, size: { w: 60, h: 90 } });
    const bounds = getElementBounds(html);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 7, y: 8, w: 60, h: 90 });
  });

  it('returns bounds for a stroke with points', () => {
    const stroke = createStroke({
      position: { x: 10, y: 10 },
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 20, y: 30, pressure: 0.5 },
        { x: -5, y: 10, pressure: 0.5 },
      ],
    });
    const bounds = getElementBounds(stroke);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 5, y: 10, w: 25, h: 30 });
  });

  it('caches stroke bounds on repeated calls', () => {
    const stroke = createStroke({
      position: { x: 0, y: 0 },
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 10, y: 10, pressure: 0.5 },
      ],
    });
    const first = getElementBounds(stroke);
    const second = getElementBounds(stroke);
    expect(first).toBe(second);
  });

  it('returns null for a stroke with no points', () => {
    const stroke = createStroke({ points: [] });
    expect(getElementBounds(stroke)).toBeNull();
  });

  it('returns bounds for a straight arrow', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
    });
    const bounds = getElementBounds(arrow);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('returns bounds for a bent arrow', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      bend: 50,
    });
    const bounds = getElementBounds(arrow);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds.x).toBe(0);
    expect(bounds.w).toBe(100);
    // bend=50 with horizontal arrow creates control point at (50, 50)
    // curve should extend beyond the from/to y range
    expect(bounds.y).toBe(0);
    expect(bounds.h).toBeGreaterThan(0);
  });

  it('returns null for a grid', () => {
    const grid = createGrid({});
    expect(getElementBounds(grid)).toBeNull();
  });
});

describe('boundsIntersect', () => {
  it('detects overlapping bounds', () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('detects non-overlapping bounds (horizontal separation)', () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(
      false,
    );
  });

  it('detects non-overlapping bounds (vertical separation)', () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 10, h: 10 })).toBe(
      false,
    );
  });

  it('detects touching edges as intersecting', () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(true);
  });

  it('detects containment as intersecting', () => {
    expect(boundsIntersect({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 20, h: 20 })).toBe(
      true,
    );
  });
});
