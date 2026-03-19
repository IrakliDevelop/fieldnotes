import { describe, it, expect } from 'vitest';
import {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createHtmlElement,
} from './element-factory';

describe('element factories', () => {
  describe('createStroke', () => {
    it('creates a stroke with defaults', () => {
      const stroke = createStroke({ points: [{ x: 0, y: 0 }] });
      expect(stroke.type).toBe('stroke');
      expect(stroke.id).toMatch(/^stroke_/);
      expect(stroke.color).toBe('#000000');
      expect(stroke.width).toBe(2);
      expect(stroke.opacity).toBe(1);
      expect(stroke.locked).toBe(false);
    });

    it('accepts overrides', () => {
      const stroke = createStroke({ points: [], color: '#ff0000', width: 5 });
      expect(stroke.color).toBe('#ff0000');
      expect(stroke.width).toBe(5);
    });
  });

  describe('createNote', () => {
    it('creates a note with defaults', () => {
      const note = createNote({ position: { x: 10, y: 20 } });
      expect(note.type).toBe('note');
      expect(note.id).toMatch(/^note_/);
      expect(note.text).toBe('');
      expect(note.size).toEqual({ w: 200, h: 100 });
      expect(note.position).toEqual({ x: 10, y: 20 });
    });
  });

  describe('createArrow', () => {
    it('creates an arrow with from/to', () => {
      const arrow = createArrow({
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
      });
      expect(arrow.type).toBe('arrow');
      expect(arrow.from).toEqual({ x: 0, y: 0 });
      expect(arrow.to).toEqual({ x: 100, y: 100 });
    });
  });

  describe('createImage', () => {
    it('creates an image element', () => {
      const img = createImage({
        position: { x: 0, y: 0 },
        size: { w: 300, h: 200 },
        src: 'data:image/png;base64,abc',
      });
      expect(img.type).toBe('image');
      expect(img.src).toBe('data:image/png;base64,abc');
    });
  });

  describe('createHtmlElement', () => {
    it('creates an html element', () => {
      const el = createHtmlElement({
        position: { x: 50, y: 50 },
        size: { w: 250, h: 150 },
      });
      expect(el.type).toBe('html');
      expect(el.size).toEqual({ w: 250, h: 150 });
    });
  });
});
