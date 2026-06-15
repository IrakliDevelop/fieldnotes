// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { styleToPatch, getElementStyle } from './element-style';
import {
  createStroke,
  createArrow,
  createShape,
  createText,
  createNote,
  createGrid,
  createTemplate,
  createImage,
} from './element-factory';

const FULL = { color: '#f00', fillColor: '#0f0', strokeWidth: 7, opacity: 0.5, fontSize: 22 };

describe('styleToPatch', () => {
  it('stroke → color/width/opacity', () => {
    expect(styleToPatch(createStroke({ points: [{ x: 0, y: 0, pressure: 1 }] }), FULL)).toEqual({
      color: '#f00',
      width: 7,
      opacity: 0.5,
    });
  });
  it('arrow → color/width', () => {
    expect(styleToPatch(createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), FULL)).toEqual({
      color: '#f00',
      width: 7,
    });
  });
  it('shape → strokeColor/fillColor/strokeWidth', () => {
    expect(
      styleToPatch(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }), FULL),
    ).toEqual({ strokeColor: '#f00', fillColor: '#0f0', strokeWidth: 7 });
  });
  it('text → color/fontSize', () => {
    expect(styleToPatch(createText({ position: { x: 0, y: 0 } }), FULL)).toEqual({
      color: '#f00',
      fontSize: 22,
    });
  });
  it('note → textColor/backgroundColor/fontSize', () => {
    expect(styleToPatch(createNote({ position: { x: 0, y: 0 }, text: 'hi' }), FULL)).toEqual({
      textColor: '#f00',
      backgroundColor: '#0f0',
      fontSize: 22,
    });
  });
  it('omits undefined props', () => {
    expect(
      styleToPatch(createStroke({ points: [{ x: 0, y: 0, pressure: 1 }] }), { color: '#abc' }),
    ).toEqual({ color: '#abc' });
  });
});

describe('getElementStyle', () => {
  it('reads note (textColor→color, backgroundColor→fillColor)', () => {
    const el = createNote({ position: { x: 0, y: 0 }, text: 'hi' });
    const s = getElementStyle(el);
    expect(s.color).toBe(el.textColor);
    expect(s.fillColor).toBe(el.backgroundColor);
  });
  it('round-trips a shape', () => {
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    expect(styleToPatch(el, getElementStyle(el))).toEqual({
      strokeColor: el.strokeColor,
      fillColor: el.fillColor,
      strokeWidth: el.strokeWidth,
    });
  });
});

describe('styleToPatch — remaining types', () => {
  it('grid → strokeColor/strokeWidth/opacity', () => {
    expect(styleToPatch(createGrid({}), FULL)).toEqual({
      strokeColor: '#f00',
      strokeWidth: 7,
      opacity: 0.5,
    });
  });
  it('template → strokeColor/fillColor/strokeWidth/opacity', () => {
    const el = createTemplate({ position: { x: 0, y: 0 }, templateShape: 'circle', radius: 3 });
    expect(styleToPatch(el, FULL)).toEqual({
      strokeColor: '#f00',
      fillColor: '#0f0',
      strokeWidth: 7,
      opacity: 0.5,
    });
  });
  it('image (no style fields) → empty patch', () => {
    const el = createImage({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, src: 'x' });
    expect(styleToPatch(el, FULL)).toEqual({});
  });
});

describe('getElementStyle — round-trips all styled types', () => {
  it.each([
    [
      'stroke',
      () => createStroke({ points: [{ x: 0, y: 0, pressure: 1 }], color: '#123', width: 4 }),
    ],
    [
      'arrow',
      () => createArrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#222', width: 5 }),
    ],
    ['text', () => createText({ position: { x: 0, y: 0 }, color: '#333', fontSize: 15 })],
    ['grid', () => createGrid({ strokeColor: '#444', strokeWidth: 2, opacity: 0.7 })],
    [
      'template',
      () => createTemplate({ position: { x: 0, y: 0 }, templateShape: 'cone', radius: 2 }),
    ],
  ])('re-applying %s style is a no-op patch', (_label, make) => {
    const el = make();
    const patch = styleToPatch(el, getElementStyle(el));
    expect({ ...el, ...patch }).toEqual(el);
  });

  it('image yields an empty style', () => {
    const el = createImage({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, src: 'x' });
    expect(getElementStyle(el)).toEqual({});
  });
});
