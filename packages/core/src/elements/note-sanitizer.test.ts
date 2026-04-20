// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeNoteHtml } from './note-sanitizer';

describe('sanitizeNoteHtml', () => {
  it('passes plain text through unchanged', () => {
    expect(sanitizeNoteHtml('hello world')).toBe('hello world');
  });

  it('preserves bold tags', () => {
    expect(sanitizeNoteHtml('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('preserves strong tags', () => {
    expect(sanitizeNoteHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>');
  });

  it('preserves italic tags', () => {
    expect(sanitizeNoteHtml('<i>italic</i>')).toBe('<i>italic</i>');
  });

  it('preserves em tags', () => {
    expect(sanitizeNoteHtml('<em>italic</em>')).toBe('<em>italic</em>');
  });

  it('preserves underline tags', () => {
    expect(sanitizeNoteHtml('<u>underline</u>')).toBe('<u>underline</u>');
  });

  it('preserves strikethrough tags', () => {
    expect(sanitizeNoteHtml('<s>struck</s>')).toBe('<s>struck</s>');
  });

  it('preserves strike tags', () => {
    expect(sanitizeNoteHtml('<strike>struck</strike>')).toBe('<strike>struck</strike>');
  });

  it('preserves del tags', () => {
    expect(sanitizeNoteHtml('<del>deleted</del>')).toBe('<del>deleted</del>');
  });

  it('preserves br tags', () => {
    expect(sanitizeNoteHtml('line1<br>line2')).toBe('line1<br>line2');
  });

  it('preserves div tags', () => {
    expect(sanitizeNoteHtml('<div>paragraph</div>')).toBe('<div>paragraph</div>');
  });

  it('preserves span with font-size style', () => {
    expect(sanitizeNoteHtml('<span style="font-size: 18px;">big</span>')).toBe(
      '<span style="font-size: 18px;">big</span>',
    );
  });

  it('strips script tags', () => {
    expect(sanitizeNoteHtml('<script>alert("xss")</script>hello')).toBe('hello');
  });

  it('strips event handler attributes', () => {
    expect(sanitizeNoteHtml('<b onclick="alert(1)">bold</b>')).toBe('<b>bold</b>');
  });

  it('strips img tags', () => {
    expect(sanitizeNoteHtml('<img src="x.png">hello')).toBe('hello');
  });

  it('strips anchor tags but keeps text', () => {
    expect(sanitizeNoteHtml('<a href="http://evil.com">link</a>')).toBe('link');
  });

  it('strips non-font-size CSS properties from span', () => {
    expect(sanitizeNoteHtml('<span style="color: red; font-size: 18px;">text</span>')).toBe(
      '<span style="font-size: 18px;">text</span>',
    );
  });

  it('strips style attribute from non-span elements', () => {
    expect(sanitizeNoteHtml('<b style="color: red;">bold</b>')).toBe('<b>bold</b>');
  });

  it('handles nested formatting', () => {
    expect(sanitizeNoteHtml('<b><i>bold italic</i></b>')).toBe('<b><i>bold italic</i></b>');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeNoteHtml('')).toBe('');
  });
});
