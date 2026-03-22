import { describe, it, expect } from 'vitest';
import {
  createStroke,
  createNote,
  createArrow,
  createImage,
  createHtmlElement,
  createText,
  createShape,
} from './element-factory';

describe('element factories', () => {
  describe('createStroke', () => {
    it('creates a stroke with defaults', () => {
      const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
      expect(stroke.type).toBe('stroke');
      expect(stroke.id).toMatch(/^stroke_/);
      expect(stroke.color).toBe('#000000');
      expect(stroke.width).toBe(2);
      expect(stroke.opacity).toBe(1);
      expect(stroke.locked).toBe(false);
    });

    it('accepts overrides', () => {
      const stroke = createStroke({ points: [] as never[], color: '#ff0000', width: 5 });
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
      expect(note.backgroundColor).toBe('#ffeb3b');
      expect(note.textColor).toBe('#000000');
    });

    it('creates a note with custom colors', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        backgroundColor: '#ff0000',
        textColor: '#ffffff',
      });
      expect(note.backgroundColor).toBe('#ff0000');
      expect(note.textColor).toBe('#ffffff');
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

    it('creates arrow without bindings by default', () => {
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
      expect(arrow.fromBinding).toBeUndefined();
      expect(arrow.toBinding).toBeUndefined();
    });

    it('creates arrow with bindings when provided', () => {
      const arrow = createArrow({
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        fromBinding: { elementId: 'note-1' },
        toBinding: { elementId: 'note-2' },
      });
      expect(arrow.fromBinding).toEqual({ elementId: 'note-1' });
      expect(arrow.toBinding).toEqual({ elementId: 'note-2' });
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

  describe('createShape', () => {
    it('creates a rectangle with defaults', () => {
      const shape = createShape({ position: { x: 10, y: 20 }, size: { w: 100, h: 50 } });
      expect(shape.type).toBe('shape');
      expect(shape.shape).toBe('rectangle');
      expect(shape.position).toEqual({ x: 10, y: 20 });
      expect(shape.size).toEqual({ w: 100, h: 50 });
      expect(shape.strokeColor).toBe('#000000');
      expect(shape.strokeWidth).toBe(2);
      expect(shape.fillColor).toBe('none');
    });

    it('creates an ellipse with custom styles', () => {
      const shape = createShape({
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        shape: 'ellipse',
        strokeColor: '#ff0000',
        strokeWidth: 3,
        fillColor: '#00ff00',
      });
      expect(shape.shape).toBe('ellipse');
      expect(shape.strokeColor).toBe('#ff0000');
      expect(shape.strokeWidth).toBe(3);
      expect(shape.fillColor).toBe('#00ff00');
    });
  });

  describe('createText', () => {
    it('creates a text element with defaults', () => {
      const el = createText({ position: { x: 0, y: 0 } });
      expect(el.type).toBe('text');
      expect(el.id).toMatch(/^text_/);
      expect(el.text).toBe('');
      expect(el.fontSize).toBe(16);
      expect(el.color).toBe('#1a1a1a');
      expect(el.textAlign).toBe('left');
      expect(el.size).toEqual({ w: 200, h: 28 });
      expect(el.locked).toBe(false);
    });

    it('accepts overrides', () => {
      const el = createText({
        position: { x: 0, y: 0 },
        fontSize: 24,
        color: '#ff0000',
        textAlign: 'center',
        size: { w: 300, h: 40 },
      });
      expect(el.fontSize).toBe(24);
      expect(el.color).toBe('#ff0000');
      expect(el.textAlign).toBe('center');
      expect(el.size).toEqual({ w: 300, h: 40 });
    });
  });
});
