// @vitest-environment jsdom
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

    it('createStroke sets blendMode when provided', () => {
      const s = createStroke({
        points: [
          { x: 0, y: 0, pressure: 1 },
          { x: 1, y: 1, pressure: 1 },
        ],
        blendMode: 'multiply',
      });
      expect(s.blendMode).toBe('multiply');
    });

    it('createStroke omits blendMode when not provided', () => {
      const s = createStroke({
        points: [
          { x: 0, y: 0, pressure: 1 },
          { x: 1, y: 1, pressure: 1 },
        ],
      });
      expect('blendMode' in s).toBe(false);
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

    it('sanitizes script tags from text', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        text: '<script>alert(1)</script>Hello',
      });
      expect(note.text).toBe('Hello');
    });

    it('preserves allowed HTML formatting', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        text: '<b>bold</b> and <i>italic</i>',
      });
      expect(note.text).toBe('<b>bold</b> and <i>italic</i>');
    });

    it('strips event handler attributes', () => {
      const note = createNote({
        position: { x: 0, y: 0 },
        text: '<b onclick="alert(1)">bold</b>',
      });
      expect(note.text).toBe('<b>bold</b>');
    });

    it('handles empty text without sanitization errors', () => {
      const note = createNote({ position: { x: 0, y: 0 } });
      expect(note.text).toBe('');
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

    it('createArrow sets an optional label', () => {
      const a = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, label: 'cause' });
      expect(a.label).toBe('cause');
    });

    it('createArrow omits label when not given', () => {
      const a = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
      expect('label' in a).toBe(false);
    });

    it('createArrow sets an optional strokeStyle', () => {
      const a = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, strokeStyle: 'dotted' });
      expect(a.strokeStyle).toBe('dotted');
    });

    it('createArrow omits strokeStyle when not given (no solid default)', () => {
      const a = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
      expect('strokeStyle' in a).toBe(false);
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
      expect(el.domId).toBeUndefined();
    });

    it('stores domId when provided', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        domId: 'my-widget',
      });
      expect(el.domId).toBe('my-widget');
    });

    it('copies transient only when true', () => {
      const on = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        transient: true,
      });
      const off = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        transient: false,
      });
      expect(on.transient).toBe(true);
      expect('transient' in off).toBe(false);
    });

    it('sets interactive when provided', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        interactive: true,
      });
      expect(el.interactive).toBe(true);
    });

    it('defaults interactive to undefined', () => {
      const el = createHtmlElement({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
      });
      expect(el.interactive).toBeUndefined();
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

    it('sanitizes active and unsupported HTML while preserving rich-text formatting', () => {
      const el = createText({
        position: { x: 0, y: 0 },
        text: '<img src="x" onerror="alert(1)"><b onclick="alert(2)">safe</b>',
      });

      expect(el.text).toBe('<b>safe</b>');
    });
  });
});
