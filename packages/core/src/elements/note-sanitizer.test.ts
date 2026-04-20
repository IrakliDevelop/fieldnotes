// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeNoteHtml, parseStyledRuns } from './note-sanitizer';

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

describe('parseStyledRuns', () => {
  it('parses plain text into a single run', () => {
    const runs = parseStyledRuns('hello', 14);
    expect(runs).toEqual([
      {
        text: 'hello',
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        fontSize: 14,
      },
    ]);
  });

  it('parses bold text', () => {
    const runs = parseStyledRuns('<b>bold</b>', 14);
    expect(runs).toEqual([
      {
        text: 'bold',
        bold: true,
        italic: false,
        underline: false,
        strikethrough: false,
        fontSize: 14,
      },
    ]);
  });

  it('parses strong as bold', () => {
    const runs = parseStyledRuns('<strong>bold</strong>', 14);
    expect(runs[0]?.bold).toBe(true);
  });

  it('parses italic text', () => {
    const runs = parseStyledRuns('<i>italic</i>', 14);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses em as italic', () => {
    const runs = parseStyledRuns('<em>italic</em>', 14);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses underline text', () => {
    const runs = parseStyledRuns('<u>underline</u>', 14);
    expect(runs[0]?.underline).toBe(true);
  });

  it('parses strikethrough text', () => {
    const runs = parseStyledRuns('<s>struck</s>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses del as strikethrough', () => {
    const runs = parseStyledRuns('<del>struck</del>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses strike as strikethrough', () => {
    const runs = parseStyledRuns('<strike>struck</strike>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses font-size from span', () => {
    const runs = parseStyledRuns('<span style="font-size: 24px;">big</span>', 14);
    expect(runs[0]?.fontSize).toBe(24);
  });

  it('parses nested formatting', () => {
    const runs = parseStyledRuns('<b><i>both</i></b>', 14);
    expect(runs[0]?.bold).toBe(true);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses mixed content into multiple runs', () => {
    const runs = parseStyledRuns('plain <b>bold</b> plain', 14);
    expect(runs).toHaveLength(3);
    expect(runs[0]?.text).toBe('plain ');
    expect(runs[0]?.bold).toBe(false);
    expect(runs[1]?.text).toBe('bold');
    expect(runs[1]?.bold).toBe(true);
    expect(runs[2]?.text).toBe(' plain');
    expect(runs[2]?.bold).toBe(false);
  });

  it('converts br to newline', () => {
    const runs = parseStyledRuns('line1<br>line2', 14);
    const text = runs.map((r) => r.text).join('');
    expect(text).toBe('line1\nline2');
  });

  it('converts div to newline', () => {
    const runs = parseStyledRuns('<div>line1</div><div>line2</div>', 14);
    const text = runs.map((r) => r.text).join('');
    expect(text).toContain('\n');
  });

  it('uses baseFontSize as default', () => {
    const runs = parseStyledRuns('text', 18);
    expect(runs[0]?.fontSize).toBe(18);
  });

  it('returns empty array for empty input', () => {
    expect(parseStyledRuns('', 14)).toEqual([]);
  });
});
